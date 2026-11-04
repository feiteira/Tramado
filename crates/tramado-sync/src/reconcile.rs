// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Roster reconciliation (sync spec §10): every member makes its Syncthing config match the
//! class roster the app pushed (`ClassPolicy.roster`, already trust-checked by TS). Rust
//! re-checks each roster device's member file itself before adding it (§9.5), keeps devices
//! whose member file is only briefly untrusted, and drops devices that `left()` or are
//! `stuck_joiner()`s. Runs on start, on every policy push, after gap detection and every 60 s,
//! and ends with `apply_bans()`.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde_json::{json, Value};
use tramado_base::error::AppResult;
use tramado_base::ids;

use crate::admission::{Admission, BAN_NAME};
use crate::appdata::{IgnoreReason, WEEK_MS};
use crate::client::{devices_body, folder_devices};
use crate::ctx::Ctx;

/// The member file of a device (folder spec §8.3).
pub fn member_path(dev: &str) -> String {
    format!(".tramado/members/{dev}.json")
}

/// §9.5: `!local.deleted && local.modifiedBy == shortId(D)` for `members/<D>.json`.
pub fn member_file_ok(ctx: &Ctx, class: &str, dev: &str) -> bool {
    match ctx.c.db_file(class, &member_path(dev)) {
        Ok(Some(f)) => f
            .local
            .is_some_and(|l| !l.deleted && l.modified_by.as_deref() == Some(ids::short_id(dev))),
        _ => false,
    }
}

/// `left(cls, d)`: my local copy has no member file of `d`, `d` was a member here, and the
/// global deletion of its member file was made by `d` itself.
pub fn left(ctx: &Ctx, class: &str, dev: &str) -> bool {
    let local_absent = ctx
        .registry
        .root(class)
        .map(|r| !tramado_base::files::join_rel(&r, &member_path(dev)).exists())
        .unwrap_or(false);
    if !local_absent || !ctx.appdata.read(|a| a.has_seen(class, dev)) {
        return false;
    }
    match ctx.c.db_file(class, &member_path(dev)) {
        Ok(Some(f)) => f
            .global
            .is_some_and(|g| g.deleted && g.modified_by.as_deref() == Some(ids::short_id(dev))),
        _ => false,
    }
}

/// `stuck_joiner(cls, d)`: never had a trusted member file here, no recent proof, not connected.
pub fn stuck_joiner(ctx: &Ctx, class: &str, dev: &str, connected: &HashSet<String>) -> bool {
    let (seen, proof) = ctx.appdata.read(|a| {
        (
            a.has_seen(class, dev),
            a.proof_at.get(class).and_then(|m| m.get(dev)).copied(),
        )
    });
    !seen
        && proof.is_none_or(|at| ctx.now.ms.saturating_sub(at) >= WEEK_MS)
        && !connected.contains(dev)
}

fn connected_devices(ctx: &Ctx) -> HashSet<String> {
    ctx.c
        .connections()
        .ok()
        .and_then(|v| v.as_object().cloned())
        .map(|m| {
            m.into_iter()
                .filter(|(_, c)| c["connected"].as_bool().unwrap_or(false))
                .map(|(d, _)| d)
                .collect()
        })
        .unwrap_or_default()
}

fn dedupe(list: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    list.into_iter()
        .filter(|a| seen.insert(a.clone()))
        .collect()
}

