// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Admission (sync spec §9, architecture §5.3), run by every member from the class policy.
//!
//! An unknown device that knocks is added **provisionally, with no folders**; once it offers
//! the ID of one of my shared classes (folder-ID proof, re-checked by Rust in
//! `/rest/cluster/pending/folders`, §9.5) the class is shared with it, unless the class asks
//! before letting people in or bans it. Membership is always re-derived from the current
//! Syncthing config; `provisional` is only a timer list. `decide()` is the pure rule shared
//! with TS through `test-vectors/admission.json`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::ids;

use crate::appdata::{FailedRec, IgnoreReason, IgnoredRec, WEEK_MS};
use crate::client::{devices_body, folder_devices};
use crate::ctx::Ctx;
use crate::types::{
    ClassPolicy, Decision, FolderOffer, FolderOfferView, GlobalPolicy, JoinRequestView, SyncEvent,
};

pub const MAX_PROVISIONAL: usize = 32;
pub const PROVISIONAL_TIMEOUT: Duration = Duration::from_secs(60);
pub const EARLY_EVICT: Duration = Duration::from_secs(2);
pub const MAX_FAILED_PER_SOURCE: usize = 3;
/// By strikes within the last 7 days: 10 min, 1 h, 24 h, 7 days.
pub const IGNORE_STEPS_MS: [u64; 4] = [600_000, 3_600_000, 86_400_000, WEEK_MS];
pub const QUEUE_TIMEOUT: Duration = Duration::from_secs(24 * 3600);
pub const MAX_MANAGED_IGNORES: usize = 500;
pub const IGNORE_NAME: &str = "tramado";
pub const BAN_NAME: &str = "tramado-ban";

/// The admission decision for one folder offer (architecture §5.3; `test-vectors/admission.json`).
pub fn decide(
    policies: &BTreeMap<String, ClassPolicy>,
    global: &GlobalPolicy,
    offer: &FolderOffer,
    now_ms: u64,
) -> Decision {
    let Some(p) = policies.get(&offer.folder_id) else {
        return Decision::Unknown;
    };
    let dev = offer.device_id.as_str();
    if offer.in_folder {
        return Decision::Skip;
    }
    if p.banned_devices.iter().any(|d| d == dev) {
        return Decision::Ban;
    }
    let known = p.known_devices.iter().any(|d| d == dev);
    let pairing = global.own_devices.iter().any(|d| d == dev)
        || global.pairing_open_until.is_some_and(|u| u > now_ms);
    if p.ask_before_admit && !known && !pairing {
        return Decision::Queue;
    }
    Decision::Share
}

/// `source(address)`: the IPv4 /24 or IPv6 /64 of the observed address; relays are exempt.
pub fn source(address: &str) -> Option<String> {
    if address.is_empty() || address.starts_with("relay") {
        return None;
    }
    let hp = address.split_once("://").map(|(_, r)| r).unwrap_or(address);
    let ip: IpAddr = match hp.parse::<SocketAddr>() {
        Ok(sa) => sa.ip(),
        Err(_) => hp.parse().ok()?,
    };
    Some(match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            format!("{}.{}.{}.0/24", o[0], o[1], o[2])
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
        }
    })
}

#[derive(Debug, Clone)]
pub struct Provisional {
    pub added_at: Instant,
    pub source: Option<String>,
    pub address: String,
    pub evict_at: Option<Instant>,
}

/// Admission's in-memory state (one per engine).
#[derive(Default)]
pub struct Admission {
    pub provisional: HashMap<String, Provisional>,
    /// (class, device) → the request shown to people (ask mode, §9.3)
    pub queued: BTreeMap<(String, String), JoinRequestView>,
    pub pending_ignores: Vec<(String, IgnoreReason)>,
    /// Offers of unknown `tramado-*` folders already reported to the app.
    pub offers: BTreeMap<(String, String), FolderOfferView>,
    /// Shares deferred by the start-up rule: re-run `handle_pending_folders` at the next sweep.
    pub deferred: bool,
}

impl Admission {
    pub fn queued_for(&self, dev: &str) -> bool {
        self.queued.keys().any(|(_, d)| d == dev)
    }

    fn unqueue(&mut self, ctx: &Ctx, class: Option<&str>, dev: &str) {
        let keys: Vec<(String, String)> = self
            .queued
            .keys()
            .filter(|(c, d)| d == dev && class.is_none_or(|x| x == c))
            .cloned()
            .collect();
        for k in keys {
            self.queued.remove(&k);
            ctx.emit(SyncEvent::JoinRequestGone {
                class_id: k.0,
                device_id: k.1,
            });
        }
    }

    /// Queues an ignore of `dev`; `apply_ignores` writes them in one `PUT /rest/config`.
    pub fn ignore_device(&mut self, ctx: &Ctx, dev: &str, reason: IgnoreReason) {
        let source = self.provisional.remove(dev).and_then(|p| p.source);
        self.unqueue(ctx, None, dev);
        if reason == IgnoreReason::NoProof {
            if let Some(s) = source {
                ctx.appdata.update_quiet(|a| {
                    a.failed.push(FailedRec {
                        source: s,
                        at: ctx.now.ms,
                    })
                });
            }
        }
        if !self.pending_ignores.iter().any(|(d, _)| d == dev) {
            self.pending_ignores.push((dev.to_string(), reason));
        }
    }

