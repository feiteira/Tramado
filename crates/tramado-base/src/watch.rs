// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Class folder watcher (architecture §5.1 `watch`, §7.1 `class:changed`, §12): one
//! notify-debouncer-full watcher (300 ms) over every registered class root. Events are mapped
//! back to class paths on the named thread `tramado-watch`; folder spec §4.5 names and
//! `.tramado/tmp/` are skipped; paths this process wrote in the last 2 s are reported apart
//! with `self_write: true` (`ClassFs::is_recent_self_write`); an overflow (or a watcher error)
//! is reported as `rescan: true`, which means "re-list everything".

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use notify::{EventKind, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache,
};
use serde::{Deserialize, Serialize};

use crate::classfs::ClassFs;
use crate::confine;
use crate::error::{AppError, AppResult, Code};
use crate::files;

/// The debounce window (architecture §7.1).
pub const DEBOUNCE: Duration = Duration::from_millis(300);
/// A change of a path this process wrote within this window is a self write.
pub const SELF_WRITE_WINDOW: Duration = Duration::from_secs(2);

/// TS `ClassChangedEvent` (payload of the global `class:changed` event).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassChanged {
    pub class_id: String,
    pub paths: Vec<String>,
    pub self_write: bool,
    /// re-list everything
    pub rescan: bool,
}

pub type ChangeSink = Arc<dyn Fn(ClassChanged) + Send + Sync>;

type Roots = Arc<RwLock<HashMap<String, PathBuf>>>;
type SelfCheck = Arc<RwLock<Option<Arc<ClassFs>>>>;
type NotifyDebouncer = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

pub struct ClassWatcher {
    roots: Roots,
    debouncer: Mutex<Option<NotifyDebouncer>>,
    self_check: SelfCheck,
}

/// True when a class path must never be reported: §4.5 names at any depth, `.tramado/tmp/`.
pub fn is_ignored(class_path: &str) -> bool {
    if class_path == ".tramado/tmp" || class_path.starts_with(confine::STAGING_PREFIX) {
        return true;
    }
    class_path.split('/').any(files::is_skipped_name)
}

/// Whether an event kind says something changed (opens and reads do not).
fn is_change(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(notify::event::AccessKind::Close(notify::event::AccessMode::Write)) => {
            true
        }
        EventKind::Access(_) => false,
        _ => true,
    }
}

/// The class (longest root first) and class path of an absolute path; `Some((class, None))`
/// for a class root itself.
fn locate(roots: &HashMap<String, PathBuf>, abs: &Path) -> Option<(String, Option<String>)> {
    let mut best: Option<(&String, &PathBuf)> = None;
    for (id, root) in roots {
        if abs.starts_with(root)
            && best.is_none_or(|(_, b)| root.components().count() > b.components().count())
        {
            best = Some((id, root));
        }
    }
    let (id, root) = best?;
    if abs == root {
        return Some((id.clone(), None));
    }
    let rel = confine::class_path_of(root, abs)?;
    Some((id.clone(), Some(rel)))
}

#[derive(Default)]
struct Batch {
    own: BTreeSet<String>,
    other: BTreeSet<String>,
    rescan: bool,
}

/// Turns one debounced batch into `class:changed` events (one per class and kind of writer).
fn dispatch(result: DebounceEventResult, roots: &Roots, self_check: &SelfCheck, sink: &ChangeSink) {
    let roots = roots.read().unwrap_or_else(|e| e.into_inner()).clone();
    let fs = self_check.read().unwrap_or_else(|e| e.into_inner()).clone();
    let mut per_class: HashMap<String, Batch> = HashMap::new();
    let mut rescan_all = false;
    match result {
        Err(errors) => {
            for e in &errors {
                log::warn!("class watcher error: {e}");
            }
            rescan_all = true;
        }
        Ok(events) => {
            for ev in events {
                let ev: DebouncedEvent = ev;
                if ev.need_rescan() {
                    if ev.paths.is_empty() {
                        rescan_all = true;
                    }
                    for p in &ev.paths {
                        if let Some((class, _)) = locate(&roots, p) {
                            per_class.entry(class).or_default().rescan = true;
                        }
                    }
                    continue;
                }
                if !is_change(&ev.kind) {
                    continue;
                }
                for p in &ev.paths {
                    let Some((class, rel)) = locate(&roots, p) else {
                        continue;
                    };
                    let batch = per_class.entry(class.clone()).or_default();
                    match rel {
                        // The root itself was removed, renamed or replaced.
                        None => batch.rescan = true,
                        Some(rel) if is_ignored(&rel) => {}
                        Some(rel) => {
                            let own = fs.as_ref().is_some_and(|fs| {
                                fs.is_recent_self_write(&class, &rel, SELF_WRITE_WINDOW)
                            });
                            if own {
                                batch.own.insert(rel);
                            } else {
                                batch.other.insert(rel);
                            }
                        }
                    }
                }
            }
        }
    }
    if rescan_all {
        for class in roots.keys() {
            per_class.entry(class.clone()).or_default().rescan = true;
        }
    }
    let mut classes: Vec<_> = per_class.into_iter().collect();
    classes.sort_by(|a, b| a.0.cmp(&b.0));
    for (class_id, b) in classes {
        if b.rescan {
            let mut paths: BTreeSet<String> = b.other;
            paths.extend(b.own);
            sink(ClassChanged {
                class_id,
                paths: paths.into_iter().collect(),
                self_write: false,
                rescan: true,
            });
            continue;
        }
        if !b.other.is_empty() {
            sink(ClassChanged {
                class_id: class_id.clone(),
                paths: b.other.into_iter().collect(),
                self_write: false,
                rescan: false,
            });
        }
        if !b.own.is_empty() {
            sink(ClassChanged {
                class_id,
                paths: b.own.into_iter().collect(),
                self_write: true,
                rescan: false,
            });
        }
    }
}

