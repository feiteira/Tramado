// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `ClassFs`, the only way Rust code touches a class folder (architecture §5.1 `classfs`):
//! confined operations, the private mirror of this device's own files (folder spec §10, sync
//! spec §12.3), the record of recent own writes (so the watcher can flag them) and a
//! `WriteObserver` hook (tramado-sync: scans and the own-deletion log).

use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::confine;
use crate::error::{AppError, AppResult, Code};
use crate::files::{self, FileEntry, ListOptions};
use crate::paths::Paths;
use crate::registry::ClassRegistry;

/// Own files up to this size are copied to the mirror (larger ones are not).
pub const MIRROR_MAX_BYTES: usize = 1 << 20;

/// Manifests whose writer the caller vouches for (TS knows who wrote them).
const OWN_MANIFESTS: [&str; 7] = [
    "class.json",
    "lecture.json",
    "exam.json",
    "transcript.json",
    "transcript.md",
    "transcript.vtt",
    "audio.webm",
];

/// Own files that are never mirrored: their owner can change (TS decides, sync spec §12.3).
const NOT_MIRRORED: [&str; 3] = ["transcript.json", "transcript.md", "transcript.vtt"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteKind {
    Write,
    Append,
    Remove,
    Move { from: String },
}

pub trait WriteObserver: Send + Sync {
    fn wrote(&self, class_id: &str, path: &str, kind: &WriteKind);
}

/// TS `FileStamp`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub path: String,
    pub size: u64,
    pub mtime_ms: u64,
    pub sha256: Option<String>,
}

/// `mirror/<path>.meta.json` for `audio.webm` (only its size and hash are kept).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MirrorMeta {
    pub size: u64,
    pub sha256: String,
}

type PathKey = (String, String);

