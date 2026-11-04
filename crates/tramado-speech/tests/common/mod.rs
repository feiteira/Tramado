// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Shared set-up of the integration tests: a temporary app data folder, one registered class,
//! this device's ID, and a `Speech` handle over them.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use tramado_base::classfs::ClassFs;
use tramado_base::error::{AppError, AppResult};
use tramado_base::paths::Paths;
use tramado_base::registry::{ClassEntry, ClassRegistry};
use tramado_net::ai::AiBody;
use tramado_speech::{Sink, Speech, SpeechConfig, SttTransport};

pub const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
pub const ME: &str = "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";

pub struct Env {
    pub dir: tempfile::TempDir,
    pub paths: Arc<Paths>,
    pub fs: Arc<ClassFs>,
    pub root: PathBuf,
    pub speech: Speech,
}

/// A cloud transport that refuses everything (tests that never reach the network).
pub struct NoCloud;

impl SttTransport for NoCloud {
    fn post(&self, _p: &str, _b: AiBody, _t: Duration) -> AppResult<(u16, Vec<u8>)> {
        Err(AppError::invalid("no cloud in this test"))
    }
}

/// A temporary installation. `speech_dir`: where the models are (`TRAMADO_SPEECH_DIR`).
pub fn env(speech_dir: Option<&Path>, stt: Arc<dyn SttTransport>) -> Env {
    let dir = tempfile::tempdir().unwrap();
    let sd = speech_dir.map(|p| p.as_os_str().to_owned());
    let paths = Arc::new(Paths::resolve_with(
        move |k| {
            if k == "TRAMADO_SPEECH_DIR" {
                sd.clone()
            } else {
                None
            }
        },
        dir.path().join("config"),
        dir.path().join("data"),
        dir.path().join("cache"),
        dir.path().join("home"),
        None,
    ));
    let reg = Arc::new(ClassRegistry::load(&paths.config).unwrap());
    let root = dir.path().join("classes").join("Direito Constitucional");
    std::fs::create_dir_all(root.join(".tramado")).unwrap();
    reg.insert(ClassEntry::new(CLASS, root.clone())).unwrap();
    let fs = Arc::new(ClassFs::new(paths.clone(), reg));
    fs.set_device(ME);
    let speech = Speech::new(SpeechConfig {
        paths: paths.clone(),
        fs: fs.clone(),
        stt,
        version: "test".into(),
    });
    Env {
        dir,
        paths,
        fs,
        root,
        speech,
    }
}

/// Collects a channel's events and lets a test wait for one.
pub struct Collect<E> {
    pub events: Mutex<Vec<E>>,
    cv: Condvar,
}

impl<E: Clone> Collect<E> {
    pub fn new() -> Arc<Self> {
        Arc::new(Collect {
            events: Mutex::new(Vec::new()),
            cv: Condvar::new(),
        })
    }

    pub fn all(&self) -> Vec<E> {
        self.events.lock().unwrap().clone()
    }

    /// Waits until `f` matches an event.
    pub fn wait(&self, timeout: Duration, f: impl Fn(&E) -> bool) -> Option<E> {
        let deadline = std::time::Instant::now() + timeout;
        let mut ev = self.events.lock().unwrap();
        loop {
            if let Some(e) = ev.iter().find(|e| f(e)) {
                return Some(e.clone());
            }
            let now = std::time::Instant::now();
            if now >= deadline {
                return None;
            }
            ev = self.cv.wait_timeout(ev, deadline - now).unwrap().0;
        }
    }
}

impl<E: Clone + Send> Sink<E> for Collect<E> {
    fn send(&self, e: E) -> bool {
        self.events.lock().unwrap().push(e);
        self.cv.notify_all();
        true
    }
}

/// The repository's speech fixtures (`app/test-fixtures/tramado/audio`).
pub fn fixture_audio(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/test-fixtures/tramado/audio")
        .join(name)
}

/// A path from the environment: relative ones are taken from the repository root (cargo runs
/// integration tests in the crate's folder; the plan's commands run from the root).
pub fn env_path(var: &str) -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os(var).filter(|v| !v.is_empty())?);
    if p.is_absolute() || p.exists() {
        return Some(p);
    }
    Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(p))
}

/// This crate's own test fixtures.
pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// A speech-like test signal: syllables of a few voiced tones with pauses (not speech; it
/// exercises the pipeline, not the model).
pub fn speechlike(secs: f64, seed: u32) -> Vec<f32> {
    let n = (secs * 16_000.0) as usize;
    let mut s = seed | 1;
    let mut rnd = move || {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        s as f32 / u32::MAX as f32
    };
    let mut out = Vec::with_capacity(n);
    let mut i = 0;
    while i < n {
        // A "word" of 150-450 ms, then 50-600 ms of quiet.
        let word = (2_400.0 + rnd() * 4_800.0) as usize;
        let pause = (800.0 + rnd() * 8_800.0) as usize;
        let f0 = 110.0 + rnd() * 120.0;
        for k in 0..word.min(n - i) {
            let t = k as f32 / 16_000.0;
            let env = (std::f32::consts::PI * k as f32 / word as f32).sin();
            let v = (0..4)
                .map(|h| {
                    (2.0 * std::f32::consts::PI * f0 * (h + 1) as f32 * t).sin() / (h + 1) as f32
                })
                .sum::<f32>();
            out.push(0.25 * env * v + 0.01 * (rnd() - 0.5));
        }
        i += word.min(n - i);
        for _ in 0..pause.min(n - i) {
            out.push(0.002 * (rnd() - 0.5));
        }
        i += pause.min(n - i);
    }
    out.truncate(n);
    out
}
