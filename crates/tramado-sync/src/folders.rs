// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Folder mechanics (architecture §5.3 `folders.rs`): sharing a class (sync spec §6.1), joining
//! from a decoded invite with paused devices and rollback (§8), cancelling a join, accepting an
//! offered folder, leaving as a persisted background state and `finish_leaving` (§17), pausing.
//! Rotation and relocation are v1.1.

use std::collections::HashSet;
use std::path::Path;

use serde_json::json;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::ids;
use tramado_base::registry::{ClassEntry, Leaving};

use crate::client::folder_devices;
use crate::ctx::Ctx;
use crate::invite::Invite;
use crate::managed::{folder_create_body, ignore_lines};
use crate::reconcile::member_path;
use crate::types::{LeaveAfterwards, LeaveOptions, SyncEvent};

/// Leaving gives up waiting for a classmate after 30 days (§17).
pub const LEAVE_TIMEOUT_MS: u64 = 30 * 24 * 3600 * 1000;

/// A directory name made by the app (`sanitize` + `unique`): one plain segment.
pub fn valid_dir_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && !name.contains(['/', '\\'])
        && !name.chars().any(char::is_control)
}

/// Creates a folder paused, sets its ignores, then resumes it (§6.1 steps 2–4). On failure the
/// folder is deleted again.
pub fn create_folder(
    ctx: &Ctx,
    id: &str,
    label: &str,
    path: &Path,
    devices: &[String],
    ignores: &[String],
    unpause: bool,
) -> AppResult<()> {
    ctx.writer.run(|| {
        let body = folder_create_body(id, label, &path.to_string_lossy(), devices);
        ctx.c.add_folder(&body)?;
        let rest = (|| -> AppResult<()> {
            ctx.c.set_ignores(id, ignores)?;
            if unpause {
                ctx.c.patch_folder(id, &json!({ "paused": false }))?;
            }
            Ok(())
        })();
        if let Err(e) = rest {
            let _ = ctx.c.delete_folder(id);
            return Err(e);
        }
        Ok(())
    })
}

/// `sync_share_class` (§6.1). The caller started Syncthing.
pub fn share_class(ctx: &Ctx, class_id: &str, label: &str, unpause: bool) -> AppResult<ClassEntry> {
    let entry = ctx
        .class(class_id)
        .ok_or_else(|| AppError::not_found("no such class"))?;
    if entry.shared {
        return Err(AppError::conflict("the class is already shared"));
    }
    if entry.leaving.is_some() {
        return Err(AppError::conflict("the class is being left"));
    }
    if !entry.path.is_dir() {
        return Err(AppError::not_found("the class folder is missing"));
    }
    if let Some(f) = ctx.c.folder(class_id)? {
        let same = f["path"]
            .as_str()
            .is_some_and(|p| Path::new(p) == entry.path.as_path());
        if !same {
            return Err(AppError::conflict("the folder ID is taken by another path"));
        }
    } else {
        let existing = ctx.c.ignores(class_id).unwrap_or_default();
        create_folder(
            ctx,
            class_id,
            label,
            &entry.path,
            &[ctx.me.to_string()],
            &ignore_lines(entry.skip_audio, &entry.local_ignores, &existing),
            unpause,
        )?;
    }
    ctx.registry.update(class_id, |e| e.shared = true)
}

/// Removes devices that share no folder any more and are not bound to my own person.
fn drop_orphan_devices(ctx: &Ctx, keep: &HashSet<String>) -> AppResult<()> {
    let mine = ctx.my_person_devices();
    ctx.writer.run(|| {
        let folders = ctx.c.folders()?;
        let used: HashSet<String> = folders.iter().flat_map(folder_devices).collect();
        for d in ctx
            .c
            .devices()?
            .iter()
            .filter_map(|d| d["deviceID"].as_str())
        {
            if d != ctx.me && !used.contains(d) && !mine.contains(d) && !keep.contains(d) {
                ctx.c.delete_device(d)?;
            }
        }
        Ok(())
    })
}

