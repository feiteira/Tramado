// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Where Tramado keeps its files (architecture §5.1 `paths`, §13; folder spec §12).
//!
//! `TRAMADO_DATA_DIR` (development and end-to-end tests) moves the three roots to
//! `$TRAMADO_DATA_DIR/{config,data,cache}` and new classes to `$TRAMADO_DATA_DIR/classes`; it
//! also disables single-instance, forces the secrets file and keeps Syncthing on loopback.
//! `TRAMADO_E2E=1` is honoured only together with it.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The bundled voice-activity model (architecture §18.2).
pub const VAD_FILE: &str = "ggml-silero-v5.1.2.bin";

#[derive(Debug, Clone)]
pub struct Paths {
    /// app_config_dir or $TRAMADO_DATA_DIR/config
    pub config: PathBuf,
    /// app_local_data_dir or $TRAMADO_DATA_DIR/data
    pub data: PathBuf,
    /// app_cache_dir or $TRAMADO_DATA_DIR/cache
    pub cache: PathBuf,
    /// Tauri's resource_dir (None in unit tests)
    pub resources: Option<PathBuf>,
    /// ~/Tramado or $TRAMADO_DATA_DIR/classes
    pub default_classes_root: PathBuf,
    /// TRAMADO_DATA_DIR set
    pub dev_isolated: bool,
    /// TRAMADO_E2E=1 (only honoured when dev_isolated)
    pub e2e: bool,
    /// TRAMADO_SPEECH_DIR (absolute), when set
    speech_dir: Option<PathBuf>,
}

fn absolute(p: PathBuf) -> PathBuf {
    if p.is_relative() {
        // A relative path would move with the working directory between launches.
        if let Ok(cwd) = std::env::current_dir() {
            return cwd.join(p);
        }
    }
    p
}

fn non_empty(v: Option<OsString>) -> Option<OsString> {
    v.filter(|s| !s.is_empty())
}

impl Paths {
    /// The platform directories, with the environment overrides applied.
    pub fn resolve(
        config: PathBuf,
        data: PathBuf,
        cache: PathBuf,
        home: PathBuf,
        resources: Option<PathBuf>,
    ) -> Self {
        Self::resolve_with(
            |k| std::env::var_os(k),
            config,
            data,
            cache,
            home,
            resources,
        )
    }

    /// [`Paths::resolve`] with an explicit environment (tests).
    pub fn resolve_with(
        env: impl Fn(&str) -> Option<OsString>,
        config: PathBuf,
        data: PathBuf,
        cache: PathBuf,
        home: PathBuf,
        resources: Option<PathBuf>,
    ) -> Self {
        let speech_dir = non_empty(env("TRAMADO_SPEECH_DIR")).map(|d| absolute(PathBuf::from(d)));
        if let Some(dir) = non_empty(env("TRAMADO_DATA_DIR")) {
            let dir = absolute(PathBuf::from(dir));
            let e2e = env("TRAMADO_E2E").is_some_and(|v| v == "1");
            return Paths {
                config: dir.join("config"),
                data: dir.join("data"),
                cache: dir.join("cache"),
                resources,
                default_classes_root: dir.join("classes"),
                dev_isolated: true,
                e2e,
                speech_dir,
            };
        }
        Paths {
            config,
            data,
            cache,
            resources,
            default_classes_root: home.join("Tramado"),
            dev_isolated: false,
            e2e: false,
            speech_dir,
        }
    }

    /// Paths under one directory, as with `TRAMADO_DATA_DIR` (unit tests of other modules).
    pub fn for_tests(dir: &Path) -> Self {
        Paths {
            config: dir.join("config"),
            data: dir.join("data"),
            cache: dir.join("cache"),
            resources: None,
            default_classes_root: dir.join("classes"),
            dev_isolated: true,
            e2e: false,
            speech_dir: None,
        }
    }

    /// data/syncthing
    pub fn syncthing_home(&self) -> PathBuf {
        self.data.join("syncthing")
    }

    /// $TRAMADO_SPEECH_DIR or data/models
    pub fn models_dir(&self) -> PathBuf {
        self.speech_dir
            .clone()
            .unwrap_or_else(|| self.data.join("models"))
    }