impl ClassWatcher {
    /// Starts the notify watcher and the `tramado-watch` thread. When the OS watcher cannot be
    /// created (inotify limits, …) the watcher stays inert and every `watch` fails with
    /// `IO_ERROR` (the app still works; screens re-read on their own actions).
    pub fn new(sink: ChangeSink) -> Self {
        let roots: Roots = Arc::new(RwLock::new(HashMap::new()));
        let self_check: SelfCheck = Arc::new(RwLock::new(None));
        let (tx, rx) = mpsc::channel::<DebounceEventResult>();
        let debouncer = match new_debouncer(DEBOUNCE, None, tx) {
            Ok(d) => Some(d),
            Err(e) => {
                log::error!("class watcher unavailable: {e}");
                None
            }
        };
        if debouncer.is_some() {
            let (r, s) = (roots.clone(), self_check.clone());
            let spawned = std::thread::Builder::new()
                .name("tramado-watch".into())
                .spawn(move || {
                    // Ends when the debouncer (the sender) is dropped.
                    while let Ok(result) = rx.recv() {
                        dispatch(result, &r, &s, &sink);
                    }
                });
            if let Err(e) = spawned {
                log::error!("cannot start the class watcher thread: {e}");
            }
        }
        ClassWatcher {
            roots,
            debouncer: Mutex::new(debouncer),
            self_check,
        }
    }

    /// Lets the watcher tell this process's own writes apart (`self_write`).
    pub fn set_self_writes(&self, fs: Arc<ClassFs>) {
        *self.self_check.write().unwrap_or_else(|e| e.into_inner()) = Some(fs);
    }

    /// Watches `root` recursively as `class_id` (replacing an earlier root of that class).
    pub fn watch(&self, class_id: &str, root: &Path) -> AppResult<()> {
        let mut guard = self.debouncer.lock().unwrap_or_else(|e| e.into_inner());
        let Some(d) = guard.as_mut() else {
            return Err(AppError::new(
                Code::IoError,
                "the class watcher is unavailable",
            ));
        };
        let previous = self
            .roots
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(class_id)
            .cloned();
        if previous.as_deref() == Some(root) {
            return Ok(());
        }
        if let Some(old) = previous {
            let _ = d.unwatch(&old);
        }
        d.watch(root, RecursiveMode::Recursive).map_err(|e| {
            AppError::new(Code::IoError, format!("cannot watch the class folder: {e}"))
        })?;
        self.roots
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(class_id.to_string(), root.to_path_buf());
        Ok(())
    }

    pub fn unwatch(&self, class_id: &str) {
        let removed = self
            .roots
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(class_id);
        if let Some(root) = removed {
            let mut guard = self.debouncer.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(d) = guard.as_mut() {
                let _ = d.unwatch(&root);
            }
        }
    }

    /// The classes watched now (diagnostics, tests).
    pub fn watched(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .roots
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .cloned()
            .collect();
        v.sort();
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn collecting() -> (ChangeSink, mpsc::Receiver<ClassChanged>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: ChangeSink = Arc::new(move |c| {
            let _ = tx.lock().unwrap().send(c);
        });
        (sink, rx)
    }

    /// Every path reported for the class until `until` is seen (or the deadline passes).
    fn paths_until(
        rx: &mpsc::Receiver<ClassChanged>,
        until: &str,
        within: Duration,
    ) -> Vec<String> {
        let deadline = Instant::now() + within;
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            if let Ok(c) = rx.recv_timeout(Duration::from_millis(50)) {
                assert_eq!(c.class_id, CLASS);
                seen.extend(c.paths);
                if seen.iter().any(|p| p == until) {
                    break;
                }
            }
        }
        seen
    }