/// `sync_join_class` after the code was decoded and Syncthing started (§8). `dir` =
/// `parent/dirName`.
pub fn join_class(
    ctx: &Ctx,
    inv: &Invite,
    dir: &Path,
    include_audio: bool,
    unpause: bool,
    mirror_dir: &Path,
) -> AppResult<ClassEntry> {
    if let Some(e) = ctx.registry.get(&inv.folder) {
        return Err(AppError::conflict("this class is already on this computer")
            .with_data(json!({ "classId": e.class_id })));
    }
    if dir.exists() {
        return Err(AppError::conflict("the folder exists").with_data(json!({ "path": dir })));
    }
    if ctx.c.folder(&inv.folder)?.is_some() {
        return Err(AppError::conflict("the folder ID is already configured"));
    }
    // rejoining a class left earlier: its old mirror goes first (§12.3)
    let _ = std::fs::remove_dir_all(mirror_dir);
    let mut added: Vec<String> = Vec::new();
    let result = ctx.writer.run(|| -> AppResult<()> {
        for (i, d) in inv.devices.iter().enumerate() {
            let mut addrs = d.addresses.clone();
            match ctx.c.device(&d.device_id)? {
                None => {
                    addrs.push("dynamic".to_string());
                    ctx.c.add_device(&json!({
                        "deviceID": d.device_id,
                        "name": if i == 0 { inv.inviter_name.clone() } else { String::new() },
                        "addresses": addrs, "compression": "metadata", "introducer": false,
                        "autoAcceptFolders": false, "paused": true
                    }))?;
                    added.push(d.device_id.clone());
                }
                Some(cur) => {
                    let mut all: Vec<String> = cur["addresses"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|a| a.as_str().map(str::to_string))
                        .collect();
                    for a in addrs
                        .into_iter()
                        .chain(std::iter::once("dynamic".to_string()))
                    {
                        if !all.contains(&a) {
                            all.push(a);
                        }
                    }
                    let ignored: Vec<serde_json::Value> = cur["ignoredFolders"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|e| e["id"] != inv.folder.as_str())
                        .cloned()
                        .collect();
                    ctx.c.patch_device(
                        &d.device_id,
                        &json!({ "addresses": all, "ignoredFolders": ignored }),
                    )?;
                }
            }
        }
        let mut devices = vec![ctx.me.to_string()];
        devices.extend(inv.devices.iter().map(|d| d.device_id.clone()));
        create_folder(
            ctx,
            &inv.folder,
            &inv.label,
            dir,
            &devices,
            &ignore_lines(!include_audio, &[], &[]),
            unpause,
        )?;
        // the offer exists before the first knock (§8)
        for d in &added {
            ctx.c.patch_device(d, &json!({ "paused": false }))?;
        }
        Ok(())
    });
    if let Err(e) = result {
        ctx.writer.run(|| {
            let _ = ctx.c.delete_folder(&inv.folder);
            for d in &added {
                let _ = ctx.c.delete_device(d);
            }
        });
        return Err(e);
    }
    let mut entry = ClassEntry::new(&inv.folder, dir.to_path_buf());
    entry.shared = true;
    entry.joining = true;
    entry.skip_audio = !include_audio;
    if let Err(e) = ctx.registry.insert(entry.clone()) {
        ctx.writer.run(|| {
            let _ = ctx.c.delete_folder(&inv.folder);
            for d in &added {
                let _ = ctx.c.delete_device(d);
            }
        });
        return Err(e);
    }
    Ok(entry)
}

/// Removes `dir` when it holds nothing but `.stfolder`, `.stignore`, `.stversions` and my own
/// member file (a cancelled join).
fn remove_if_untouched(dir: &Path, me: &str) -> bool {
    let own = format!(".tramado/members/{me}.json");
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else {
            return false;
        };
        for e in rd.flatten() {
            let p = e.path();
            let rel = p
                .strip_prefix(dir)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let Ok(ft) = e.file_type() else { return false };
            if ft.is_dir() {
                if rel == ".stfolder" || rel == ".stversions" {
                    continue;
                }
                if rel == ".tramado" || rel == ".tramado/members" {
                    stack.push(p);
                    continue;
                }
                return false;
            }
            if rel != ".stignore" && rel != own {
                return false;
            }
        }
    }
    std::fs::remove_dir_all(dir).is_ok()
}

