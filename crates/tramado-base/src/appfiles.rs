// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! App files the webview may read and write (architecture §6.1, §13): an allow-list of three
//! files, the per-class private folder `data/private/<classId>/` (never synced; `mirror/` is
//! Rust's) and cache keys.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::confine;
use crate::error::{AppError, AppResult};
use crate::files;
use crate::ids;
use crate::paths::Paths;
use crate::registry::ClassRegistry;

/// TS `AppFileName`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppFile {
    /// config/prefs.json
    #[serde(rename = "prefs.json")]
    Prefs,
    /// config/identity.json
    #[serde(rename = "identity.json")]
    Identity,
    /// data/hlc.json
    #[serde(rename = "hlc.json")]
    Hlc,
}

impl AppFile {
    pub fn name(self) -> &'static str {
        match self {
            AppFile::Prefs => "prefs.json",
            AppFile::Identity => "identity.json",
            AppFile::Hlc => "hlc.json",
        }
    }

    /// `INVALID` for anything but the three names.
    pub fn from_name(name: &str) -> AppResult<Self> {
        match name {
            "prefs.json" => Ok(AppFile::Prefs),
            "identity.json" => Ok(AppFile::Identity),
            "hlc.json" => Ok(AppFile::Hlc),
            _ => Err(AppError::invalid("not an app file")),
        }
    }

    pub fn path(self, paths: &Paths) -> PathBuf {
        match self {
            AppFile::Prefs | AppFile::Identity => paths.config.join(self.name()),
            AppFile::Hlc => paths.data.join(self.name()),
        }
    }
}

/// The text of an app file, `None` when it does not exist yet.
pub fn read(paths: &Paths, f: AppFile) -> AppResult<Option<String>> {
    match files::read_optional(&f.path(paths))? {
        None => Ok(None),
        Some(b) => String::from_utf8(b)
            .map(Some)
            .map_err(|_| AppError::invalid("app file is not UTF-8")),
    }
}

/// Atomic write.
pub fn write(paths: &Paths, f: AppFile, text: &str) -> AppResult<()> {
    files::write_atomic(&f.path(paths), text.as_bytes())
}

/// `data/private/<classId>` for a well-formed class ID.
pub fn private_root(paths: &Paths, class: &str) -> AppResult<PathBuf> {
    if !ids::is_class_id(class) {
        return Err(AppError::invalid("bad class id"));
    }
    Ok(paths.private_dir(class))
}

/// A path inside `data/private/<classId>/`: class path rules, no symlinks, and never
/// `mirror/…` (Rust's own copies).
pub fn private_path(paths: &Paths, class: &str, rel: &str) -> AppResult<PathBuf> {
    let root = private_root(paths, class)?;
    if rel == "mirror" || rel.starts_with("mirror/") {
        return Err(AppError::invalid("mirror/ is not for the webview"));
    }
    confine::confine(&root, rel)
}

/// `^(text/[0-9a-f]{64}\.json|peaks/[0-9a-f]{64}-\d{2,5}\.json|models-catalog\.json|ocr/[0-9a-f]{64}\.json)$`
pub fn is_cache_key(key: &str) -> bool {
    if key == "models-catalog.json" {
        return true;
    }
    let hashed = |prefix: &str| {
        key.strip_prefix(prefix)
            .and_then(|r| r.strip_suffix(".json"))
            .is_some_and(ids::is_hex64)
    };
    if hashed("text/") || hashed("ocr/") {
        return true;
    }
    key.strip_prefix("peaks/")
        .and_then(|r| r.strip_suffix(".json"))
        .and_then(|r| r.split_once('-'))
        .is_some_and(|(hash, n)| {
            ids::is_hex64(hash)
                && (2..=5).contains(&n.len())
                && n.bytes().all(|b| b.is_ascii_digit())
        })
}

/// `app_cache_dir/<key>` for an allowed key.
pub fn cache_path(paths: &Paths, key: &str) -> AppResult<PathBuf> {
    if !is_cache_key(key) {
        return Err(AppError::invalid("not a cache key"));
    }
    Ok(files::join_rel(&paths.cache, key))
}

/// TS `StorageUsage` (bytes).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub classes: Vec<ClassUsage>,
    pub models: u64,
    pub cache: u64,
    pub private_data: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassUsage {
    pub class_id: String,
    /// everything under the class root, the trashcan included
    pub total: u64,
    /// audio files outside the trashcan
    pub audio: u64,
    /// `<root>/.stversions` (the class's 30-day trashcan on this computer)
    pub trash: u64,
}

const AUDIO_EXT: [&str; 8] = ["webm", "ogg", "oga", "opus", "mp3", "m4a", "wav", "flac"];