/// Reconciles one class. `discovered` = addresses found by the discovery lookup (§11.1).
pub fn reconcile(
    ctx: &Ctx,
    adm: &Admission,
    class: &str,
    discovered: &BTreeMap<String, Vec<String>>,
) -> AppResult<()> {
    let Some(entry) = ctx.class(class).filter(|e| e.shared) else {
        return Ok(());
    };
    let Some(pol) = ctx.policy.get(class) else {
        return crate::bans::apply_bans(ctx);
    };
    let widen = ctx.policy_received(class) && entry.leaving.is_none();
    let banned: HashSet<String> = pol.banned_devices.iter().cloned().collect();
    // §9.5: only roster devices whose member file this device's Syncthing attributes to them
    let roster: BTreeMap<String, &crate::types::RosterDevice> = pol
        .roster
        .iter()
        .filter(|m| m.device_id != ctx.me && ids::is_device_id(&m.device_id))
        .filter(|m| member_file_ok(ctx, class, &m.device_id))
        .map(|m| (m.device_id.clone(), m))
        .collect();
    let connected = connected_devices(ctx);
    let mine = ctx.my_person_devices();
    ctx.writer.run(|| -> AppResult<()> {
        let Some(f) = ctx.c.folder(class)? else {
            return Ok(());
        };
        let cfg = ctx.c.config()?;
        let devs: BTreeMap<String, Value> = cfg["devices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|d| Some((d["deviceID"].as_str()?.to_string(), d.clone())))
            .collect();
        let ignored: Vec<String> = cfg["remoteIgnoredDevices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|d| d["deviceID"].as_str().map(str::to_string))
            .collect();

        if widen {
            // a member we once refused is legitimate: un-ignore first (one PUT)
            let unignore: Vec<&String> = roster
                .keys()
                .filter(|d| !banned.contains(*d) && ignored.contains(d))
                .filter(|d| {
                    ctx.appdata
                        .read(|a| a.ignored.get(*d).map(|r| r.reason))
                        != Some(IgnoreReason::Banned)
                })
                .collect();
            if !unignore.is_empty() {
                let mut c2 = ctx.c.config()?;
                if let Some(list) = c2["remoteIgnoredDevices"].as_array_mut() {
                    list.retain(|e| {
                        !unignore
                            .iter()
                            .any(|d| e["deviceID"].as_str() == Some(d.as_str()))
                            || e["name"] == BAN_NAME
                    });
                }
                ctx.c.put_config(&c2)?;
            }
            for (d, m) in &roster {
                if banned.contains(d) {
                    continue;
                }
                let addrs = dedupe(
                    m.addresses
                        .iter()
                        .cloned()
                        .chain(discovered.get(d).cloned().unwrap_or_default())
                        .chain(std::iter::once("dynamic".to_string())),
                );
                match devs.get(d) {
                    None => {
                        let mut name = m.name.clone();
                        if !m.device_name.is_empty() {
                            name = format!("{} ({})", m.name, m.device_name);
                        }
                        ctx.c.add_device(&json!({
                            "deviceID": d, "name": name, "addresses": addrs,
                            "compression": "metadata", "introducer": false, "autoAcceptFolders": false
                        }))?;
                    }
                    Some(cur) => {
                        let have: BTreeSet<String> = cur["addresses"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|a| a.as_str().map(str::to_string))
                            .collect();
                        let want: BTreeSet<String> = addrs.iter().cloned().collect();
                        if have != want {
                            ctx.c.patch_device(d, &json!({ "addresses": addrs }))?;
                        }
                    }
                }
            }
        }
        // remember roster members that passed the check (left() needs them)
        ctx.appdata.update_quiet(|a| {
            let set = a.seen_member.entry(class.to_string()).or_default();
            for d in roster.keys() {
                set.insert(d.clone());
            }
        });

        let current = folder_devices(&f);
        let mut keep: Vec<String> = vec![ctx.me.to_string()];
        for d in current.iter().filter(|d| *d != ctx.me) {
            if banned.contains(d) {
                continue;
            }
            if roster.contains_key(d) {
                keep.push(d.clone());
            } else if left(ctx, class, d) || stuck_joiner(ctx, class, d, &connected) {
                log::info!("sync: dropping {} from {}", ids::short_id(d), ids::short_id(class));
                continue;
            } else {
                keep.push(d.clone()); // a newcomer, or a member whose file is untrusted for now
            }
        }
        if widen {
            for d in roster.keys() {
                if !banned.contains(d) && !keep.contains(d) {
                    keep.push(d.clone());
                }
            }
        }
        let have: BTreeSet<&String> = current.iter().collect();
        let want: BTreeSet<&String> = keep.iter().collect();
        if have != want {
            ctx.c
                .patch_folder(class, &json!({ "devices": devices_body(&keep) }))?;
        }

        // devices that share no folder any more
        let folders = ctx.c.folders()?;
        let in_folders: HashSet<String> = folders.iter().flat_map(folder_devices).collect();
        for d in ctx.c.devices()?.iter().filter_map(|d| d["deviceID"].as_str()) {
            if d != ctx.me
                && !in_folders.contains(d)
                && !adm.provisional.contains_key(d)
                && !mine.contains(d)
            {
                ctx.c.delete_device(d)?;
            }
        }
        Ok(())
    })?;
    crate::bans::apply_bans(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::testing::World;
    use crate::ctx::Now;
    use crate::fake::ME;
    use crate::invite::tests::{D1, D2};
    use crate::types::{ClassPolicy, RosterDevice};

    const C: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn member(d: &str) -> RosterDevice {
        RosterDevice {
            device_id: d.into(),
            member_id: format!("m{}", &d[..3]).to_lowercase(),
            name: "Bruno Costa".into(),
            device_name: "laptop".into(),
            addresses: vec!["tcp://10.0.0.9:22100".into()],
        }
    }

    fn pol(roster: Vec<RosterDevice>) -> ClassPolicy {
        ClassPolicy {
            class_id: C.into(),
            label: "TGDC".into(),
            ask_before_admit: false,
            roster,
            known_devices: vec![],
            banned_devices: vec![],
            updated_at: "2026-11-04T10:00:00.000Z".into(),
        }
    }

    fn trusted_member_file(w: &World, d: &str) {
        w.fake.set_file(
            C,
            &member_path(d),
            json!({"local": {"modifiedBy": ids::short_id(d), "deleted": false},
                   "global": {"modifiedBy": ids::short_id(d), "deleted": false}}),
        );
    }

    #[test]
    fn roster_device_is_added_only_when_its_member_file_is_its_own() {
        let w = World::new();
        w.shared_class(C, &[]);
        w.push(pol(vec![member(D1), member(D2)]));
        trusted_member_file(&w, D1);
        // D2's member file was written by someone else (a script in the webview cannot widen)
        w.fake.set_file(
            C,
            &member_path(D2),
            json!({"local": {"modifiedBy": ids::short_id(D1), "deleted": false}}),
        );
        let a = Admission::default();
        reconcile(&w.ctx(Now::current()), &a, C, &BTreeMap::new()).unwrap();
        let devs = w.fake.folder_devices(C);
        assert!(devs.contains(&D1.to_string()) && !devs.contains(&D2.to_string()));
        let d = w.fake.device(D1).unwrap();
        assert_eq!(d["name"], "Bruno Costa (laptop)");
        assert_eq!(d["addresses"], json!(["tcp://10.0.0.9:22100", "dynamic"]));
        assert!(w.fake.device(D2).is_none());
        assert!(w.appdata.read(|a| a.has_seen(C, D1)));
    }

    #[test]
    fn untrusted_member_file_for_three_cycles_patches_nothing() {
        let w = World::new();
        w.shared_class(C, &[D1]);
        w.push(pol(vec![member(D1)]));
        trusted_member_file(&w, D1);
        // the member file exists locally
        let root = w.registry.root(C).unwrap();
        std::fs::write(root.join(member_path(D1)), "{}").unwrap();
        let a = Admission::default();
        reconcile(&w.ctx(Now::current()), &a, C, &BTreeMap::new()).unwrap();
        w.fake.clear_calls();
        // a foreign write makes it untrusted: the app drops it from the roster
        w.push(pol(vec![]));
        w.fake.set_file(C, &member_path(D1), json!({"local": {"modifiedBy": "ZZZZZZZ", "deleted": false},
                                                    "global": {"modifiedBy": "ZZZZZZZ", "deleted": false}}));
        for _ in 0..3 {
            reconcile(&w.ctx(Now::current()), &a, C, &BTreeMap::new()).unwrap();
        }
        assert!(w
            .fake
            .writes()
            .iter()
            .all(|(_, p, _)| !p.starts_with("/rest/config/folders")));
        assert!(w.fake.folder_devices(C).contains(&D1.to_string()));
    }

    #[test]
    fn a_device_that_left_by_itself_is_removed_and_one_deleted_by_others_is_kept() {
        let w = World::new();
        w.shared_class(C, &[D1, D2]);
        w.push(pol(vec![member(D1), member(D2)]));
        trusted_member_file(&w, D1);
        trusted_member_file(&w, D2);
        let a = Admission::default();
        reconcile(&w.ctx(Now::current()), &a, C, &BTreeMap::new()).unwrap();
        // both member files are gone locally; D1 deleted its own, D2's was deleted by D1
        w.push(pol(vec![]));
        w.fake.set_file(C, &member_path(D1), json!({"local": {"modifiedBy": ids::short_id(D1), "deleted": true},
                                                    "global": {"modifiedBy": ids::short_id(D1), "deleted": true}}));
        w.fake.set_file(C, &member_path(D2), json!({"local": {"modifiedBy": ids::short_id(D1), "deleted": true},
                                                    "global": {"modifiedBy": ids::short_id(D1), "deleted": true}}));
        reconcile(&w.ctx(Now::current()), &a, C, &BTreeMap::new()).unwrap();
        let devs = w.fake.folder_devices(C);
        assert!(!devs.contains(&D1.to_string()), "left() → dropped");
        assert!(
            devs.contains(&D2.to_string()),
            "a deletion by anyone else is ignored"
        );
        assert!(
            w.fake.device(D1).is_none(),
            "a device that shares no folder is removed"
        );
    }

    #[test]
    fn stuck_joiner_is_dropped_but_a_recent_proof_or_connection_keeps_it() {
        let w = World::new();
        w.shared_class(C, &[D1, D2]);
        w.push(pol(vec![]));
        let now = Now::current();
        w.appdata
            .update(|a| {
                a.proof_at
                    .entry(C.into())
                    .or_default()
                    .insert(D2.into(), now.ms);
            })
            .unwrap();
        let a = Admission::default();
        reconcile(&w.ctx(now), &a, C, &BTreeMap::new()).unwrap();
        let devs = w.fake.folder_devices(C);
        assert!(!devs.contains(&D1.to_string()) && devs.contains(&D2.to_string()));
        // eight days later D2 is stuck too, unless connected
        w.fake.connect(D2);
        reconcile(
            &w.ctx(now.plus(std::time::Duration::from_millis(8 * 24 * 3600 * 1000))),
            &a,
            C,
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(w.fake.folder_devices(C).contains(&D2.to_string()));
        assert_eq!(w.fake.folder_devices(C)[0], ME);
    }

    #[test]
    fn startup_rule_reconcile_only_narrows() {
        let w = World::new();
        w.shared_class(C, &[D2]);
        let mut p = pol(vec![member(D1)]);
        p.banned_devices = vec![D2.into()];
        w.policy.set(p).unwrap();
        trusted_member_file(&w, D1);
        let fresh = crate::policy::PolicyStore::load(&w.dir.path().join("st"));
        let ctx = Ctx {
            policy: &fresh,
            ..w.ctx(Now::current())
        };
        reconcile(&ctx, &Admission::default(), C, &BTreeMap::new()).unwrap();
        assert_eq!(w.fake.folder_devices(C), vec![ME.to_string()]);
        assert!(w.fake.device(D1).is_none());
    }
}