    /// §9.2 `handle_pending_devices`: provisional add, no folders. Bans are not checked here.
    pub fn handle_pending_devices(&mut self, ctx: &Ctx) -> AppResult<()> {
        let pend = ctx.c.pending_devices()?;
        if pend.is_empty() {
            return Ok(());
        }
        ctx.writer.run(|| {
            let cfg = ctx.c.config()?;
            let configured = ids_of(&cfg["devices"]);
            let ignored = ids_of(&cfg["remoteIgnoredDevices"]);
            for (dev, pd) in pend {
                if configured.contains(&dev) || ignored.contains(&dev) || dev == ctx.me {
                    continue;
                }
                if self.provisional.len() >= MAX_PROVISIONAL {
                    continue; // retried by sweep()
                }
                let src = source(&pd.address);
                if let Some(s) = &src {
                    if ctx.appdata.read(|a| a.failures_from(s, ctx.now.ms)) >= MAX_FAILED_PER_SOURCE
                    {
                        continue;
                    }
                }
                let mut addresses = Vec::new();
                if !pd.address.is_empty() && !pd.address.contains("://") {
                    addresses.push(format!("tcp://{}", pd.address));
                } else if pd.address.starts_with("tcp://") || pd.address.starts_with("quic://") {
                    addresses.push(pd.address.clone());
                }
                addresses.push("dynamic".to_string());
                ctx.c.add_device(&json!({
                    "deviceID": dev, "name": pd.name, "addresses": addresses,
                    "compression": "metadata", "introducer": false, "autoAcceptFolders": false
                }))?;
                log::info!("sync: provisional device {}", ids::short_id(&dev));
                self.provisional.insert(
                    dev,
                    Provisional {
                        added_at: ctx.now.mono,
                        source: src,
                        address: pd.address,
                        evict_at: None,
                    },
                );
            }
            Ok(())
        })
    }

    /// §9.2 `handle_pending_folders`, deciding from the class policy.
    pub fn handle_pending_folders(&mut self, ctx: &Ctx) -> AppResult<()> {
        let pend = ctx.c.pending_folders()?;
        if pend.is_empty() {
            return Ok(());
        }
        let retired = ctx.retired_ids();
        let folders = ctx.c.folders()?;
        let devs_of = |id: &str| -> Vec<String> {
            folders
                .iter()
                .find(|f| f["id"] == id)
                .map(folder_devices)
                .unwrap_or_default()
        };
        let policies = ctx.policy.all();
        let global = ctx.policy.global();
        for (folder, offers) in &pend {
            if retired.contains(folder) {
                for (dev, o) in offers {
                    ctx.add_ignored_folder(dev, folder, &o.label)?;
                }
                continue;
            }
            let Some(cls) = ctx.class(folder).filter(|e| e.shared) else {
                if ids::is_class_id(folder) {
                    for (dev, o) in offers {
                        let key = (folder.clone(), dev.clone());
                        if let std::collections::btree_map::Entry::Vacant(slot) =
                            self.offers.entry(key)
                        {
                            let name = ctx
                                .c
                                .device(dev)?
                                .and_then(|d| d["name"].as_str().map(str::to_string))
                                .unwrap_or_default();
                            let view = FolderOfferView {
                                folder_id: folder.clone(),
                                label: o.label.clone(),
                                offered_by: dev.clone(),
                                offered_by_name: name,
                                at: ctx.now.instant(),
                            };
                            slot.insert(view.clone());
                            ctx.emit(SyncEvent::FolderOffer { offer: view });
                        }
                    }
                }
                continue;
            };
            if cls.leaving.is_some() {
                continue; // a class I am leaving lets no one new in
            }
            let in_folder = devs_of(folder);
            for dev in offers.keys() {
                let offer = FolderOffer {
                    folder_id: folder.clone(),
                    device_id: dev.clone(),
                    in_folder: in_folder.contains(dev),
                };
                if !policies.contains_key(folder) {
                    self.deferred = true; // no policy yet: nothing widens
                    continue;
                }
                match decide(&policies, &global, &offer, ctx.now.ms) {
                    Decision::Skip | Decision::Unknown => {}
                    Decision::Ban => self.refuse(ctx, folder, dev, &pend, &policies)?,
                    _ if !ctx.policy_received(folder) => self.deferred = true,
                    Decision::Queue => self.queue_for_approval(ctx, folder, dev)?,
                    Decision::Share => self.share(ctx, folder, dev)?,
                }
            }
        }
        Ok(())
    }

    fn queue_for_approval(&mut self, ctx: &Ctx, class: &str, dev: &str) -> AppResult<()> {
        let key = (class.to_string(), dev.to_string());
        if self.queued.contains_key(&key) {
            return Ok(());
        }
        let name = ctx
            .c
            .device(dev)?
            .and_then(|d| d["name"].as_str().map(str::to_string))
            .unwrap_or_default();
        let address = self
            .provisional
            .get(dev)
            .map(|p| p.address.clone())
            .unwrap_or_default();
        let request = JoinRequestView {
            class_id: class.to_string(),
            device_id: dev.to_string(),
            name,
            address,
            at: ctx.now.instant(),
        };
        self.queued.insert(key, request.clone());
        ctx.emit(SyncEvent::JoinRequest { request });
        Ok(())
    }