pub struct ClassFs {
    paths: Arc<Paths>,
    registry: Arc<ClassRegistry>,
    my_device: RwLock<Option<String>>,
    observer: RwLock<Option<Arc<dyn WriteObserver>>>,
    recent_self: Mutex<HashMap<PathKey, Instant>>,
    path_locks: Mutex<HashMap<PathKey, Arc<Mutex<()>>>>,
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn stamp(class_path: &str, abs: &Path, sha256: Option<String>) -> AppResult<FileStamp> {
    let m = fs::metadata(abs)?;
    Ok(FileStamp {
        path: class_path.to_string(),
        size: m.len(),
        mtime_ms: files::mtime_ms(&m),
        sha256,
    })
}

impl ClassFs {
    pub fn new(paths: Arc<Paths>, registry: Arc<ClassRegistry>) -> Self {
        ClassFs {
            paths,
            registry,
            my_device: RwLock::new(None),
            observer: RwLock::new(None),
            recent_self: Mutex::new(HashMap::new()),
            path_locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn registry(&self) -> &Arc<ClassRegistry> {
        &self.registry
    }

    pub fn paths(&self) -> &Arc<Paths> {
        &self.paths
    }

    /// This device's ID, once the sync identity is known.
    pub fn set_device(&self, device_id: &str) {
        *self.my_device.write().unwrap_or_else(|e| e.into_inner()) = Some(device_id.to_string());
    }

    pub fn device(&self) -> Option<String> {
        self.my_device
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn set_observer(&self, o: Arc<dyn WriteObserver>) {
        *self.observer.write().unwrap_or_else(|e| e.into_inner()) = Some(o);
    }

    fn observe(&self, class: &str, path: &str, kind: WriteKind) {
        let o = self
            .observer
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(o) = o {
            o.wrote(class, path, &kind);
        }
    }

    /// The class root, which must exist: a write must never recreate a missing (moved,
    /// unmounted) class folder.
    fn root(&self, class: &str) -> AppResult<PathBuf> {
        let root = self.registry.root(class)?;
        if !root.is_dir() {
            return Err(AppError::not_found("the class folder is missing"));
        }
        Ok(root)
    }

    fn resolve(&self, class: &str, path: &str) -> AppResult<(String, PathBuf)> {
        let entry = self
            .registry
            .get(class)
            .ok_or_else(|| AppError::not_found("no such class"))?;
        let root = self.root(&entry.class_id)?;
        Ok((entry.class_id, confine::confine(&root, path)?))
    }

    fn lock_path(&self, class: &str, path: &str) -> Arc<Mutex<()>> {
        let mut locks = self.path_locks.lock().unwrap_or_else(|e| e.into_inner());
        if locks.len() > 4096 {
            locks.retain(|_, l| Arc::strong_count(l) > 1);
        }
        locks
            .entry((class.to_string(), path.to_string()))
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn guard(lock: &Arc<Mutex<()>>) -> MutexGuard<'_, ()> {
        lock.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn note_self_write(&self, class: &str, path: &str) {
        let mut recent = self.recent_self.lock().unwrap_or_else(|e| e.into_inner());
        if recent.len() > 1024 {
            recent.retain(|_, at| at.elapsed() < Duration::from_secs(60));
        }
        recent.insert((class.to_string(), path.to_string()), Instant::now());
    }

    /// True when this process wrote `path` within `within` (the watcher sets `selfWrite`).
    pub fn is_recent_self_write(&self, class: &str, path: &str, within: Duration) -> bool {
        let recent = self.recent_self.lock().unwrap_or_else(|e| e.into_inner());
        recent
            .get(&(class.to_string(), path.to_string()))
            .is_some_and(|at| at.elapsed() <= within)
    }

    /// `own = true` is accepted only for paths under `.tramado/` with a segment that is this
    /// device's ID (`<id>`, `<id>.json`, `<id>.jsonl`), or for the manifest names the caller
    /// vouches for.
    pub fn is_own_path(&self, path: &str) -> bool {
        if OWN_MANIFESTS.contains(&base_name(path)) {
            return true;
        }
        let Some(rest) = path.strip_prefix(".tramado/") else {
            return false;
        };
        let Some(me) = self.device() else {
            return false;
        };
        rest.split('/').any(|seg| {
            seg == me
                || seg.strip_suffix(".json") == Some(me.as_str())
                || seg.strip_suffix(".jsonl") == Some(me.as_str())
        })
    }

    fn check_own(&self, path: &str, own: bool) -> AppResult<()> {
        if own && !self.is_own_path(path) {
            return Err(AppError::invalid("not one of this device's own files"));
        }
        Ok(())
    }

    /// data/private/<class>/mirror/<path>
    pub fn mirror_path(&self, class: &str, path: &str) -> PathBuf {
        files::join_rel(&self.paths.private_dir(class).join("mirror"), path)
    }

    fn mirror_meta_path(&self, class: &str, path: &str) -> PathBuf {
        let mut p = self.mirror_path(class, path).into_os_string();
        p.push(".meta.json");
        PathBuf::from(p)
    }

    fn mirror_write(&self, class: &str, path: &str, bytes: &[u8], sha256: &str) -> AppResult<()> {
        let name = base_name(path);
        if NOT_MIRRORED.contains(&name) {
            return Ok(());
        }
        if name == "audio.webm" {
            let meta = MirrorMeta {
                size: bytes.len() as u64,
                sha256: sha256.to_string(),
            };
            return files::write_atomic(
                &self.mirror_meta_path(class, path),
                &serde_json::to_vec(&meta)?,
            );
        }
        let mirror = self.mirror_path(class, path);
        if bytes.len() <= MIRROR_MAX_BYTES {
            files::write_atomic(&mirror, bytes)
        } else {
            files::remove_file_if_exists(&mirror).map(|_| ())
        }
    }

    fn mirror_remove(&self, class: &str, path: &str) -> AppResult<()> {
        let mirror = self.mirror_path(class, path);
        if mirror.is_dir() {
            files::remove_dir_all_if_exists(&mirror)?;
        } else {
            files::remove_file_if_exists(&mirror)?;
        }
        files::remove_file_if_exists(&self.mirror_meta_path(class, path))?;
        Ok(())
    }

    /// Atomic whole-file write; the stamp carries the SHA-256.
    pub fn write(&self, class: &str, path: &str, bytes: &[u8], own: bool) -> AppResult<FileStamp> {
        self.check_own(path, own)?;
        let (class, abs) = self.resolve(class, path)?;
        let lock = self.lock_path(&class, path);
        let st = {
            let _g = Self::guard(&lock);
            files::write_atomic(&abs, bytes)?;
            let sha = crate::ids::sha256_hex(bytes);
            if own {
                self.mirror_write(&class, path, bytes, &sha)?;
            }
            self.note_self_write(&class, path);
            stamp(path, &abs, Some(sha))?
        };
        self.observe(&class, path, WriteKind::Write);
        Ok(st)
    }

    /// One JSONL line (folder spec §4.4); the stamp's size is the new length.
    pub fn append(&self, class: &str, path: &str, line: &[u8], own: bool) -> AppResult<FileStamp> {
        self.check_own(path, own)?;
        files::check_line(line)?;
        let (class, abs) = self.resolve(class, path)?;
        let lock = self.lock_path(&class, path);
        let st = {
            let _g = Self::guard(&lock);
            let len = files::append_line(&abs, line)?;
            if own && !NOT_MIRRORED.contains(&base_name(path)) {
                let mirror = self.mirror_path(&class, path);
                let mirror_len = fs::metadata(&mirror).map(|m| m.len()).unwrap_or(0);
                if mirror_len + line.len() as u64 <= MIRROR_MAX_BYTES as u64 {
                    files::append_line(&mirror, line)?;
                } else {
                    files::remove_file_if_exists(&mirror)?;
                }
            }
            self.note_self_write(&class, path);
            let m = fs::metadata(&abs)?;
            FileStamp {
                path: path.to_string(),
                size: len,
                mtime_ms: files::mtime_ms(&m),
                sha256: None,
            }
        };
        self.observe(&class, path, WriteKind::Append);
        Ok(st)
    }

    pub fn read(&self, class: &str, path: &str) -> AppResult<Vec<u8>> {
        let (_, abs) = self.resolve(class, path)?;
        Ok(fs::read(abs)?)
    }

    pub fn read_range(&self, class: &str, path: &str, offset: u64, len: u64) -> AppResult<Vec<u8>> {
        let (_, abs) = self.resolve(class, path)?;
        files::read_range(&abs, offset, len)
    }

    /// `None` when nothing is there.
    pub fn stat(&self, class: &str, path: &str) -> AppResult<Option<FileEntry>> {
        let (_, abs) = self.resolve(class, path)?;
        let m = match fs::symlink_metadata(&abs) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let name = base_name(path).to_string();
        let conflict_of = files::conflict_original(&name).map(|orig| match path.rsplit_once('/') {
            Some((parent, _)) => format!("{parent}/{orig}"),
            None => orig,
        });
        Ok(Some(FileEntry {
            path: path.to_string(),
            name,
            is_dir: m.is_dir(),
            size: if m.is_dir() { 0 } else { m.len() },
            mtime_ms: files::mtime_ms(&m),
            conflict_of,
        }))
    }

    /// Lists `dir` (`""` = the class root).
    pub fn list(&self, class: &str, dir: &str, opts: ListOptions) -> AppResult<Vec<FileEntry>> {
        let entry = self
            .registry
            .get(class)
            .ok_or_else(|| AppError::not_found("no such class"))?;
        let root = self.root(&entry.class_id)?;
        let abs = if dir.is_empty() {
            root.clone()
        } else {
            confine::confine(&root, dir)?
        };
        files::list(&root, &abs, opts)
    }

    pub fn mkdir(&self, class: &str, path: &str) -> AppResult<()> {
        let (_, abs) = self.resolve(class, path)?;
        fs::create_dir_all(abs)?;
        Ok(())
    }

    /// `CONFLICT` if `to` exists.
    pub fn rename(&self, class: &str, from: &str, to: &str) -> AppResult<()> {
        let (class, src) = self.resolve(class, from)?;
        let (_, dst) = self.resolve(&class, to)?;
        {
            // Two locks, always taken in the same order, so concurrent moves cannot deadlock.
            let (first, second) = if from <= to { (from, to) } else { (to, from) };
            let lock_a = self.lock_path(&class, first);
            let lock_b = self.lock_path(&class, second);
            let _a = Self::guard(&lock_a);
            let _b = if Arc::ptr_eq(&lock_a, &lock_b) {
                None
            } else {
                Some(Self::guard(&lock_b))
            };
            fs::symlink_metadata(&src)?;
            if fs::symlink_metadata(&dst).is_ok() {
                return Err(AppError::new(Code::Conflict, "the destination exists")
                    .with_data(serde_json::json!({"path": to})));
            }
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&src, &dst)?;
            self.note_self_write(&class, from);
            self.note_self_write(&class, to);
        }
        self.observe(
            &class,
            to,
            WriteKind::Move {
                from: from.to_string(),
            },
        );
        Ok(())
    }

    /// `NOT_FOUND` if nothing is there; a non-empty folder needs `recursive`. The mirror copy of
    /// the path, if any, goes too.
    pub fn remove(&self, class: &str, path: &str, recursive: bool) -> AppResult<()> {
        let (class, abs) = self.resolve(class, path)?;
        {
            let lock = self.lock_path(&class, path);
            let _g = Self::guard(&lock);
            let m = fs::symlink_metadata(&abs)?;
            if m.is_dir() {
                if recursive {
                    fs::remove_dir_all(&abs)?;
                } else {
                    fs::remove_dir(&abs)?;
                }
            } else {
                fs::remove_file(&abs)?;
            }
            self.mirror_remove(&class, path)?;
            self.note_self_write(&class, path);
        }
        self.observe(&class, path, WriteKind::Remove);
        Ok(())
    }

    /// Streaming SHA-256, lower-case hex.
    pub fn hash(&self, class: &str, path: &str) -> AppResult<String> {
        let (_, abs) = self.resolve(class, path)?;
        files::sha256_file(&abs)
    }

    /// Large new files: `fill` writes `.tramado/tmp/<random>.part`, which is synced and renamed
    /// into `dest` (`CONFLICT` if `dest` exists). The stamp carries the SHA-256.
    pub fn stage_and_place(
        &self,
        class: &str,
        dest: &str,
        fill: impl FnOnce(&mut File) -> AppResult<()>,
        own: bool,
    ) -> AppResult<FileStamp> {
        self.check_own(dest, own)?;
        let (class, dst) = self.resolve(class, dest)?;
        let tmp_rel = format!(
            "{}{}.part",
            confine::STAGING_PREFIX,
            crate::ids::random_lower_alnum(16)
        );
        let (_, tmp) = self.resolve(&class, &tmp_rel)?;
        if let Some(parent) = tmp.parent() {
            fs::create_dir_all(parent)?;
        }
        let staged = (|| -> AppResult<()> {
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)?;
            fill(&mut f)?;
            f.sync_all()?;
            Ok(())
        })();
        if let Err(e) = staged {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        let lock = self.lock_path(&class, dest);
        let st = {
            let _g = Self::guard(&lock);
            let placed = (|| -> AppResult<()> {
                if fs::symlink_metadata(&dst).is_ok() {
                    return Err(AppError::new(Code::Conflict, "the destination exists")
                        .with_data(serde_json::json!({"path": dest})));
                }
                if let Some(parent) = dst.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::rename(&tmp, &dst)?;
                Ok(())
            })();
            if let Err(e) = placed {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
            let sha = files::sha256_file(&dst)?;
            if own {
                let size = fs::metadata(&dst)?.len();
                if base_name(dest) == "audio.webm" {
                    let meta = MirrorMeta {
                        size,
                        sha256: sha.clone(),
                    };
                    files::write_atomic(
                        &self.mirror_meta_path(&class, dest),
                        &serde_json::to_vec(&meta)?,
                    )?;
                } else if size as usize <= MIRROR_MAX_BYTES
                    && !NOT_MIRRORED.contains(&base_name(dest))
                {
                    let bytes = fs::read(&dst)?;
                    files::write_atomic(&self.mirror_path(&class, dest), &bytes)?;
                }
            }
            self.note_self_write(&class, dest);
            stamp(dest, &dst, Some(sha))?
        };
        self.observe(&class, dest, WriteKind::Write);
        Ok(st)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::ClassEntry;

    const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ME: &str = "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";
    const OTHER: &str = "BBBBBBB-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";

    #[derive(Default)]
    struct Log(Mutex<Vec<(String, WriteKind)>>);
    impl WriteObserver for Log {
        fn wrote(&self, _class: &str, path: &str, kind: &WriteKind) {
            self.0
                .lock()
                .unwrap()
                .push((path.to_string(), kind.clone()));
        }
    }

    fn setup() -> (tempfile::TempDir, ClassFs, Arc<Log>, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Arc::new(Paths::for_tests(dir.path()));
        let reg = Arc::new(ClassRegistry::load(&paths.config).unwrap());
        let root = dir.path().join("classes").join("Direito");
        fs::create_dir_all(root.join(".tramado")).unwrap();
        reg.insert(ClassEntry::new(CLASS, root.clone())).unwrap();
        let cfs = ClassFs::new(paths, reg);
        let log = Arc::new(Log::default());
        cfs.set_observer(log.clone());
        (dir, cfs, log, root)
    }

    #[test]
    fn own_writes_are_mirrored_and_observed() {
        let (_dir, fs_, log, root) = setup();
        let member = format!(".tramado/members/{ME}.json");
        // Without a device ID nothing under .tramado is "own".
        assert_eq!(
            fs_.write(CLASS, &member, b"{}", true).unwrap_err().code(),
            Code::Invalid
        );
        fs_.set_device(ME);
        let st = fs_.write(CLASS, &member, b"{\"a\":1}", true).unwrap();
        assert_eq!(st.size, 7);
        assert_eq!(
            st.sha256.as_deref(),
            Some(crate::ids::sha256_hex(b"{\"a\":1}").as_str())
        );
        assert_eq!(fs::read(root.join(&member)).unwrap(), b"{\"a\":1}");
        assert_eq!(
            fs::read(fs_.mirror_path(CLASS, &member)).unwrap(),
            b"{\"a\":1}"
        );
        assert!(fs_.is_recent_self_write(CLASS, &member, Duration::from_secs(2)));
        assert!(!fs_.is_recent_self_write(CLASS, "other", Duration::from_secs(2)));
        // Someone else's file cannot be claimed as own.
        let theirs = format!(".tramado/members/{OTHER}.json");
        assert_eq!(
            fs_.write(CLASS, &theirs, b"{}", true).unwrap_err().code(),
            Code::Invalid
        );
        fs_.write(CLASS, &theirs, b"{}", false).unwrap();
        assert!(!fs_.mirror_path(CLASS, &theirs).exists());
        // Chat lines go to the mirror too.
        let chat = format!(".tramado/chat/{ME}/2026-11.jsonl");
        fs_.append(CLASS, &chat, b"{\"t\":1}\n", true).unwrap();
        let st = fs_.append(CLASS, &chat, b"{\"t\":2}\n", true).unwrap();
        assert_eq!(st.size, 16);
        assert_eq!(st.sha256, None);
        assert_eq!(
            fs::read(fs_.mirror_path(CLASS, &chat)).unwrap(),
            b"{\"t\":1}\n{\"t\":2}\n"
        );
        // Transcripts are own but never mirrored; audio keeps only size and hash.
        fs_.write(CLASS, "Aulas/A1/transcript.json", b"{}", true)
            .unwrap();
        assert!(!fs_.mirror_path(CLASS, "Aulas/A1/transcript.json").exists());
        fs_.write(CLASS, "Aulas/A1/audio.webm", b"webm", true)
            .unwrap();
        let meta: MirrorMeta = serde_json::from_slice(
            &fs::read(fs_.mirror_meta_path(CLASS, "Aulas/A1/audio.webm")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            meta,
            MirrorMeta {
                size: 4,
                sha256: crate::ids::sha256_hex(b"webm")
            }
        );
        // Removing an own file removes its mirror copy.
        fs_.remove(CLASS, &member, false).unwrap();
        assert!(!fs_.mirror_path(CLASS, &member).exists());
        let kinds: Vec<WriteKind> = log
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|(_, k)| k.clone())
            .collect();
        assert_eq!(
            kinds,
            vec![
                WriteKind::Write,
                WriteKind::Write,
                WriteKind::Append,
                WriteKind::Append,
                WriteKind::Write,
                WriteKind::Write,
                WriteKind::Remove
            ]
        );
    }

    #[test]
    fn confined_operations() {
        let (dir, fs_, log, root) = setup();
        fs_.write(CLASS, "Docs/a.md", b"hello", false).unwrap();
        assert_eq!(fs_.read(CLASS, "Docs/a.md").unwrap(), b"hello");
        assert_eq!(fs_.read_range(CLASS, "Docs/a.md", 1, 3).unwrap(), b"ell");
        assert_eq!(
            fs_.hash(CLASS, "Docs/a.md").unwrap(),
            crate::ids::sha256_hex(b"hello")
        );
        let st = fs_.stat(CLASS, "Docs/a.md").unwrap().unwrap();
        assert_eq!((st.size, st.is_dir), (5, false));
        assert_eq!(fs_.stat(CLASS, "Docs/none.md").unwrap(), None);
        fs_.mkdir(CLASS, "Notas").unwrap();
        fs_.write(CLASS, "Docs/b.md", b"b", false).unwrap();
        assert_eq!(
            fs_.rename(CLASS, "Docs/a.md", "Docs/b.md")
                .unwrap_err()
                .code(),
            Code::Conflict
        );
        fs_.rename(CLASS, "Docs/a.md", "Notas/a.md").unwrap();
        let listed: Vec<String> = fs_
            .list(
                CLASS,
                "",
                ListOptions {
                    recursive: true,
                    ..ListOptions::default()
                },
            )
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(listed, vec!["Docs", "Docs/b.md", "Notas", "Notas/a.md"]);
        assert_eq!(
            fs_.remove(CLASS, "Notas/zz", false).unwrap_err().code(),
            Code::NotFound
        );
        assert!(fs_.remove(CLASS, "Notas", false).is_err(), "not empty");
        fs_.remove(CLASS, "Notas", true).unwrap();
        assert_eq!(fs_.read(CLASS, "../x").unwrap_err().code(), Code::Invalid);
        assert_eq!(
            fs_.read("tramado-bbbbbbbbbbbbbbbbbbbbbbbbbb", "a")
                .unwrap_err()
                .code(),
            Code::NotFound
        );
        let moved = log.0.lock().unwrap().iter().any(|(p, k)| {
            p == "Notas/a.md"
                && *k
                    == WriteKind::Move {
                        from: "Docs/a.md".into(),
                    }
        });
        assert!(moved);
        // A missing class folder is never recreated by a write.
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            fs_.write(CLASS, "Docs/c.md", b"c", false)
                .unwrap_err()
                .code(),
            Code::NotFound
        );
        assert!(!root.exists());
        drop(dir);
    }

    #[cfg(unix)]
    #[test]
    fn planted_symlink_is_refused() {
        let (dir, fs_, _log, root) = setup();
        let secret = dir.path().join("id_rsa");
        fs::write(&secret, b"secret").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("notes.md")).unwrap();
        assert_eq!(
            fs_.read(CLASS, "notes.md").unwrap_err().code(),
            Code::SymlinkRefused
        );
        assert_eq!(
            fs_.write(CLASS, "notes.md", b"x", false)
                .unwrap_err()
                .code(),
            Code::SymlinkRefused
        );
        assert_eq!(fs::read(&secret).unwrap(), b"secret");
    }

    #[test]
    fn stage_and_place_large_files() {
        let (_dir, fs_, _log, root) = setup();
        fs_.set_device(ME);
        let st = fs_
            .stage_and_place(
                CLASS,
                "Aulas/A1/audio.webm",
                |f| {
                    use std::io::Write;
                    f.write_all(&vec![7u8; 3 << 20]).map_err(AppError::from)
                },
                true,
            )
            .unwrap();
        assert_eq!(st.size, 3 << 20);
        assert_eq!(st.sha256.as_deref().map(str::len), Some(64));
        assert!(root.join("Aulas/A1/audio.webm").is_file());
        assert!(fs_.mirror_meta_path(CLASS, "Aulas/A1/audio.webm").is_file());
        let again = fs_.stage_and_place(CLASS, "Aulas/A1/audio.webm", |_| Ok(()), false);
        assert_eq!(again.unwrap_err().code(), Code::Conflict);
        let staging: Vec<_> = fs::read_dir(root.join(".tramado/tmp")).unwrap().collect();
        assert!(staging.is_empty(), "no staged file is left behind");
        let failed = fs_.stage_and_place(
            CLASS,
            "Docs/x.pdf",
            |_| Err(AppError::new(Code::Cancelled, "stop")),
            false,
        );
        assert_eq!(failed.unwrap_err().code(), Code::Cancelled);
        assert!(fs::read_dir(root.join(".tramado/tmp"))
            .unwrap()
            .next()
            .is_none());
    }
}
