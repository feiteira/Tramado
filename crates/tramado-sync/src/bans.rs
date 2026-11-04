// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Ban effects, applied **declaratively** over every class at once (sync spec §18.1): the
//! effective bans the app pushed (`ClassPolicy.bannedDevices`) become, in one
//! `PUT /rest/config`: the device removed from that class's folder, an `ignoredFolders` entry
//! for the class on the device (contract test `ignored_folders_patch_shape` confirmed the
//! shape, §25 Q7), and a device-wide `remoteIgnoredDevices` entry named "tramado-ban" when
//! every tramado folder the device is configured for, or offers, bans it. Effects whose ban is
//! gone (unban) are removed. Calling it twice changes nothing the second time.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use tramado_base::error::AppResult;
use tramado_base::ids;

use crate::admission::{ignore_in_config, BAN_NAME};
use crate::appdata::{IgnoreReason, IgnoredRec};
use crate::ctx::Ctx;

pub fn apply_bans(ctx: &Ctx) -> AppResult<()> {
    let policies = ctx.policy.all();
    let retired = ctx.retired_ids();
    let pend = ctx.c.pending_folders().unwrap_or_default();
    ctx.writer.run(|| -> AppResult<()> {
        let mut cfg = ctx.c.config()?;
        let before = cfg.clone();
        let now = ctx.now.rfc3339();
        // (device, class) pairs that must be ignored
        let mut wanted: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (cls, p) in &policies {
            for d in &p.banned_devices {
                if d != ctx.me {
                    wanted.entry(d.clone()).or_default().insert(cls.clone());
                }
            }
        }
        let labels: BTreeMap<String, String> = cfg["folders"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|f| {
                Some((
                    f["id"].as_str()?.to_string(),
                    f["label"].as_str().unwrap_or_default().to_string(),
                ))
            })
            .collect();
        let label = |cls: &str| {
            policies
                .get(cls)
                .map(|p| p.label.clone())
                .filter(|l| !l.is_empty())
                .or_else(|| labels.get(cls).cloned())
                .unwrap_or_default()
        };

        // 1. folders: banned devices out of the class's folder
        if let Some(fs) = cfg["folders"].as_array_mut() {
            for f in fs {
                let id = f["id"].as_str().unwrap_or_default().to_string();
                if let Some(devs) = f["devices"].as_array_mut() {
                    devs.retain(|d| {
                        let dev = d["deviceID"].as_str().unwrap_or_default();
                        !wanted.get(dev).is_some_and(|c| c.contains(&id))
                    });
                }
            }
        }
        // 2. ignoredFolders on configured devices: wanted present, unwanted tramado ones gone
        if let Some(devs) = cfg["devices"].as_array_mut() {
            for d in devs {
                let dev = d["deviceID"].as_str().unwrap_or_default().to_string();
                let want = wanted.get(&dev).cloned().unwrap_or_default();
                let mut list = d["ignoredFolders"].as_array().cloned().unwrap_or_default();
                list.retain(|e| {
                    let id = e["id"].as_str().unwrap_or_default();
                    !ids::is_class_id(id)
                        || want.contains(id)
                        || retired.contains(id)
                        || !policies.contains_key(id)
                });
                for cls in &want {
                    if !list.iter().any(|e| e["id"] == cls.as_str()) {
                        list.push(json!({ "id": cls, "label": label(cls), "time": now }));
                    }
                }
                d["ignoredFolders"] = Value::Array(list);
            }
        }
        // 3. device-wide ignores: every tramado folder it is configured for, or offers, bans it
        let mut device_ignores: BTreeSet<String> = BTreeSet::new();
        for (dev, banning) in &wanted {
            let mut relevant: BTreeSet<String> = banning.clone();
            for f in before["folders"].as_array().into_iter().flatten() {
                let id = f["id"].as_str().unwrap_or_default();
                if ids::is_class_id(id) && crate::client::folder_devices(f).iter().any(|x| x == dev)
                {
                    relevant.insert(id.to_string());
                }
            }
            for (f, offers) in &pend {
                if ids::is_class_id(f) && offers.contains_key(dev) && !retired.contains(f) {
                    relevant.insert(f.clone());
                }
            }
            if relevant.iter().all(|c| banning.contains(c)) {
                device_ignores.insert(dev.clone());
            }
        }
        for dev in &device_ignores {
            ignore_in_config(&mut cfg, dev, BAN_NAME, &now);
        }
        let mut unbanned: Vec<String> = Vec::new();
        if let Some(list) = cfg["remoteIgnoredDevices"].as_array_mut() {
            list.retain(|e| {
                let dev = e["deviceID"].as_str().unwrap_or_default();
                let keep = e["name"] != BAN_NAME || device_ignores.contains(dev);
                if !keep {
                    unbanned.push(dev.to_string());
                }
                keep
            });
        }
        if cfg != before {
            ctx.c.put_config(&cfg)?;
            log::info!(
                "sync: bans applied ({} device-wide, {} lifted)",
                device_ignores.len(),
                unbanned.len()
            );
        }
        ctx.appdata.update_quiet(|a| {
            for dev in &device_ignores {
                let fresh =
                    !matches!(a.ignored.get(dev), Some(r) if r.reason == IgnoreReason::Banned);
                if fresh {
                    let strikes = a.ignored.get(dev).map(|r| r.strikes + 1).unwrap_or(1);
                    a.ignored.insert(
                        dev.clone(),
                        IgnoredRec {
                            at: ctx.now.ms,
                            until: None,
                            strikes,
                            reason: IgnoreReason::Banned,
                        },
                    );
                }
            }
            for dev in &unbanned {
                if a.ignored
                    .get(dev)
                    .is_some_and(|r| r.reason == IgnoreReason::Banned)
                {
                    a.ignored.remove(dev);
                }
            }
        });
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::testing::World;
    use crate::ctx::Now;
    use crate::fake::ME;
    use crate::invite::tests::{D1, D2};
    use crate::types::ClassPolicy;

    const C: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const G: &str = "tramado-gggggggggggggggggggggggggg";

    fn pol(id: &str, banned: &[&str]) -> ClassPolicy {
        ClassPolicy {
            class_id: id.into(),
            label: "TGDC".into(),
            ask_before_admit: false,
            roster: vec![],
            known_devices: vec![],
            banned_devices: banned.iter().map(|s| s.to_string()).collect(),
            updated_at: "2026-11-04T10:00:00.000Z".into(),
        }
    }

    #[test]
    fn ban_in_one_class_keeps_the_device_for_another() {
        let w = World::new();
        w.shared_class(C, &[D1, D2]);
        w.shared_class(G, &[D1]);
        w.push(pol(C, &[D1, D2]));
        w.push(pol(G, &[]));
        apply_bans(&w.ctx(Now::current())).unwrap();
        assert_eq!(w.fake.folder_devices(C), vec![ME.to_string()]);
        assert_eq!(
            w.fake.folder_devices(G),
            vec![ME.to_string(), D1.to_string()]
        );
        let d1 = w.fake.device(D1).unwrap();
        assert_eq!(d1["ignoredFolders"][0]["id"], C);
        assert_eq!(d1["ignoredFolders"][0]["label"], "TGDC");
        // D2 is banned everywhere it is: device-wide ignore
        assert!(w.fake.device(D2).is_none());
        assert_eq!(
            w.fake.ignored_ids(),
            vec![(D2.to_string(), "tramado-ban".to_string())]
        );
        assert!(w.appdata.read(|a| a.ignored[D2].until.is_none()));
    }

    #[test]
    fn idempotent_and_unban_removes_the_effects() {
        let w = World::new();
        w.shared_class(C, &[D1]);
        w.shared_class(G, &[D1]);
        w.push(pol(C, &[D1]));
        w.push(pol(G, &[]));
        apply_bans(&w.ctx(Now::current())).unwrap();
        w.fake.clear_calls();
        apply_bans(&w.ctx(Now::current())).unwrap();
        assert!(w.fake.writes().is_empty(), "a second run changes nothing");
        // unban in C: the ignoredFolders entry goes (rejoining needs the invite again)
        w.push(pol(C, &[]));
        apply_bans(&w.ctx(Now::current())).unwrap();
        assert_eq!(w.fake.device(D1).unwrap()["ignoredFolders"], json!([]));
        // a device-wide ban lifted
        w.push(pol(C, &[D2]));
        apply_bans(&w.ctx(Now::current())).unwrap();
        assert_eq!(w.fake.ignored_ids().len(), 1);
        w.push(pol(C, &[]));
        apply_bans(&w.ctx(Now::current())).unwrap();
        assert!(w.fake.ignored_ids().is_empty());
        assert!(w.appdata.read(|a| !a.ignored.contains_key(D2)));
    }

    #[test]
    fn user_ignores_and_left_class_entries_are_never_touched() {
        let w = World::new();
        w.shared_class(C, &[D1]);
        w.push(pol(C, &[]));
        w.registry.add_left_class(G).unwrap();
        w.fake.with(|s| {
            s.config["remoteIgnoredDevices"] = json!([{"deviceID": D2, "name": "my own", "address": "", "time": "x"}]);
            s.config["devices"][1]["ignoredFolders"] = json!([{"id": G, "label": "old", "time": "x"}, {"id": "photos", "label": "", "time": "x"}]);
        });
        apply_bans(&w.ctx(Now::current())).unwrap();
        assert_eq!(
            w.fake.ignored_ids(),
            vec![(D2.to_string(), "my own".to_string())]
        );
        assert_eq!(
            w.fake.device(D1).unwrap()["ignoredFolders"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
}