    /// `share(cls, dev)`: widening, so only when the offer is pending (callers checked, §9.5).
    pub fn share(&mut self, ctx: &Ctx, class: &str, dev: &str) -> AppResult<()> {
        let name = ctx.writer.run(|| -> AppResult<String> {
            let f = ctx
                .c
                .folder(class)?
                .ok_or_else(|| AppError::not_found("the class is not shared"))?;
            let mut devs = folder_devices(&f);
            if !devs.iter().any(|d| d == dev) {
                devs.push(dev.to_string());
                ctx.c
                    .patch_folder(class, &json!({ "devices": devices_body(&devs) }))?;
            }
            Ok(ctx
                .c
                .device(dev)?
                .and_then(|d| d["name"].as_str().map(str::to_string))
                .unwrap_or_default())
        })?;
        self.provisional.remove(dev);
        ctx.appdata.update_quiet(|a| {
            a.proof_at
                .entry(class.to_string())
                .or_default()
                .insert(dev.to_string(), ctx.now.ms);
        });
        self.unqueue(ctx, Some(class), dev);
        log::info!(
            "sync: shared {} with {}",
            ids::short_id(class),
            ids::short_id(dev)
        );
        ctx.emit(SyncEvent::Admitted {
            class_id: class.to_string(),
            device_id: dev.to_string(),
            name,
        });
        Ok(())
    }

    /// `refuse(cls, dev)`: this class only; a device-wide ignore when every tramado folder it
    /// offers bans it.
    fn refuse(
        &mut self,
        ctx: &Ctx,
        class: &str,
        dev: &str,
        pend: &crate::client::PendingFolders,
        policies: &BTreeMap<String, ClassPolicy>,
    ) -> AppResult<()> {
        ctx.add_ignored_folder(dev, class, &ctx.label(class))?;
        self.unqueue(ctx, Some(class), dev);
        let all_banned = pend
            .iter()
            .filter(|(f, offers)| ids::is_class_id(f) && offers.contains_key(dev))
            .all(|(f, _)| {
                policies
                    .get(f)
                    .is_some_and(|p| p.banned_devices.iter().any(|d| d == dev))
            });
        if all_banned {
            self.ignore_device(ctx, dev, IgnoreReason::Banned);
        }
        Ok(())
    }

    /// `ClusterConfigReceived` from a provisional device: evict it 2 s later unless it offers
    /// one of my shared classes (§9.2 early eviction).
    pub fn on_cluster_config(&mut self, dev: &str, now: Instant) {
        if let Some(p) = self.provisional.get_mut(dev) {
            if p.evict_at.is_none() {
                p.evict_at = Some(now + EARLY_EVICT);
            }
        }
    }

    /// Early evictions that are due; returns whether ignores were queued.
    pub fn early_evictions(&mut self, ctx: &Ctx) -> AppResult<bool> {
        let due: Vec<String> = self
            .provisional
            .iter()
            .filter(|(_, p)| p.evict_at.is_some_and(|t| t <= ctx.now.mono))
            .map(|(d, _)| d.clone())
            .collect();
        if due.is_empty() {
            return Ok(false);
        }
        let pend = ctx.c.pending_folders()?;
        let mine: HashSet<String> = ctx
            .shared_classes()
            .into_iter()
            .map(|e| e.class_id)
            .collect();
        let mut queued = false;
        for dev in due {
            let proves = pend
                .iter()
                .any(|(f, offers)| mine.contains(f) && offers.contains_key(&dev));
            if proves {
                if let Some(p) = self.provisional.get_mut(&dev) {
                    p.evict_at = None; // handle_pending_folders decides
                }
            } else if !self.queued_for(&dev) {
                self.ignore_device(ctx, &dev, IgnoreReason::NoProof);
                queued = true;
            }
        }
        Ok(queued)
    }