    #[test]
    fn emits_on_create_within_1s() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Direito");
        std::fs::create_dir_all(root.join("Docs")).unwrap();
        let (sink, rx) = collecting();
        let w = ClassWatcher::new(sink);
        w.watch(CLASS, &root).unwrap();
        assert_eq!(w.watched(), vec![CLASS.to_string()]);
        // Let the OS watcher settle before the first change.
        std::thread::sleep(Duration::from_millis(100));
        let t0 = Instant::now();
        std::fs::write(root.join("Docs/Código Civil.md"), b"art. 483").unwrap();
        let seen = paths_until(&rx, "Docs/Código Civil.md", Duration::from_secs(3));
        assert!(seen.iter().any(|p| p == "Docs/Código Civil.md"), "{seen:?}");
        assert!(t0.elapsed() < Duration::from_secs(1), "{:?}", t0.elapsed());
        w.unwatch(CLASS);
        assert!(w.watched().is_empty());
        std::fs::write(root.join("Docs/after.md"), b"x").unwrap();
        std::thread::sleep(Duration::from_millis(700));
        let late: Vec<ClassChanged> = rx.try_iter().collect();
        assert!(
            late.iter()
                .all(|c| !c.paths.iter().any(|p| p == "Docs/after.md")),
            "{late:?}"
        );
    }

    #[test]
    fn ignores_tmp_and_part() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Direito");
        std::fs::create_dir_all(root.join(".tramado/tmp")).unwrap();
        std::fs::create_dir_all(root.join(".stversions")).unwrap();
        let (sink, rx) = collecting();
        let w = ClassWatcher::new(sink);
        w.watch(CLASS, &root).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        for p in [
            "a.tmp",
            "b.part",
            ".x.abcdefgh.tmp",
            ".syncthing.c.md.tmp",
            "~syncthing~d.md.tmp",
            ".tramado/tmp/e.part",
            ".tramado/tmp/f",
            ".stversions/g.md",
        ] {
            std::fs::write(root.join(p), b"x").unwrap();
        }
        crate::files::write_atomic(&root.join("Notas/h.md"), b"atomic").unwrap();
        std::fs::write(root.join(".tramado/chat.jsonl"), b"{}\n").unwrap();
        std::fs::write(root.join("z.md"), b"done").unwrap();
        let mut seen = paths_until(&rx, "z.md", Duration::from_secs(3));
        // Give a straggling batch a moment, then collect it too.
        std::thread::sleep(Duration::from_millis(500));
        for c in rx.try_iter() {
            seen.extend(c.paths);
        }
        seen.sort();
        seen.dedup();
        assert!(seen.contains(&"z.md".to_string()), "{seen:?}");
        assert!(seen.contains(&"Notas/h.md".to_string()), "{seen:?}");
        assert!(
            seen.contains(&".tramado/chat.jsonl".to_string()),
            "{seen:?}"
        );
        for p in &seen {
            assert!(!is_ignored(p), "{p} should have been skipped ({seen:?})");
            assert!(
                !p.ends_with(".tmp") && !p.ends_with(".part") && !p.starts_with(".stversions"),
                "{p}"
            );
        }
    }

    #[test]
    fn self_writes_are_flagged() {
        use crate::paths::Paths;
        use crate::registry::{ClassEntry, ClassRegistry};
        let dir = tempfile::tempdir().unwrap();
        let paths = Arc::new(Paths::for_tests(dir.path()));
        let reg = Arc::new(ClassRegistry::load(&paths.config).unwrap());
        let root = dir.path().join("classes").join("Direito");
        std::fs::create_dir_all(root.join(".tramado")).unwrap();
        reg.insert(ClassEntry::new(CLASS, root.clone())).unwrap();
        let cfs = Arc::new(ClassFs::new(paths, reg));
        let (sink, rx) = collecting();
        let w = ClassWatcher::new(sink);
        w.set_self_writes(cfs.clone());
        w.watch(CLASS, &root).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        cfs.write(CLASS, "Notas/mine.md", b"mine", false).unwrap();
        std::fs::write(root.join("theirs.md"), b"theirs").unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let (mut mine, mut theirs) = (None, None);
        while Instant::now() < deadline && (mine.is_none() || theirs.is_none()) {
            if let Ok(c) = rx.recv_timeout(Duration::from_millis(50)) {
                if c.paths.iter().any(|p| p == "Notas/mine.md") {
                    mine = Some(c.self_write);
                }
                if c.paths.iter().any(|p| p == "theirs.md") {
                    theirs = Some(c.self_write);
                }
            }
        }
        assert_eq!((mine, theirs), (Some(true), Some(false)));
    }

    #[test]
    fn ignored_names() {
        for p in [
            "a.tmp",
            "Docs/b.part",
            ".stfolder",
            ".stversions/x",
            "x/.stignore",
            ".tramado/tmp",
            ".tramado/tmp/a",
            "a/~syncthing~b.tmp",
        ] {
            assert!(is_ignored(p), "{p}");
        }
        for p in ["a.md", ".tramado/class.json", "Docs/tmp/a.md", "a.tmp.md"] {
            assert!(!is_ignored(p), "{p}");
        }
        let mut roots = HashMap::new();
        roots.insert("a".to_string(), PathBuf::from("/x/A"));
        roots.insert("b".to_string(), PathBuf::from("/x/A/B"));
        assert_eq!(
            locate(&roots, Path::new("/x/A/B/c.md")),
            Some(("b".to_string(), Some("c.md".to_string())))
        );
        assert_eq!(
            locate(&roots, Path::new("/x/A/c.md")),
            Some(("a".to_string(), Some("c.md".to_string())))
        );
        assert_eq!(
            locate(&roots, Path::new("/x/A")),
            Some(("a".to_string(), None))
        );
        assert_eq!(locate(&roots, Path::new("/y/c.md")), None);
    }
}
