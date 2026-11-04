// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The class registry, `config/classes.json` (architecture §5.1 `registry`, D-3; folder spec
//! §12). Private to this device, never synced. Writes are atomic and serialised; fields this
//! version does not know are kept on rewrite.
//!
//! ```json
//! {"format":"tramado.classes","version":1,"root":null,"leftClasses":[],"classes":[ClassEntry…]}
//! ```

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{AppError, AppResult, Code};
use crate::files;
use crate::ids;

pub const FILE_NAME: &str = "classes.json";
pub const FORMAT: &str = "tramado.classes";

/// One registered class (sync spec §17 for `leaving`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassEntry {
    pub class_id: String,
    pub path: PathBuf,
    #[serde(default)]
    pub shared: bool,
    #[serde(default)]
    pub joining: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub skip_audio: bool,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// class paths; tramado-sync's managed.rs emits `"(?d)/" + path`
    #[serde(default)]
    pub local_ignores: Vec<String>,
    /// INT (wave 3): `audio.webm` class paths fetched although `skip_audio` is on ("Get the
    /// recording", UX §3.5.2); tramado-sync emits `"!/" + path` before the skip-audio line.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub local_includes: Vec<String>,
    #[serde(default)]
    pub added_at: String,
    #[serde(default)]
    pub leaving: Option<Leaving>,
    /// Fields of a newer version, kept on rewrite.
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