    /// data/recordings
    pub fn recordings_dir(&self) -> PathBuf {
        self.data.join("recordings")
    }

    /// data/transcribe
    pub fn transcribe_dir(&self) -> PathBuf {
        self.data.join("transcribe")
    }

    /// data/private/<classId> (the caller validates the class ID)
    pub fn private_dir(&self, class: &str) -> PathBuf {
        self.data.join("private").join(class)
    }

    /// data/logs
    pub fn logs_dir(&self) -> PathBuf {
        self.data.join("logs")
    }

    /// The Silero VAD model: in the models folder, else the bundled resource.
    pub fn vad_path(&self) -> Option<PathBuf> {
        let in_models = self.models_dir().join(VAD_FILE);
        if in_models.is_file() {
            return Some(in_models);
        }
        let bundled = self.resources.as_ref()?.join("speech").join(VAD_FILE);
        bundled.is_file().then_some(bundled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(map: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let m: HashMap<String, OsString> = map
            .iter()
            .map(|(k, v)| (k.to_string(), OsString::from(v)))
            .collect();
        move |k| m.get(k).cloned()
    }

    fn platform() -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        (
            PathBuf::from("/c/eu.thehumanloop.tramado"),
            PathBuf::from("/d/eu.thehumanloop.tramado"),
            PathBuf::from("/k/eu.thehumanloop.tramado"),
            PathBuf::from("/home/ana"),
        )
    }

    #[test]
    fn platform_directories_by_default() {
        let (c, d, k, h) = platform();
        let p = Paths::resolve_with(
            env(&[("TRAMADO_E2E", "1")]),
            c.clone(),
            d.clone(),
            k,
            h,
            None,
        );
        assert_eq!(p.config, c);
        assert_eq!(p.default_classes_root, PathBuf::from("/home/ana/Tramado"));
        assert!(!p.dev_isolated);
        assert!(!p.e2e, "TRAMADO_E2E alone is ignored");
        assert_eq!(p.syncthing_home(), d.join("syncthing"));
        assert_eq!(p.models_dir(), d.join("models"));
        assert_eq!(
            p.private_dir("tramado-x"),
            d.join("private").join("tramado-x")
        );
        assert_eq!(p.vad_path(), None);
    }

    #[test]
    fn data_dir_override() {
        let (c, d, k, h) = platform();
        let p = Paths::resolve_with(
            env(&[
                ("TRAMADO_DATA_DIR", "/tmp/dev"),
                ("TRAMADO_E2E", "1"),
                ("TRAMADO_SPEECH_DIR", "/m"),
            ]),
            c,
            d,
            k,
            h,
            None,
        );
        assert_eq!(p.config, PathBuf::from("/tmp/dev/config"));
        assert_eq!(p.data, PathBuf::from("/tmp/dev/data"));
        assert_eq!(p.cache, PathBuf::from("/tmp/dev/cache"));
        assert_eq!(p.default_classes_root, PathBuf::from("/tmp/dev/classes"));
        assert!(p.dev_isolated && p.e2e);
        assert_eq!(p.models_dir(), PathBuf::from("/m"));
        let rel = Paths::resolve_with(
            env(&[("TRAMADO_DATA_DIR", "rel")]),
            PathBuf::new(),
            PathBuf::new(),
            PathBuf::new(),
            PathBuf::new(),
            None,
        );
        assert!(rel.config.is_absolute());
    }

    #[test]
    fn vad_from_models_then_resources() {
        let dir = tempfile::tempdir().unwrap();
        let res = dir.path().join("res");
        std::fs::create_dir_all(res.join("speech")).unwrap();
        let mut p = Paths::for_tests(dir.path());
        p.resources = Some(res.clone());
        assert_eq!(p.vad_path(), None);
        std::fs::write(res.join("speech").join(VAD_FILE), b"x").unwrap();
        assert_eq!(p.vad_path(), Some(res.join("speech").join(VAD_FILE)));
        std::fs::create_dir_all(p.models_dir()).unwrap();
        std::fs::write(p.models_dir().join(VAD_FILE), b"x").unwrap();
        assert_eq!(p.vad_path(), Some(p.models_dir().join(VAD_FILE)));
    }
}