fn class_usage(class_id: &str, root: &std::path::Path) -> ClassUsage {
    let trash_dir = root.join(".stversions");
    let mut u = ClassUsage {
        class_id: class_id.to_string(),
        ..ClassUsage::default()
    };
    for e in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if !e.file_type().is_file() {
            continue;
        }
        let Ok(m) = e.metadata() else { continue };
        u.total += m.len();
        if e.path().starts_with(&trash_dir) {
            u.trash += m.len();
        } else if e
            .path()
            .extension()
            .and_then(|x| x.to_str())
            .is_some_and(|x| AUDIO_EXT.contains(&x.to_ascii_lowercase().as_str()))
        {
            u.audio += m.len();
        }
    }
    u
}

/// Walks every class root (trashcan included), the models, the cache and the private data.
pub fn storage_usage(paths: &Paths, registry: &ClassRegistry) -> StorageUsage {
    StorageUsage {
        classes: registry
            .list()
            .iter()
            .map(|e| class_usage(&e.class_id, &e.path))
            .collect(),
        models: files::dir_size(&paths.models_dir()),
        cache: files::dir_size(&paths.cache),
        private_data: files::dir_size(&paths.data.join("private")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Code;
    use crate::registry::ClassEntry;

    const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn app_files_are_allow_listed() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::for_tests(dir.path());
        for bad in [
            "classes.json",
            "secrets.json",
            "../prefs.json",
            "",
            "prefs.json/",
        ] {
            assert_eq!(
                AppFile::from_name(bad).unwrap_err().code(),
                Code::Invalid,
                "{bad}"
            );
        }
        assert_eq!(read(&paths, AppFile::Prefs).unwrap(), None);
        write(&paths, AppFile::Prefs, "{\"ui.locale\":\"pt\"}").unwrap();
        write(&paths, AppFile::Hlc, "{}").unwrap();
        assert_eq!(
            read(&paths, AppFile::Prefs).unwrap().as_deref(),
            Some("{\"ui.locale\":\"pt\"}")
        );
        assert!(paths.config.join("prefs.json").is_file());
        assert!(paths.data.join("hlc.json").is_file());
        assert_eq!(
            serde_json::to_value(AppFile::Identity).unwrap(),
            "identity.json"
        );
    }

    #[test]
    fn private_paths_refuse_the_mirror() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::for_tests(dir.path());
        assert_eq!(
            private_path(&paths, CLASS, "ask/01JBX4Q7Z5W8M2E3C9R6T0YH2K.jsonl").unwrap(),
            paths
                .private_dir(CLASS)
                .join("ask")
                .join("01JBX4Q7Z5W8M2E3C9R6T0YH2K.jsonl")
        );
        assert!(private_path(&paths, CLASS, "trusted/.tramado/members/X.json").is_ok());
        for bad in ["mirror", "mirror/a.json", "../x", ""] {
            assert_eq!(
                private_path(&paths, CLASS, bad).unwrap_err().code(),
                Code::Invalid,
                "{bad}"
            );
        }
        assert_eq!(
            private_path(&paths, "bad", "a").unwrap_err().code(),
            Code::Invalid
        );
    }

    #[test]
    fn cache_keys() {
        let h = "0".repeat(64);
        for ok in [
            format!("text/{h}.json"),
            format!("ocr/{h}.json"),
            format!("peaks/{h}-1000.json"),
            format!("peaks/{h}-10.json"),
            "models-catalog.json".to_string(),
        ] {
            assert!(is_cache_key(&ok), "{ok}");
        }
        for bad in [
            format!("text/{h}.txt"),
            format!("peaks/{h}-1.json"),
            format!("peaks/{h}-123456.json"),
            format!("peaks/{h}.json"),
            format!("text/{}.json", "A".repeat(64)),
            "../models-catalog.json".to_string(),
            "models-catalog.json/".to_string(),
        ] {
            assert!(!is_cache_key(&bad), "{bad}");
        }
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::for_tests(dir.path());
        assert_eq!(
            cache_path(&paths, &format!("text/{h}.json")).unwrap(),
            paths.cache.join("text").join(format!("{h}.json"))
        );
    }

    #[test]
    fn storage_usage_counts_audio_and_trash() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::for_tests(dir.path());
        let reg = ClassRegistry::load(&paths.config).unwrap();
        let root = dir.path().join("classes").join("Bio");
        for (p, n) in [
            ("Aulas/A1/audio.webm", 100usize),
            ("Docs/a.pdf", 10),
            (".stversions/Docs/old.pdf", 5),
        ] {
            let f = files::join_rel(&root, p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, vec![0u8; n]).unwrap();
        }
        reg.insert(ClassEntry::new(CLASS, root)).unwrap();
        std::fs::create_dir_all(&paths.cache).unwrap();
        std::fs::write(paths.cache.join("models-catalog.json"), b"{}").unwrap();
        let u = storage_usage(&paths, &reg);
        assert_eq!(
            u.classes,
            vec![ClassUsage {
                class_id: CLASS.into(),
                total: 115,
                audio: 100,
                trash: 5
            }]
        );
        assert_eq!(u.cache, 2);
        assert_eq!(u.models, 0);
    }
}
