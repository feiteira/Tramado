// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Self-heal of this device's own files (sync spec §12.3, folder spec §10, architecture §5.3).
//!
//! `ClassFs` keeps a private mirror of every own machine file ≤ 1 MiB it wrote (never
//! `transcript.*`; for `audio.webm` only `{size, sha256}`). When a change event shows that one
//! of **my** files (its mirror exists) was modified or deleted by anyone else, and its SHA-256
//! now differs from the mirror's, the file is rewritten from the mirror (`audio.webm` is restored
//! from the local trashcan) and `foreignWrite` is emitted. A path I deleted myself has no mirror
//! any more, so it is never restored. Claim and presence files past their retention are left.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::Value;
use tramado_base::classfs::{ClassFs, MirrorMeta};
use tramado_base::error::AppResult;
use tramado_base::{files, ids};

use crate::ctx::Ctx;
use crate::types::SyncEvent;

const DAY: Duration = Duration::from_secs(24 * 3600);
const WEEK: Duration = Duration::from_secs(7 * 24 * 3600);

fn is_transcript(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    matches!(name, "transcript.json" | "transcript.md" | "transcript.vtt")
}

fn meta_path(mirror: &Path) -> PathBuf {
    let mut p = mirror.as_os_str().to_owned();
    p.push(".meta.json");
    PathBuf::from(p)
}

fn age(p: &Path) -> Duration {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .unwrap_or_default()
}

/// Claims and presence files past their retention are never restored (folder spec §8.10, §9.2).
fn past_retention(path: &str, mirror: &Path) -> bool {
    if path.starts_with(".tramado/presence/") {
        return age(mirror) > DAY;
    }
    if path.starts_with(".tramado/claims/") {
        let status = std::fs::read(mirror)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v["status"].as_str().map(str::to_string))
            .unwrap_or_default();
        let keep = if status == "failed" || status == "released" {
            DAY
        } else {
            WEEK
        };
        return age(mirror) > keep;
    }
    false
}

/// Restores `audio.webm` from the local trashcan: the newest kept version with the mirrored size.
fn restore_audio(ctx: &Ctx, class: &str, path: &str, meta: &MirrorMeta) -> AppResult<bool> {
    let versions = ctx.c.versions(class)?;
    let Some(list) = versions.get(path) else {
        return Ok(false);
    };
    let best = list
        .iter()
        .filter(|v| v["size"].as_u64() == Some(meta.size))
        .filter_map(|v| v["versionTime"].as_str().map(str::to_string))
        .max();
    let Some(t) = best else {
        return Ok(false);
    };
    let r = ctx.c.restore_versions(class, &[(path.to_string(), t)])?;
    Ok(r.as_object().is_none_or(|m| m.is_empty()))
}

/// Re-judges one own path after a change by someone else. Returns the `foreignWrite` event to
/// emit, or `None` when the path is not mine or nothing differs.
pub fn heal(
    ctx: &Ctx,
    fs: &ClassFs,
    class: &str,
    path: &str,
    modified_by: &str,
) -> Option<SyncEvent> {
    if is_transcript(path) {
        return None;
    }
    let mirror = fs.mirror_path(class, path);
    let meta = meta_path(&mirror);
    let root = ctx.registry.root(class).ok()?;
    let abs = files::join_rel(&root, path);
    let current = std::fs::read(&abs).ok();
    let healed = if mirror.is_file() {
        if past_retention(path, &mirror) {
            return None;
        }
        let want = std::fs::read(&mirror).ok()?;
        if current.as_deref() == Some(want.as_slice()) {
            return None; // identical (a restore, a rotation): nothing to do
        }
        match fs.write(class, path, &want, true) {
            Ok(_) => true,
            Err(e) => {
                log::warn!(
                    "sync: self-heal of a file in {} failed: {e}",
                    ids::short_id(class)
                );
                false
            }
        }
    } else if meta.is_file() {
        let m: MirrorMeta = serde_json::from_slice(&std::fs::read(&meta).ok()?).ok()?;
        if current.as_ref().map(|b| ids::sha256_hex(b)) == Some(m.sha256.clone()) {
            return None;
        }
        restore_audio(ctx, class, path, &m).unwrap_or(false)
    } else {
        return None;
    };
    log::warn!(
        "sync: {} changed one of this device's files in {} (healed: {healed})",
        modified_by,
        ids::short_id(class)
    );
    Some(SyncEvent::ForeignWrite {
        class_id: class.to_string(),
        path: path.to_string(),
        modified_by: modified_by.to_string(),
        healed,
    })
}