    /// §9.2 `sweep()`, every 5 s.
    pub fn sweep(&mut self, ctx: &Ctx) -> AppResult<()> {
        self.handle_pending_devices(ctx)?;
        if std::mem::take(&mut self.deferred) {
            self.handle_pending_folders(ctx)?;
        }
        let cfg = ctx.c.config()?;
        let in_folders: HashSet<String> = cfg["folders"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(folder_devices)
            .collect();
        let configured = ids_of(&cfg["devices"]);
        let entries: Vec<(String, Provisional)> = self
            .provisional
            .iter()
            .map(|(d, p)| (d.clone(), p.clone()))
            .collect();
        for (dev, p) in entries {
            if in_folders.contains(&dev) {
                self.provisional.remove(&dev);
                self.unqueue(ctx, None, &dev);
                continue;
            }
            if !configured.contains(&dev) {
                self.provisional.remove(&dev); // removed by someone else (user, reconcile)
                continue;
            }
            let age = ctx.now.mono.saturating_duration_since(p.added_at);
            if self.queued_for(&dev) {
                if age < QUEUE_TIMEOUT {
                    continue;
                }
                ctx.writer.run(|| ctx.c.delete_device(&dev))?; // not ignored: may knock again
                self.unqueue(ctx, None, &dev);
                self.provisional.remove(&dev);
                continue;
            }
            if age >= PROVISIONAL_TIMEOUT {
                self.ignore_device(ctx, &dev, IgnoreReason::NoProof);
            }
        }
        // queued requests of devices that left the queue another way (admitted elsewhere)
        let stale: Vec<(String, String)> = self
            .queued
            .keys()
            .filter(|(_, d)| in_folders.contains(d) || !configured.contains(d))
            .cloned()
            .collect();
        for (c, d) in stale {
            self.unqueue(ctx, Some(&c), &d);
        }
        self.apply_ignores(ctx)
    }

    /// Writes the queued ignores and expires old ones, in one `PUT /rest/config` (§9.2).
    pub fn apply_ignores(&mut self, ctx: &Ctx) -> AppResult<()> {
        let queued = std::mem::take(&mut self.pending_ignores);
        let res = ctx.writer.run(|| -> AppResult<()> {
            let mut cfg = ctx.c.config()?;
            let before = cfg.clone();
            for (dev, reason) in &queued {
                let rec = ctx.appdata.read(|a| a.ignored.get(dev).cloned());
                let strikes = match rec {
                    Some(r) if ctx.now.ms.saturating_sub(r.at) < WEEK_MS => r.strikes + 1,
                    _ => 1,
                };
                let until = match reason {
                    IgnoreReason::Banned => None,
                    IgnoreReason::NoProof => {
                        let step = IGNORE_STEPS_MS[(strikes.min(4) - 1) as usize];
                        Some(ctx.now.ms + step)
                    }
                };
                ctx.appdata.update_quiet(|a| {
                    a.ignored.insert(
                        dev.clone(),
                        IgnoredRec {
                            at: ctx.now.ms,
                            until,
                            strikes,
                            reason: *reason,
                        },
                    );
                });
                let name = if *reason == IgnoreReason::Banned {
                    BAN_NAME
                } else {
                    IGNORE_NAME
                };
                ignore_in_config(&mut cfg, dev, name, &ctx.now.rfc3339());
                log::info!("sync: ignored {} ({:?})", ids::short_id(dev), reason);
            }
            cap_managed_ignores(&mut cfg);
            expire_ignores(ctx, &mut cfg);
            if cfg != before {
                ctx.c.put_config(&cfg)?;
            }
            Ok(())
        });
        if res.is_err() {
            // keep them for the next sweep
            self.pending_ignores.extend(queued);
        }
        ctx.appdata.update_quiet(|a| a.prune(ctx.now.ms));
        res
    }

    /// `sync_admit` (Let in, §9.3): only when the offer of `class` by `dev` is pending (§9.5).
    pub fn admit(&mut self, ctx: &Ctx, class: &str, dev: &str) -> AppResult<()> {
        let cls = ctx
            .class(class)
            .filter(|e| e.shared)
            .ok_or_else(|| AppError::not_found("no such shared class"))?;
        if let Some(p) = ctx.policy.get(&cls.class_id) {
            if p.banned_devices.iter().any(|d| d == dev) {
                return Err(AppError::new(
                    Code::PermissionDenied,
                    "this device is banned from the class",
                ));
            }
        }
        let pend = ctx.c.pending_folders()?;
        if !pend.get(class).is_some_and(|o| o.contains_key(dev)) {
            log::warn!(
                "sync: refused to admit {} to {}: no pending offer",
                ids::short_id(dev),
                ids::short_id(class)
            );
            return Err(AppError::new(
                Code::PermissionDenied,
                "that computer is not asking to join this class",
            ));
        }
        self.share(ctx, class, dev)
    }

    /// `sync_decline`: this member only ignores the device (§9.3; an organiser's app also bans).
    pub fn decline(&mut self, ctx: &Ctx, class: &str, dev: &str) -> AppResult<()> {
        self.unqueue(ctx, Some(class), dev);
        let configured = ctx.c.device(dev)?.is_some();
        let in_folder = ctx
            .c
            .folders()?
            .iter()
            .any(|f| folder_devices(f).iter().any(|d| d == dev));
        if configured && !in_folder {
            self.ignore_device(ctx, dev, IgnoreReason::NoProof);
            self.apply_ignores(ctx)?;
        }
        Ok(())
    }

    pub fn join_requests(&self) -> Vec<JoinRequestView> {
        self.queued.values().cloned().collect()
    }

    pub fn folder_offers(&self, pend: &crate::client::PendingFolders) -> Vec<FolderOfferView> {
        self.offers
            .iter()
            .filter(|((f, d), _)| pend.get(f).is_some_and(|o| o.contains_key(d)))
            .map(|(_, v)| v.clone())
            .collect()
    }
}

pub fn ids_of(list: &Value) -> HashSet<String> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| d["deviceID"].as_str().map(str::to_string))
        .collect()
}