/// `sync_cancel_join` (§8).
pub fn cancel_join(ctx: &Ctx, class_id: &str, keep: &HashSet<String>) -> AppResult<()> {
    let entry = ctx
        .class(class_id)
        .ok_or_else(|| AppError::not_found("no such class"))?;
    if !entry.joining {
        return Err(AppError::conflict("the class is not joining"));
    }
    ctx.writer.run(|| ctx.c.delete_folder(class_id))?;
    drop_orphan_devices(ctx, keep)?;
    remove_if_untouched(&entry.path, ctx.me);
    ctx.registry.remove(class_id)?;
    ctx.policy.remove(class_id)?;
    Ok(())
}

/// `sync_accept_folder`: an offered, unknown folder, created with devices `[me, offeredBy]`;
/// the offer must be pending (§9.5).
pub fn accept_folder(
    ctx: &Ctx,
    folder_id: &str,
    offered_by: &str,
    label: &str,
    dir: &Path,
    include_audio: bool,
    unpause: bool,
) -> AppResult<ClassEntry> {
    if !ids::is_class_id(folder_id) {
        return Err(AppError::invalid("not a class ID"));
    }
    if ctx.registry.get(folder_id).is_some() || ctx.c.folder(folder_id)?.is_some() {
        return Err(AppError::conflict("this class is already on this computer"));
    }
    if dir.exists() {
        return Err(AppError::conflict("the folder exists"));
    }
    let pend = ctx.c.pending_folders()?;
    if !pend
        .get(folder_id)
        .is_some_and(|o| o.contains_key(offered_by))
    {
        return Err(AppError::new(
            Code::PermissionDenied,
            "that folder is not offered",
        ));
    }
    let label = label.chars().take(120).collect::<String>();
    create_folder(
        ctx,
        folder_id,
        &label,
        dir,
        &[ctx.me.to_string(), offered_by.to_string()],
        &ignore_lines(!include_audio, &[], &[]),
        unpause,
    )?;
    let mut entry = ClassEntry::new(folder_id, dir.to_path_buf());
    entry.shared = true;
    entry.joining = true;
    entry.skip_audio = !include_audio;
    if let Err(e) = ctx.registry.insert(entry.clone()) {
        let _ = ctx.writer.run(|| ctx.c.delete_folder(folder_id));
        return Err(e);
    }
    Ok(entry)
}

/// `sync_leave_class` (§17): persists `leaving`; `finish_leaving` runs later.
pub fn leave_class(ctx: &Ctx, class_id: &str, opts: LeaveOptions) -> AppResult<()> {
    let entry = ctx
        .class(class_id)
        .ok_or_else(|| AppError::not_found("no such class"))?;
    if !entry.shared {
        return Err(AppError::conflict("the class is not shared"));
    }
    let afterwards = match opts.afterwards {
        LeaveAfterwards::KeepLocal => "keepLocal",
        LeaveAfterwards::Trash => "trash",
    };
    ctx.registry.update(class_id, |e| {
        e.leaving = Some(Leaving {
            since: ctx.now.instant(),
            afterwards: afterwards.to_string(),
        });
        e.joining = false;
    })?;
    Ok(())
}