/// Every mirrored path of a class (`audio.webm` through its `.meta.json`).
fn mirrored_paths(fs: &ClassFs, class: &str) -> Vec<String> {
    let root = fs.paths().private_dir(class).join("mirror");
    let mut out = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                stack.push(p);
            } else if ft.is_file() {
                if let Ok(rel) = p.strip_prefix(&root) {
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    let rel = rel
                        .strip_suffix(".meta.json")
                        .map(str::to_string)
                        .unwrap_or(rel);
                    if tramado_base::confine::validate_class_path(&rel).is_ok() {
                        out.push(rel);
                    }
                }
            }
        }
    }
    out
}

/// The start-up pass (§12.3): own JSONL files whose `local.modifiedBy` is me are copied over
/// their mirror (a crash between the two appends leaves the mirror short); every other own file
/// changed or deleted by someone else while the app was closed is healed.
pub fn startup_pass(ctx: &Ctx, fs: &ClassFs, class: &str) -> Vec<SyncEvent> {
    let me = ids::short_id(ctx.me);
    let mut events = Vec::new();
    for path in mirrored_paths(fs, class) {
        let Ok(Some(f)) = ctx.c.db_file(class, &path) else {
            continue;
        };
        let Some(local) = f.local else { continue };
        let by = local.modified_by.clone().unwrap_or_default();
        if by == me && !local.deleted {
            if path.ends_with(".jsonl") {
                if let Ok(root) = ctx.registry.root(class) {
                    if let Ok(bytes) = std::fs::read(files::join_rel(&root, &path)) {
                        let mirror = fs.mirror_path(class, &path);
                        if std::fs::read(&mirror).ok().as_deref() != Some(bytes.as_slice())
                            && bytes.len() <= tramado_base::classfs::MIRROR_MAX_BYTES
                        {
                            let _ = files::write_atomic(&mirror, &bytes);
                        }
                    }
                }
            }
            continue;
        }
        if let Some(e) = heal(ctx, fs, class, &path, &by) {
            events.push(e);
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::testing::World;
    use crate::ctx::Now;
    use crate::fake::ME;
    use serde_json::json;
    use std::sync::Arc;
    use tramado_base::paths::Paths;
    use tramado_base::registry::{ClassEntry, ClassRegistry};

    const C: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn setup(w: &World) -> (ClassFs, PathBuf) {
        let paths = Arc::new(Paths::for_tests(w.dir.path()));
        let reg = Arc::new(ClassRegistry::load(&w.dir.path().join("config")).unwrap());
        let root = w.dir.path().join("class");
        std::fs::create_dir_all(&root).unwrap();
        let mut e = ClassEntry::new(C, root.clone());
        e.shared = true;
        reg.insert(e.clone()).unwrap();
        // the World's own registry must know the class too (same file, separate handle)
        let _ = w.registry.insert(e);
        let fs = ClassFs::new(paths, reg);
        fs.set_device(ME);
        (fs, root)
    }

    #[test]
    fn a_foreign_write_of_my_file_is_healed_and_an_identical_one_ignored() {
        let w = World::new();
        let (fs, root) = setup(&w);
        let path = format!(".tramado/members/{ME}.json");
        fs.write(C, &path, b"{\"mine\":1}", true).unwrap();
        let ctx = w.ctx(Now::current());
        assert!(heal(&ctx, &fs, C, &path, "BBBBBBB").is_none(), "unchanged");
        std::fs::write(root.join(&path), b"{\"forged\":1}").unwrap();
        let ev = heal(&ctx, &fs, C, &path, "BBBBBBB").unwrap();
        assert!(matches!(ev, SyncEvent::ForeignWrite { healed: true, .. }));
        assert_eq!(std::fs::read(root.join(&path)).unwrap(), b"{\"mine\":1}");
        // a deletion by someone else is restored too
        std::fs::remove_file(root.join(&path)).unwrap();
        assert!(heal(&ctx, &fs, C, &path, "BBBBBBB").is_some());
        assert!(root.join(&path).exists());
        // a path I deleted myself has no mirror: never restored
        fs.remove(C, &path, false).unwrap();
        assert!(heal(&ctx, &fs, C, &path, "BBBBBBB").is_none());
        assert!(!root.join(&path).exists());
    }

    #[test]
    fn transcripts_others_files_and_old_presence_are_not_healed() {
        let w = World::new();
        let (fs, root) = setup(&w);
        let ctx = w.ctx(Now::current());
        fs.write(C, "Aulas/A/transcript.json", b"{}", true).unwrap();
        std::fs::write(root.join("Aulas/A/transcript.json"), b"{\"x\":1}").unwrap();
        assert!(heal(&ctx, &fs, C, "Aulas/A/transcript.json", "B").is_none());
        std::fs::create_dir_all(root.join(".tramado/chat/OTHER")).unwrap();
        assert!(heal(&ctx, &fs, C, ".tramado/chat/OTHER/2026-11.jsonl", "B").is_none());
        let pres = format!(".tramado/presence/{ME}.json");
        fs.write(C, &pres, b"{}", true).unwrap();
        let mirror = fs.mirror_path(C, &pres);
        let old = std::fs::File::options().write(true).open(&mirror).unwrap();
        old.set_modified(SystemTime::now() - Duration::from_secs(2 * 24 * 3600))
            .unwrap();
        std::fs::remove_file(root.join(&pres)).unwrap();
        assert!(heal(&ctx, &fs, C, &pres, "B").is_none());
    }

    #[test]
    fn audio_is_restored_from_the_trashcan() {
        let w = World::new();
        let (fs, root) = setup(&w);
        let ctx = w.ctx(Now::current());
        fs.write(C, "Aulas/A/audio.webm", b"OPUS", true).unwrap();
        std::fs::write(root.join("Aulas/A/audio.webm"), b"FORGED!").unwrap();
        w.fake.with(|s| {
            s.versions.insert(
                C.into(),
                json!({"Aulas/A/audio.webm": [
                    {"versionTime": "2026-11-04T10:00:00Z", "modTime": "x", "size": 4},
                    {"versionTime": "2026-11-04T09:00:00Z", "modTime": "x", "size": 4},
                    {"versionTime": "2026-11-04T11:00:00Z", "modTime": "x", "size": 9}]}),
            );
        });
        let ev = heal(&ctx, &fs, C, "Aulas/A/audio.webm", "B").unwrap();
        assert!(matches!(ev, SyncEvent::ForeignWrite { healed: true, .. }));
        let restored = w.fake.with(|s| s.restored.clone());
        assert_eq!(
            restored[0].1,
            json!({"Aulas/A/audio.webm": "2026-11-04T10:00:00Z"})
        );
    }

    #[test]
    fn startup_copies_own_jsonl_over_a_short_mirror() {
        let w = World::new();
        let (fs, root) = setup(&w);
        let path = format!(".tramado/chat/{ME}/2026-11.jsonl");
        fs.append(C, &path, b"{\"a\":1}\n", true).unwrap();
        // a crash after the file append but before the mirror append
        std::fs::OpenOptions::new()
            .append(true)
            .open(root.join(&path))
            .unwrap();
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(root.join(&path))
            .unwrap();
        std::io::Write::write_all(&mut f, b"{\"b\":2}\n").unwrap();
        w.fake.set_file(
            C,
            &path,
            json!({"local": {"modifiedBy": ids::short_id(ME), "deleted": false}}),
        );
        let ev = startup_pass(&w.ctx(Now::current()), &fs, C);
        assert!(ev.is_empty());
        assert_eq!(
            std::fs::read(fs.mirror_path(C, &path)).unwrap(),
            b"{\"a\":1}\n{\"b\":2}\n"
        );
    }
}