/// Removes `dev` from devices and folders and adds (or renames) its `remoteIgnoredDevices` entry.
pub fn ignore_in_config(cfg: &mut Value, dev: &str, name: &str, time: &str) {
    if let Some(a) = cfg["devices"].as_array_mut() {
        a.retain(|d| d["deviceID"] != dev);
    }
    if let Some(fs) = cfg["folders"].as_array_mut() {
        for f in fs {
            if let Some(a) = f["devices"].as_array_mut() {
                a.retain(|d| d["deviceID"] != dev);
            }
        }
    }
    if !cfg["remoteIgnoredDevices"].is_array() {
        cfg["remoteIgnoredDevices"] = json!([]);
    }
    if let Some(list) = cfg["remoteIgnoredDevices"].as_array_mut() {
        if let Some(e) = list.iter_mut().find(|e| e["deviceID"] == dev) {
            if e["name"] == IGNORE_NAME || e["name"] == BAN_NAME {
                e["name"] = json!(name);
            }
        } else {
            list.push(json!({ "deviceID": dev, "name": name, "address": "", "time": time }));
        }
    }
}

/// More than `MAX_MANAGED_IGNORES` entries named "tramado": drop the oldest that is not a ban.
fn cap_managed_ignores(cfg: &mut Value) {
    let Some(list) = cfg["remoteIgnoredDevices"].as_array_mut() else {
        return;
    };
    loop {
        let managed: Vec<usize> = list
            .iter()
            .enumerate()
            .filter(|(_, e)| e["name"] == IGNORE_NAME)
            .map(|(i, _)| i)
            .collect();
        if managed.len() <= MAX_MANAGED_IGNORES {
            return;
        }
        let oldest = managed
            .iter()
            .copied()
            .min_by_key(|i| list[*i]["time"].as_str().unwrap_or_default().to_string());
        match oldest {
            Some(i) => {
                list.remove(i);
            }
            None => return,
        }
    }
}