/// `finish_leaving(cls)` (§17): once another member holds the deletion of my member file (or
/// 30 days passed), the folder goes, the class is retired, and the directory is trashed or kept
/// as a local class (the app forks it). Returns whether the class finished leaving.
pub fn finish_leaving(
    ctx: &Ctx,
    class_id: &str,
    keep: &HashSet<String>,
    trash: &dyn Fn(&Path) -> AppResult<()>,
    mirror_dir: &Path,
) -> AppResult<bool> {
    let Some(entry) = ctx.class(class_id) else {
        return Ok(false);
    };
    let Some(leaving) = entry.leaving.clone() else {
        return Ok(false);
    };
    let since = tramado_base::time::parse_rfc3339(&leaving.since)
        .unwrap_or(0)
        .max(0) as u64;
    let delivered = match ctx.c.db_file(class_id, &member_path(ctx.me))? {
        Some(f) => !f.holders().is_empty() && f.global.as_ref().is_some_and(|g| g.deleted),
        None => false,
    };
    if !delivered && ctx.now.ms.saturating_sub(since) < LEAVE_TIMEOUT_MS {
        return Ok(false);
    }
    let label = ctx.label(class_id);
    ctx.writer.run(|| ctx.c.delete_folder(class_id))?;
    let devices: Vec<String> = ctx
        .c
        .devices()?
        .iter()
        .filter_map(|d| d["deviceID"].as_str().map(str::to_string))
        .filter(|d| d != ctx.me)
        .collect();
    for d in &devices {
        ctx.add_ignored_folder(d, class_id, &label)?;
    }
    drop_orphan_devices(ctx, keep)?;
    ctx.policy.remove(class_id)?;
    ctx.appdata.update_quiet(|a| {
        a.seen_member.remove(class_id);
        a.proof_at.remove(class_id);
        a.guard_paused.remove(class_id);
        a.user_paused.remove(class_id);
    });
    if leaving.afterwards == "trash" {
        if let Err(e) = trash(&entry.path) {
            log::warn!("sync: could not move a left class to the trash: {e}");
        }
        let _ = std::fs::remove_dir_all(mirror_dir);
        ctx.registry.remove(class_id)?;
    } else {
        // the app forks it (new idNonce and classId, `class_fork`)
        ctx.registry.update(class_id, |e| {
            e.shared = false;
            e.joining = false;
            e.leaving = None;
        })?;
    }
    // last: from now on offers of this ID are dropped silently (§9.2); the devices' ignoredFolders
    // entries above already keep them from showing as pending meanwhile
    ctx.registry.add_left_class(class_id)?;
    log::info!("sync: finished leaving {}", ids::short_id(class_id));
    ctx.emit(SyncEvent::Left {
        class_id: class_id.to_string(),
        afterwards: if leaving.afterwards == "trash" {
            LeaveAfterwards::Trash
        } else {
            LeaveAfterwards::KeepLocal
        },
    });
    Ok(true)
}