impl ClassEntry {
    /// A new, unshared entry added now.
    pub fn new(class_id: &str, path: PathBuf) -> Self {
        ClassEntry {
            class_id: class_id.to_string(),
            path,
            shared: false,
            joining: false,
            archived: false,
            skip_audio: false,
            aliases: Vec::new(),
            local_ignores: Vec::new(),
            local_includes: Vec::new(),
            added_at: crate::time::instant(crate::time::now_ms()),
            leaving: None,
            unknown: Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Leaving {
    pub since: String,
    /// "keepLocal" | "trash"
    pub afterwards: String,
}

/// What every command whose TS type is `ClassEntry` returns (architecture §5.1, §6.0).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassEntryView {
    #[serde(flatten)]
    pub entry: ClassEntry,
    pub dir_name: String,
    /// The root and `.tramado/class.json` exist.
    pub available: bool,
}

impl ClassEntryView {
    pub fn of(entry: ClassEntry) -> Self {
        let dir_name = entry
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let available =
            entry.path.is_dir() && entry.path.join(".tramado").join("class.json").is_file();
        ClassEntryView {
            entry,
            dir_name,
            available,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryFile {
    #[serde(default = "format_name")]
    format: String,
    #[serde(default = "one")]
    version: u32,
    #[serde(default)]
    root: Option<PathBuf>,
    #[serde(default)]
    left_classes: Vec<String>,
    #[serde(default)]
    classes: Vec<ClassEntry>,
    #[serde(flatten)]
    unknown: Map<String, Value>,
}

fn format_name() -> String {
    FORMAT.to_string()
}

fn one() -> u32 {
    1
}

impl Default for RegistryFile {
    fn default() -> Self {
        RegistryFile {
            format: format_name(),
            version: 1,
            root: None,
            left_classes: Vec::new(),
            classes: Vec::new(),
            unknown: Map::new(),
        }
    }
}

/// A registry observer, called with (before, after).
pub type ChangeFn = dyn Fn(Option<&ClassEntry>, Option<&ClassEntry>) + Send + Sync;
type Subscriber = Arc<ChangeFn>;

pub struct ClassRegistry {
    file: PathBuf,
    state: Mutex<RegistryFile>,
    subscribers: RwLock<Vec<Subscriber>>,
}

/// One change, delivered to subscribers after the lock is released.
type Change = (Option<ClassEntry>, Option<ClassEntry>);

fn same_path(a: &Path, b: &Path) -> bool {
    a == b
        || (a
            .canonicalize()
            .ok()
            .is_some_and(|x| b.canonicalize().ok().is_some_and(|y| x == y)))
}

impl ClassRegistry {
    /// Loads `config/classes.json`. A missing file is an empty registry; an unreadable one is
    /// kept aside as `classes.json.bad-<ms>` and the registry starts empty (the app must start).
    pub fn load(config_dir: &Path) -> AppResult<Self> {
        let file = config_dir.join(FILE_NAME);
        let state = match files::read_optional(&file)? {
            None => RegistryFile::default(),
            Some(bytes) => match serde_json::from_slice::<RegistryFile>(&bytes) {
                Ok(f) => f,
                Err(e) => {
                    let aside =
                        config_dir.join(format!("{FILE_NAME}.bad-{}", crate::time::now_ms()));
                    log::error!(
                        "classes.json is unreadable ({e}); kept aside as {}",
                        aside.display()
                    );
                    std::fs::rename(&file, &aside)?;
                    RegistryFile::default()
                }
            },
        };
        Ok(ClassRegistry {
            file,
            state: Mutex::new(state),
            subscribers: RwLock::new(Vec::new()),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, RegistryFile> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Applies `f` to a copy, writes it, and only then makes it current.
    fn mutate<T>(
        &self,
        f: impl FnOnce(&mut RegistryFile) -> AppResult<(T, Vec<Change>)>,
    ) -> AppResult<T> {
        let (out, changes) = {
            let mut st = self.lock();
            let mut next = st.clone();
            let (out, changes) = f(&mut next)?;
            let bytes = serde_json::to_vec_pretty(&next)?;
            files::write_atomic(&self.file, &bytes)?;
            *st = next;
            (out, changes)
        };
        self.notify(&changes);
        Ok(out)
    }

    fn notify(&self, changes: &[Change]) {
        if changes.is_empty() {
            return;
        }
        let subs: Vec<Subscriber> = self
            .subscribers
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        for (before, after) in changes {
            for s in &subs {
                s(before.as_ref(), after.as_ref());
            }
        }
    }

    pub fn list(&self) -> Vec<ClassEntry> {
        self.lock().classes.clone()
    }

    /// The entry for `class_id`, also when `class_id` is one of its aliases.
    pub fn get(&self, class_id: &str) -> Option<ClassEntry> {
        let st = self.lock();
        st.classes
            .iter()
            .find(|e| e.class_id == class_id)
            .or_else(|| {
                st.classes
                    .iter()
                    .find(|e| e.aliases.iter().any(|a| a == class_id))
            })
            .cloned()
    }

    /// The root folder of a registered class; `NOT_FOUND` if unknown.
    pub fn root(&self, class_id: &str) -> AppResult<PathBuf> {
        self.get(class_id)
            .map(|e| e.path)
            .ok_or_else(|| AppError::not_found("no such class"))
    }

    /// `CONFLICT` on a duplicate ID (aliases included) or folder.
    pub fn insert(&self, e: ClassEntry) -> AppResult<()> {
        if !ids::is_class_id(&e.class_id) {
            return Err(AppError::invalid("bad class id"));
        }
        if !e.path.is_absolute() {
            return Err(AppError::invalid("class folder must be absolute"));
        }
        self.mutate(|st| {
            let taken = st.classes.iter().any(|x| {
                x.class_id == e.class_id
                    || x.aliases.contains(&e.class_id)
                    || same_path(&x.path, &e.path)
            });
            if taken {
                return Err(AppError::new(Code::Conflict, "class already registered"));
            }
            st.classes.push(e.clone());
            Ok(((), vec![(None, Some(e))]))
        })
    }

    /// Changes an entry in place (its ID cannot change here: see [`ClassRegistry::rename_id`]).
    pub fn update(&self, class_id: &str, f: impl FnOnce(&mut ClassEntry)) -> AppResult<ClassEntry> {
        self.mutate(|st| {
            let e = st
                .classes
                .iter_mut()
                .find(|e| e.class_id == class_id || e.aliases.iter().any(|a| a == class_id))
                .ok_or_else(|| AppError::not_found("no such class"))?;
            let before = e.clone();
            f(e);
            if e.class_id != before.class_id || !e.path.is_absolute() {
                return Err(AppError::invalid(
                    "an update cannot change the class id or make the path relative",
                ));
            }
            let after = e.clone();
            Ok((after.clone(), vec![(Some(before), Some(after))]))
        })
    }

    pub fn remove(&self, class_id: &str) -> AppResult<()> {
        self.mutate(|st| {
            let i = st
                .classes
                .iter()
                .position(|e| e.class_id == class_id)
                .ok_or_else(|| AppError::not_found("no such class"))?;
            let before = st.classes.remove(i);
            Ok(((), vec![(Some(before), None)]))
        })
    }

    /// Fork (sync spec §17) and rotation (v1.1): the entry gets `new` as its ID and keeps `old`
    /// as an alias.
    pub fn rename_id(&self, old: &str, new: &str) -> AppResult<()> {
        if !ids::is_class_id(new) {
            return Err(AppError::invalid("bad class id"));
        }
        self.mutate(|st| {
            if st
                .classes
                .iter()
                .any(|e| e.class_id == new || e.aliases.iter().any(|a| a == new))
            {
                return Err(AppError::new(Code::Conflict, "class id already registered"));
            }
            let e = st
                .classes
                .iter_mut()
                .find(|e| e.class_id == old)
                .ok_or_else(|| AppError::not_found("no such class"))?;
            let before = e.clone();
            e.class_id = new.to_string();
            if !e.aliases.iter().any(|a| a == old) {
                e.aliases.push(old.to_string());
            }
            Ok(((), vec![(Some(before), Some(e.clone()))]))
        })
    }

    /// Classes this device left (top-level `leftClasses`): their offers are dropped silently.
    pub fn left_classes(&self) -> Vec<String> {
        self.lock().left_classes.clone()
    }

    pub fn add_left_class(&self, id: &str) -> AppResult<()> {
        self.mutate(|st| {
            if !st.left_classes.iter().any(|x| x == id) {
                st.left_classes.push(id.to_string());
            }
            Ok(((), Vec::new()))
        })
    }

    /// Where new classes are created (top-level `root`), if the user chose one.
    pub fn root_dir(&self) -> Option<PathBuf> {
        self.lock().root.clone()
    }

    pub fn set_root_dir(&self, p: PathBuf) -> AppResult<()> {
        if !p.is_absolute() {
            return Err(AppError::invalid("classes root must be absolute"));
        }
        self.mutate(|st| {
            st.root = Some(p);
            Ok(((), Vec::new()))
        })
    }

    /// Called with (before, after) after every change of an entry: `(None, Some)` added,
    /// `(Some, None)` removed, `(Some, Some)` changed. Never called with the lock held.
    pub fn subscribe(&self, f: Box<ChangeFn>) {
        self.subscribers
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .push(Arc::from(f));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const A: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "tramado-bbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn round_trip_keeps_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = dir.path().join("config");
        std::fs::create_dir_all(&cfg).unwrap();
        let root = dir.path().join("Direito");
        std::fs::write(
            cfg.join(FILE_NAME),
            serde_json::json!({
                "format": "tramado.classes", "version": 1, "root": null, "leftClasses": [], "future": {"x": 1},
                "classes": [{"classId": A, "path": root, "shared": true, "archived": false, "aliases": [],
                             "localIgnores": ["Docs/big.pdf"], "addedAt": "2026-11-03T10:00:00.000Z", "colourHint": "#3e63dd"}]
            })
            .to_string(),
        )
        .unwrap();
        let reg = ClassRegistry::load(&cfg).unwrap();
        let e = reg.get(A).unwrap();
        assert!(e.shared && !e.joining && !e.skip_audio && e.leaving.is_none());
        assert_eq!(e.local_ignores, vec!["Docs/big.pdf"]);
        reg.update(A, |e| e.archived = true).unwrap();
        let v: Value =
            serde_json::from_slice(&std::fs::read(cfg.join(FILE_NAME)).unwrap()).unwrap();
        assert_eq!(v["future"], serde_json::json!({"x": 1}));
        assert_eq!(v["classes"][0]["colourHint"], "#3e63dd");
        assert_eq!(v["classes"][0]["archived"], true);
        assert_eq!(v["classes"][0]["leaving"], Value::Null);
        let again = ClassRegistry::load(&cfg).unwrap();
        assert!(again.get(A).unwrap().archived);
    }

    #[test]
    fn insert_update_rename_remove() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ClassRegistry::load(dir.path()).unwrap();
        let seen = Arc::new(AtomicUsize::new(0));
        let s = seen.clone();
        reg.subscribe(Box::new(move |_, _| {
            s.fetch_add(1, Ordering::SeqCst);
        }));
        let root = dir.path().join("Biologia");
        reg.insert(ClassEntry::new(A, root.clone())).unwrap();
        assert_eq!(
            reg.insert(ClassEntry::new(A, dir.path().join("x")))
                .unwrap_err()
                .code(),
            Code::Conflict
        );
        assert_eq!(
            reg.insert(ClassEntry::new(B, root.clone()))
                .unwrap_err()
                .code(),
            Code::Conflict
        );
        assert_eq!(
            reg.insert(ClassEntry::new("bad", dir.path().join("y")))
                .unwrap_err()
                .code(),
            Code::Invalid
        );
        assert_eq!(reg.root(A).unwrap(), root);
        assert_eq!(reg.root(B).unwrap_err().code(), Code::NotFound);
        assert_eq!(
            reg.update(A, |e| e.class_id = B.into()).unwrap_err().code(),
            Code::Invalid
        );
        reg.rename_id(A, B).unwrap();
        assert_eq!(
            reg.get(A).unwrap().class_id,
            B,
            "the old id resolves as an alias"
        );
        assert_eq!(reg.get(B).unwrap().aliases, vec![A]);
        assert_eq!(
            reg.insert(ClassEntry::new(A, dir.path().join("z")))
                .unwrap_err()
                .code(),
            Code::Conflict
        );
        reg.add_left_class(A).unwrap();
        reg.add_left_class(A).unwrap();
        assert_eq!(reg.left_classes(), vec![A]);
        reg.set_root_dir(dir.path().join("Aulas")).unwrap();
        assert_eq!(reg.root_dir(), Some(dir.path().join("Aulas")));
        reg.remove(B).unwrap();
        assert!(reg.list().is_empty());
        assert_eq!(seen.load(Ordering::SeqCst), 3, "insert, rename, remove");
        let reloaded = ClassRegistry::load(dir.path()).unwrap();
        assert_eq!(reloaded.left_classes(), vec![A]);
        assert_eq!(reloaded.root_dir(), Some(dir.path().join("Aulas")));
    }

    #[test]
    fn unreadable_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"{not json").unwrap();
        let reg = ClassRegistry::load(dir.path()).unwrap();
        assert!(reg.list().is_empty());
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            names.iter().any(|n| n.starts_with("classes.json.bad-")),
            "{names:?}"
        );
    }

    #[test]
    fn view_reports_availability() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Estatística");
        let v = ClassEntryView::of(ClassEntry::new(A, root.clone()));
        assert!(!v.available);
        assert_eq!(v.dir_name, "Estatística");
        std::fs::create_dir_all(root.join(".tramado")).unwrap();
        std::fs::write(root.join(".tramado/class.json"), b"{}").unwrap();
        let v = ClassEntryView::of(ClassEntry::new(A, root));
        assert!(v.available);
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(json["classId"], A);
        assert_eq!(json["dirName"], "Estatística");
        assert_eq!(json["available"], true);
        assert_eq!(json["leaving"], Value::Null);
        assert_eq!(json["skipAudio"], false);
    }
}