/// `expire_ignores(cfg)`: entries named "tramado"/"tramado-ban" whose `until` passed; entries
/// with other names are the user's own and never touched.
fn expire_ignores(ctx: &Ctx, cfg: &mut Value) {
    let Some(list) = cfg["remoteIgnoredDevices"].as_array_mut() else {
        return;
    };
    list.retain(|e| {
        let ours = e["name"] == IGNORE_NAME || e["name"] == BAN_NAME;
        if !ours {
            return true;
        }
        let dev = e["deviceID"].as_str().unwrap_or_default();
        let until = ctx.appdata.read(|a| a.ignored.get(dev).map(|r| r.until));
        !matches!(until, Some(Some(u)) if u <= ctx.now.ms)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::testing::World;
    use crate::ctx::Now;
    use crate::fake::ME;
    use crate::invite::tests::{D1, D2};
    use crate::types::RosterDevice;

    const C: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const D3: &str = "LMRSFKK-CDQBSRF-UNW65YW-RJASPVK-ISWFVO5-CP2CB54-64AZW4S-U5MGNQH";

    fn pol() -> ClassPolicy {
        ClassPolicy {
            class_id: C.into(),
            label: "TGDC".into(),
            ask_before_admit: false,
            roster: vec![],
            known_devices: vec![],
            banned_devices: vec![],
            updated_at: "2026-11-04T10:00:00.000Z".into(),
        }
    }

    #[test]
    fn decide_matches_the_shared_vectors() {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../test-vectors/admission.json");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
        let devices = v["devices"].as_object().unwrap();
        let dev = |s: &str| {
            devices
                .get(s)
                .and_then(Value::as_str)
                .unwrap_or(s)
                .to_string()
        };
        for case in v["cases"].as_array().unwrap() {
            let mut cls = pol();
            cls.class_id = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa".into();
            let pp = &case["policy"];
            if let Some(b) = pp["askBeforeAdmit"].as_bool() {
                cls.ask_before_admit = b;
            }
            for (k, list) in [
                ("bannedDevices", &mut cls.banned_devices),
                ("knownDevices", &mut cls.known_devices),
            ] {
                for d in pp[k].as_array().into_iter().flatten() {
                    list.push(dev(d.as_str().unwrap()));
                }
            }
            let g = &case["global"];
            let global = GlobalPolicy {
                own_devices: g["ownDevices"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|d| dev(d.as_str().unwrap()))
                    .collect(),
                pairing_open_until: g["pairingOpenUntil"].as_u64(),
            };
            let o = &case["offer"];
            let offer = FolderOffer {
                folder_id: o["folderId"]
                    .as_str()
                    .unwrap_or("tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa")
                    .into(),
                device_id: dev(o["deviceId"].as_str().unwrap_or("D1")),
                in_folder: o["inFolder"].as_bool().unwrap_or(false),
            };
            let mut policies = BTreeMap::new();
            policies.insert(cls.class_id.clone(), cls);
            let got = decide(
                &policies,
                &global,
                &offer,
                case["now"].as_u64().unwrap_or(0),
            );
            let want: Decision = serde_json::from_value(case["expect"].clone()).unwrap();
            assert_eq!(got, want, "case {}", case["name"]);
        }
    }

    #[test]
    fn sources_bucket_addresses() {
        assert_eq!(
            source("192.168.1.20:22100").as_deref(),
            Some("192.168.1.0/24")
        );
        assert_eq!(source("tcp://10.1.2.3:1").as_deref(), Some("10.1.2.0/24"));
        assert_eq!(
            source("[2001:db8:1:2:3::9]:22100").as_deref(),
            Some("2001:db8:1:2::/64")
        );
        assert_eq!(source("relay://1.2.3.4:22067/?id=X"), None);
        assert_eq!(source(""), None);
    }

    #[test]
    fn proof_shares_and_outsider_is_ignored_after_timeout() {
        let w = World::new();
        w.shared_class(C, &[]);
        w.push(pol());
        let now = Now::current();
        let ctx = w.ctx(now);
        let mut a = Admission::default();
        w.fake.knock(D1, "Bruno", "10.0.0.5:22100");
        w.fake.knock(D2, "Eve", "10.9.0.5:22100");
        a.handle_pending_devices(&ctx).unwrap();
        assert_eq!(a.provisional.len(), 2);
        assert!(
            w.fake.folder_devices(C) == vec![ME.to_string()],
            "no folders on a provisional add"
        );
        let added = w.fake.device(D1).unwrap();
        assert_eq!(
            added["addresses"],
            json!(["tcp://10.0.0.5:22100", "dynamic"])
        );
        w.fake.offer(C, D1);
        a.handle_pending_folders(&ctx).unwrap();
        assert!(w.fake.folder_devices(C).contains(&D1.to_string()));
        assert!(!a.provisional.contains_key(D1));
        assert!(w
            .take_events()
            .iter()
            .any(|e| matches!(e, SyncEvent::Admitted { device_id, .. } if device_id == D1)));
        assert!(w.appdata.read(|d| d.proof_at[C].contains_key(D1)));
        // the outsider offers nothing: ignored once PROVISIONAL_TIMEOUT has passed
        let later = w.ctx(now.plus(PROVISIONAL_TIMEOUT));
        a.sweep(&later).unwrap();
        assert!(w.fake.device(D2).is_none());
        assert_eq!(
            w.fake.ignored_ids(),
            vec![(D2.to_string(), "tramado".to_string())]
        );
        let rec = w.appdata.read(|d| d.ignored[D2].clone());
        assert_eq!(
            (rec.strikes, rec.until),
            (1, Some(later.now.ms + IGNORE_STEPS_MS[0]))
        );
        assert_eq!(
            w.appdata
                .read(|d| d.failures_from("10.9.0.0/24", later.now.ms)),
            1
        );
    }

    #[test]
    fn strikes_escalate_and_ignores_expire() {
        let w = World::new();
        w.shared_class(C, &[]);
        let now = Now::current();
        let mut a = Admission::default();
        for (i, step) in IGNORE_STEPS_MS.iter().enumerate() {
            let t = now.plus(Duration::from_secs(i as u64 * 10));
            let ctx = w.ctx(t);
            w.fake.add_device(D2);
            a.ignore_device(&ctx, D2, IgnoreReason::NoProof);
            a.apply_ignores(&ctx).unwrap();
            let rec = w.appdata.read(|d| d.ignored[D2].clone());
            assert_eq!(rec.strikes, i as u32 + 1);
            assert_eq!(rec.until, Some(t.ms + step));
        }
        // a fifth strike stays at the longest step
        let ctx = w.ctx(now.plus(Duration::from_secs(50)));
        a.ignore_device(&ctx, D2, IgnoreReason::NoProof);
        a.apply_ignores(&ctx).unwrap();
        assert_eq!(
            w.appdata.read(|d| d.ignored[D2].until),
            Some(ctx.now.ms + WEEK_MS)
        );
        // the last ignore expires after 7 days (its record is pruned with it)
        let late = w.ctx(now.plus(Duration::from_millis(WEEK_MS + 60_000)));
        a.apply_ignores(&late).unwrap();
        assert!(w.fake.ignored_ids().is_empty());
        // a first ignore expires after 10 minutes and its strike is remembered for 7 days
        let w = World::new();
        w.shared_class(C, &[]);
        let mut a = Admission::default();
        w.fake.add_device(D2);
        a.ignore_device(&w.ctx(now), D2, IgnoreReason::NoProof);
        a.apply_ignores(&w.ctx(now)).unwrap();
        assert_eq!(w.fake.ignored_ids().len(), 1);
        a.apply_ignores(&w.ctx(now.plus(Duration::from_secs(601))))
            .unwrap();
        assert!(w.fake.ignored_ids().is_empty());
        assert_eq!(w.appdata.read(|d| d.ignored[D2].strikes), 1);
        w.fake.add_device(D2);
        let again = w.ctx(now.plus(Duration::from_secs(700)));
        a.ignore_device(&again, D2, IgnoreReason::NoProof);
        a.apply_ignores(&again).unwrap();
        assert_eq!(
            w.appdata.read(|d| d.ignored[D2].until),
            Some(again.now.ms + IGNORE_STEPS_MS[1])
        );
    }

    #[test]
    fn a_burst_from_one_source_is_limited_but_successes_do_not_count() {
        let w = World::new();
        w.shared_class(C, &[]);
        let now = Now::current();
        let ctx = w.ctx(now);
        let mut a = Admission::default();
        for _ in 0..3 {
            w.appdata
                .update(|d| {
                    d.failed.push(FailedRec {
                        source: "10.0.0.0/24".into(),
                        at: now.ms,
                    })
                })
                .unwrap();
        }
        w.fake.knock(D1, "x", "10.0.0.7:22100");
        w.fake.knock(D2, "y", "10.0.1.7:22100");
        a.handle_pending_devices(&ctx).unwrap();
        assert!(!a.provisional.contains_key(D1) && a.provisional.contains_key(D2));
        // ten minutes later the source may knock again (sweep retries skipped devices)
        let later = w.ctx(now.plus(Duration::from_secs(601)));
        a.sweep(&later).unwrap();
        assert!(a.provisional.contains_key(D1));
    }

    #[test]
    fn at_most_max_provisional_then_sweep_retries() {
        let w = World::new();
        w.shared_class(C, &[]);
        let ctx = w.ctx(Now::current());
        let mut a = Admission::default();
        for i in 0..MAX_PROVISIONAL {
            a.provisional.insert(
                format!("P{i}"),
                Provisional {
                    added_at: ctx.now.mono,
                    source: None,
                    address: String::new(),
                    evict_at: None,
                },
            );
        }
        w.fake.knock(D1, "x", "10.0.0.7:22100");
        a.handle_pending_devices(&ctx).unwrap();
        assert!(!a.provisional.contains_key(D1));
        a.provisional.clear(); // the others resolved
        a.sweep(&ctx).unwrap();
        assert!(a.provisional.contains_key(D1));
    }

    #[test]
    fn early_eviction_after_cluster_config_without_proof() {
        let w = World::new();
        w.shared_class(C, &[]);
        let now = Now::current();
        let mut a = Admission::default();
        w.fake.knock(D1, "x", "10.0.0.7:22100");
        w.fake.knock(D2, "y", "10.0.1.7:22100");
        a.handle_pending_devices(&w.ctx(now)).unwrap();
        a.on_cluster_config(D1, now.mono);
        a.on_cluster_config(D2, now.mono);
        w.fake.offer(C, D2);
        // a guessed tramado ID is no proof
        w.fake.offer("tramado-zzzzzzzzzzzzzzzzzzzzzzzzzz", D1);
        assert!(!a
            .early_evictions(&w.ctx(now.plus(Duration::from_secs(1))))
            .unwrap());
        let ctx = w.ctx(now.plus(EARLY_EVICT));
        assert!(a.early_evictions(&ctx).unwrap());
        a.apply_ignores(&ctx).unwrap();
        assert!(w.fake.device(D1).is_none());
        assert!(w.fake.device(D2).is_some() && a.provisional.contains_key(D2));
    }

    #[test]
    fn startup_rule_defers_shares_but_not_bans() {
        let w = World::new();
        w.shared_class(C, &[]);
        let mut p = pol();
        p.banned_devices = vec![D2.into()];
        // persisted from a previous session: not received this session
        w.policy.set(p.clone()).unwrap();
        let fresh = crate::policy::PolicyStore::load(&w.dir.path().join("st"));
        let ctx = Ctx {
            policy: &fresh,
            ..w.ctx(Now::current())
        };
        let mut a = Admission::default();
        for d in [D1, D2] {
            w.fake.knock(d, "x", "10.0.0.7:22100");
        }
        a.handle_pending_devices(&ctx).unwrap();
        w.fake.offer(C, D1);
        w.fake.offer(C, D2);
        a.handle_pending_folders(&ctx).unwrap();
        assert_eq!(
            w.fake.folder_devices(C),
            vec![ME.to_string()],
            "no share before the push"
        );
        assert!(a.deferred);
        let ignored = w.fake.device(D2).map(|d| d["ignoredFolders"].clone());
        assert!(
            ignored.is_none() || ignored.unwrap()[0]["id"] == C,
            "the ban was applied"
        );
        a.apply_ignores(&ctx).unwrap();
        assert!(w
            .fake
            .ignored_ids()
            .contains(&(D2.to_string(), "tramado-ban".to_string())));
        // the app pushes: the deferred share happens at the next sweep
        fresh.set(p).unwrap();
        a.sweep(&ctx).unwrap();
        assert!(w.fake.folder_devices(C).contains(&D1.to_string()));
        // or 120 s after start without a push
        let w2 = World::new();
        w2.shared_class(C, &[]);
        w2.policy.set(pol()).unwrap();
        let st2 = crate::policy::PolicyStore::load(&w2.dir.path().join("st"));
        let later = Ctx {
            policy: &st2,
            ..w2.ctx(Now::current().plus(crate::ctx::STARTUP_GRACE))
        };
        w2.fake.add_device(D1);
        w2.fake.offer(C, D1);
        a.handle_pending_folders(&later).unwrap();
        assert!(w2.fake.folder_devices(C).contains(&D1.to_string()));
    }

    #[test]
    fn ask_mode_queues_then_admit_and_known_members_pass() {
        let w = World::new();
        w.shared_class(C, &[]);
        let mut p = pol();
        p.ask_before_admit = true;
        p.known_devices = vec![D2.into()];
        w.push(p);
        let ctx = w.ctx(Now::current());
        let mut a = Admission::default();
        for d in [D1, D2] {
            w.fake.knock(d, "Bruno's laptop", "10.0.0.7:22100");
        }
        a.handle_pending_devices(&ctx).unwrap();
        w.fake.offer(C, D1);
        w.fake.offer(C, D2);
        a.handle_pending_folders(&ctx).unwrap();
        let devs = w.fake.folder_devices(C);
        assert!(devs.contains(&D2.to_string()) && !devs.contains(&D1.to_string()));
        let ev = w.take_events();
        assert!(ev.iter().any(|e| matches!(e, SyncEvent::JoinRequest { request } if request.device_id == D1 && request.name == "Bruno's laptop")));
        assert_eq!(a.join_requests().len(), 1);
        // a queued device stays provisional across sweeps
        a.sweep(&w.ctx(Now::current().plus(PROVISIONAL_TIMEOUT * 2)))
            .unwrap();
        assert!(w.fake.device(D1).is_some());
        // Let in
        a.admit(&ctx, C, D1).unwrap();
        assert!(w.fake.folder_devices(C).contains(&D1.to_string()));
        let ev = w.take_events();
        assert!(ev
            .iter()
            .any(|e| matches!(e, SyncEvent::JoinRequestGone { device_id, .. } if device_id == D1)));
        assert!(a.join_requests().is_empty());
    }

    #[test]
    fn admit_refused_without_pending_offer_or_when_banned() {
        let w = World::new();
        w.shared_class(C, &[]);
        let mut p = pol();
        p.banned_devices = vec![D2.into()];
        w.push(p);
        let ctx = w.ctx(Now::current());
        let mut a = Admission::default();
        w.fake.add_device(D1);
        let e = a.admit(&ctx, C, D1).unwrap_err();
        assert_eq!(e.code(), Code::PermissionDenied);
        assert_eq!(w.fake.folder_devices(C), vec![ME.to_string()]);
        w.fake.add_device(D2);
        w.fake.offer(C, D2);
        assert_eq!(
            a.admit(&ctx, C, D2).unwrap_err().code(),
            Code::PermissionDenied
        );
        assert_eq!(
            a.admit(&ctx, "tramado-bbbbbbbbbbbbbbbbbbbbbbbbbb", D1)
                .unwrap_err()
                .code(),
            Code::NotFound
        );
    }

    #[test]
    fn queued_requests_time_out_after_a_day_without_an_ignore() {
        let w = World::new();
        w.shared_class(C, &[]);
        let mut p = pol();
        p.ask_before_admit = true;
        w.push(p);
        let now = Now::current();
        let mut a = Admission::default();
        w.fake.knock(D1, "x", "10.0.0.7:22100");
        a.handle_pending_devices(&w.ctx(now)).unwrap();
        w.fake.offer(C, D1);
        a.handle_pending_folders(&w.ctx(now)).unwrap();
        a.sweep(&w.ctx(now.plus(QUEUE_TIMEOUT))).unwrap();
        assert!(w.fake.device(D1).is_none());
        assert!(w.fake.ignored_ids().is_empty());
        assert!(a.join_requests().is_empty());
    }

    #[test]
    fn decline_ignores_on_this_member_only() {
        let w = World::new();
        w.shared_class(C, &[]);
        let mut p = pol();
        p.ask_before_admit = true;
        w.push(p);
        let ctx = w.ctx(Now::current());
        let mut a = Admission::default();
        w.fake.knock(D1, "x", "10.0.0.7:22100");
        a.handle_pending_devices(&ctx).unwrap();
        w.fake.offer(C, D1);
        a.handle_pending_folders(&ctx).unwrap();
        a.decline(&ctx, C, D1).unwrap();
        assert_eq!(
            w.fake.ignored_ids(),
            vec![(D1.to_string(), "tramado".to_string())]
        );
        assert!(a.join_requests().is_empty());
    }

    #[test]
    fn offers_of_left_classes_are_dropped_and_unknown_ones_reported() {
        let w = World::new();
        w.shared_class(C, &[D1]);
        w.push(pol());
        w.registry
            .add_left_class("tramado-cccccccccccccccccccccccccc")
            .unwrap();
        let ctx = w.ctx(Now::current());
        let mut a = Admission::default();
        w.fake.offer("tramado-cccccccccccccccccccccccccc", D1);
        w.fake.offer("tramado-dddddddddddddddddddddddddd", D1);
        w.fake.offer("photos", D1);
        a.handle_pending_folders(&ctx).unwrap();
        let d = w.fake.device(D1).unwrap();
        assert_eq!(
            d["ignoredFolders"][0]["id"],
            "tramado-cccccccccccccccccccccccccc"
        );
        let ev = w.take_events();
        let offers: Vec<_> = ev
            .iter()
            .filter(|e| matches!(e, SyncEvent::FolderOffer { .. }))
            .collect();
        assert_eq!(offers.len(), 1);
        a.handle_pending_folders(&ctx).unwrap();
        assert!(w.take_events().is_empty(), "reported once");
        let _ = RosterDevice {
            device_id: D3.into(),
            member_id: String::new(),
            name: String::new(),
            device_name: String::new(),
            addresses: vec![],
        };
    }
}