/// `sync_pause_class` (remembered across restarts).
pub fn pause_class(ctx: &Ctx, class_id: &str, paused: bool, effective: bool) -> AppResult<()> {
    if ctx.class(class_id).filter(|e| e.shared).is_none() {
        return Err(AppError::not_found("no such shared class"));
    }
    ctx.appdata.update(|a| {
        if paused {
            a.user_paused.insert(class_id.to_string());
        } else {
            a.user_paused.remove(class_id);
        }
    })?;
    ctx.writer.run(|| {
        ctx.c
            .patch_folder(class_id, &json!({ "paused": effective }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::testing::World;
    use crate::ctx::Now;
    use crate::fake::ME;
    use crate::invite::tests::{code, invite_json, D1, D2, F};

    #[test]
    fn share_creates_paused_sets_ignores_then_resumes() {
        let w = World::new();
        let root = w.dir.path().join("TGDC");
        std::fs::create_dir_all(&root).unwrap();
        w.registry.insert(ClassEntry::new(F, root.clone())).unwrap();
        let ctx = w.ctx(Now::current());
        let e = share_class(&ctx, F, "TGDC", true).unwrap();
        assert!(e.shared);
        let calls: Vec<String> = w
            .fake
            .writes()
            .iter()
            .map(|(m, p, _)| format!("{} {}", m.as_str(), p))
            .collect();
        assert_eq!(calls[0], "POST /rest/config/folders");
        let post = w
            .fake
            .calls()
            .into_iter()
            .find(|(m, p, _)| *m == crate::client::Method::Post && p == "/rest/config/folders")
            .unwrap();
        assert_eq!(post.2.unwrap()["paused"], true);
        let order: Vec<String> = w
            .fake
            .calls()
            .iter()
            .filter(|(m, _, _)| *m != crate::client::Method::Get)
            .map(|(m, p, _)| format!("{} {}", m.as_str(), p.split('?').next().unwrap()))
            .collect();
        assert_eq!(
            order,
            vec![
                "POST /rest/config/folders",
                "POST /rest/db/ignores",
                format!("PATCH /rest/config/folders/{F}").as_str()
            ]
        );
        assert_eq!(w.fake.folder_devices(F), vec![ME.to_string()]);
        assert_eq!(
            share_class(&ctx, F, "TGDC", true).unwrap_err().code(),
            Code::Conflict
        );
    }

    #[test]
    fn join_adds_only_the_code_devices_paused_then_resumes_them() {
        let w = World::new();
        let ctx = w.ctx(Now::current());
        let inv = crate::invite::decode(&code(&invite_json(&[D1, D2])), Some(ME)).unwrap();
        let dir = w.dir.path().join("classes").join("TGDC");
        let mirror = w.dir.path().join("mirror");
        let e = join_class(&ctx, &inv, &dir, false, true, &mirror).unwrap();
        assert!(e.joining && e.shared && e.skip_audio);
        assert_eq!(
            w.fake.folder_devices(F),
            vec![ME.to_string(), D1.to_string(), D2.to_string()]
        );
        let d1 = w.fake.device(D1).unwrap();
        assert_eq!(d1["paused"], false);
        assert_eq!(d1["name"], "Ana Ribeiro");
        assert!(d1["addresses"]
            .as_array()
            .unwrap()
            .contains(&json!("dynamic")));
        let posts: Vec<_> = w
            .fake
            .calls()
            .into_iter()
            .filter(|(_, p, _)| p == "/rest/config/devices")
            .collect();
        assert!(
            posts
                .iter()
                .all(|(_, _, b)| b.as_ref().unwrap()["paused"] == true),
            "added paused"
        );
        let ign = w.fake.with(|s| s.ignores[F].clone());
        assert!(ign.contains(&"(?d)/**/audio.webm".to_string()));
        assert!(w.registry.get(F).is_some());
        // again: CONFLICT
        assert_eq!(
            join_class(&ctx, &inv, &dir, false, true, &mirror)
                .unwrap_err()
                .code(),
            Code::Conflict
        );
    }

    #[test]
    fn a_failed_join_rolls_back() {
        let w = World::new();
        let ctx = w.ctx(Now::current());
        let inv = crate::invite::decode(&code(&invite_json(&[D1])), Some(ME)).unwrap();
        w.fake.with(|s| s.fail.push("/rest/db/ignores".into()));
        let dir = w.dir.path().join("TGDC");
        assert!(join_class(&ctx, &inv, &dir, true, true, &w.dir.path().join("m")).is_err());
        assert!(w.fake.device(D1).is_none(), "added devices are deleted");
        assert!(w.fake.folder_devices(F).is_empty(), "the folder is deleted");
        assert!(w.registry.get(F).is_none());
    }

    #[test]
    fn cancel_join_removes_folder_devices_and_untouched_dir() {
        let w = World::new();
        let ctx = w.ctx(Now::current());
        let inv = crate::invite::decode(&code(&invite_json(&[D1])), Some(ME)).unwrap();
        let dir = w.dir.path().join("TGDC");
        join_class(&ctx, &inv, &dir, true, true, &w.dir.path().join("m")).unwrap();
        std::fs::create_dir_all(dir.join(".stfolder")).unwrap();
        std::fs::create_dir_all(dir.join(".tramado/members")).unwrap();
        std::fs::write(dir.join(format!(".tramado/members/{ME}.json")), "{}").unwrap();
        cancel_join(&ctx, F, &HashSet::new()).unwrap();
        assert!(w.fake.folder_devices(F).is_empty());
        assert!(w.fake.device(D1).is_none());
        assert!(!dir.exists());
        assert!(w.registry.get(F).is_none());
    }

    #[test]
    fn leave_waits_for_a_holder_of_the_deletion_then_retires_the_class() {
        let w = World::new();
        w.shared_class(F, &[D1]);
        let now = Now::current();
        let ctx = w.ctx(now);
        leave_class(
            &ctx,
            F,
            LeaveOptions {
                afterwards: LeaveAfterwards::KeepLocal,
            },
        )
        .unwrap();
        let none = |_: &Path| -> AppResult<()> { Ok(()) };
        let mirror = w.dir.path().join("m");
        assert!(!finish_leaving(&ctx, F, &HashSet::new(), &none, &mirror).unwrap());
        w.fake.set_file(
            F,
            &member_path(ME),
            json!({
            "availability": [{"id": D1, "fromTemporary": false}],
            "global": {"deleted": true, "modifiedBy": ids::short_id(ME)}}),
        );
        assert!(finish_leaving(&ctx, F, &HashSet::new(), &none, &mirror).unwrap());
        assert!(w.events.lock().unwrap().contains(&SyncEvent::Left {
            class_id: F.to_string(),
            afterwards: LeaveAfterwards::KeepLocal,
        }));
        // the TS `SyncEvent` shape (platform/types/sync.ts)
        assert_eq!(
            serde_json::to_value(SyncEvent::Left {
                class_id: F.to_string(),
                afterwards: LeaveAfterwards::KeepLocal,
            })
            .unwrap(),
            json!({ "type": "left", "classId": F, "afterwards": "keepLocal" })
        );
        assert!(w.fake.folder_devices(F).is_empty());
        assert!(w.registry.left_classes().contains(&F.to_string()));
        let e = w.registry.get(F).unwrap();
        assert!(!e.shared && e.leaving.is_none());
        // D1 shares nothing any more
        assert!(w.fake.device(D1).is_none());
    }

    #[test]
    fn leave_with_trash_after_30_days_without_anyone() {
        let w = World::new();
        w.shared_class(F, &[D1]);
        let now = Now::current();
        leave_class(
            &w.ctx(now),
            F,
            LeaveOptions {
                afterwards: LeaveAfterwards::Trash,
            },
        )
        .unwrap();
        let trashed = std::sync::Mutex::new(Vec::new());
        let t = |p: &Path| -> AppResult<()> {
            trashed.lock().unwrap().push(p.to_path_buf());
            Ok(())
        };
        let later = w.ctx(now.plus(std::time::Duration::from_millis(LEAVE_TIMEOUT_MS)));
        assert!(finish_leaving(&later, F, &HashSet::new(), &t, &w.dir.path().join("m")).unwrap());
        assert_eq!(trashed.lock().unwrap().len(), 1);
        assert!(w.registry.get(F).is_none());
        assert!(w.events.lock().unwrap().contains(&SyncEvent::Left {
            class_id: F.to_string(),
            afterwards: LeaveAfterwards::Trash,
        }));
    }

    #[test]
    fn accept_needs_a_pending_offer() {
        let w = World::new();
        let ctx = w.ctx(Now::current());
        w.fake.add_device(D1);
        let dir = w.dir.path().join("X");
        assert_eq!(
            accept_folder(&ctx, F, D1, "X", &dir, true, true)
                .unwrap_err()
                .code(),
            Code::PermissionDenied
        );
        w.fake.offer(F, D1);
        accept_folder(&ctx, F, D1, "X", &dir, true, true).unwrap();
        assert_eq!(
            w.fake.folder_devices(F),
            vec![ME.to_string(), D1.to_string()]
        );
    }

    #[test]
    fn dir_names_are_single_segments() {
        assert!(valid_dir_name("Teoria Geral do Direito Civil"));
        for bad in ["", ".", "..", ".hidden", "a/b", "a\\b", "x\ny"] {
            assert!(!valid_dir_name(bad), "{bad:?}");
        }
    }
}
