// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The transcription claim's heartbeat (architecture §5.4 "claim file hand-over", sync spec
//! §14.5, critique C37): from `speech_transcribe_start(req{claim})` until the result is taken
//! or the job cancelled, Rust is the only writer of the claim file. Every 60 s it rewrites it —
//! `status: "working"`, `heartbeat + 1`, `progress`, `etaMs`, `updatedAt`, **every other field
//! kept as it was, unknown ones included** — and records `lastHeartbeatWallMs` in
//! `data/transcribe/<lectureId>.json`. A finished but untaken result keeps the claim `working`
//! at `progress: 1.0` (a hidden or reloading webview never lets a completed claim go stale);
//! a failure writes `status: "failed"` with `error` once and stops.

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tramado_base::classfs::ClassFs;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::{files, time};

use crate::types::ClaimRef;

/// Sync spec §14.1 `HEARTBEAT_MS`.
pub const EVERY: Duration = Duration::from_secs(60);

/// Where the job stands, as the heartbeat reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Beat {
    Working { progress: f64, eta_ms: Option<u64> },
    /// Done, result untaken: `working` at `progress: 1.0`.
    Finished,
    Failed(Code),
}

/// Rewrites a claim in place: `status`, `heartbeat + 1`, `progress`, `etaMs`, `updatedAt`
/// (and `error` when failed); everything else is kept.
pub fn rewrite(claim: &mut Value, beat: Beat, now_ms: u64) -> AppResult<()> {
    let obj = claim
        .as_object_mut()
        .ok_or_else(|| AppError::invalid("a claim file is a JSON object"))?;
    let hb = obj.get("heartbeat").and_then(Value::as_u64).unwrap_or(0);
    obj.insert("heartbeat".into(), json!(hb + 1));
    obj.insert("updatedAt".into(), json!(time::instant(now_ms)));
    match beat {
        Beat::Working { progress, eta_ms } => {
            obj.insert("status".into(), json!("working"));
            obj.insert("progress".into(), json!(progress.clamp(0.0, 1.0)));
            match eta_ms {
                Some(e) => obj.insert("etaMs".into(), json!(e)),
                None => obj.remove("etaMs"),
            };
        }
        Beat::Finished => {
            obj.insert("status".into(), json!("working"));
            obj.insert("progress".into(), json!(1.0));
            obj.insert("etaMs".into(), json!(0));
        }
        Beat::Failed(code) => {
            obj.insert("status".into(), json!("failed"));
            obj.insert("error".into(), json!(code.as_str()));
            obj.remove("etaMs");
        }
    }
    Ok(())
}

/// `data/transcribe/<lectureId>.json` (sync spec §14.5 "on app start").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LectureState {
    pub lecture_id: String,
    pub job_id: String,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_heartbeat_wall_ms: Option<u64>,
    /// When the result was taken (results are kept 7 days after, sync spec §14.5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taken_at_ms: Option<u64>,
}

pub fn state_path(dir: &std::path::Path, lecture_id: &str) -> PathBuf {
    dir.join(format!("{lecture_id}.json"))
}

pub fn read_state(dir: &std::path::Path, lecture_id: &str) -> Option<LectureState> {
    let b = files::read_optional(&state_path(dir, lecture_id)).ok()??;
    serde_json::from_slice(&b).ok()
}

pub fn write_state(dir: &std::path::Path, s: &LectureState) -> AppResult<()> {
    files::write_atomic(&state_path(dir, &s.lecture_id), &serde_json::to_vec_pretty(s)?)
}

#[derive(Default)]
struct Signal {
    stop: bool,
    failed: Option<Code>,
}

/// The heartbeat thread of one job.
pub struct Heartbeat {
    signal: Arc<(Mutex<Signal>, Condvar)>,
    handle: Option<JoinHandle<()>>,
}

/// What the heartbeat needs to know each time it beats.
pub type BeatSource = Arc<dyn Fn() -> Beat + Send + Sync>;

impl Heartbeat {
    /// Starts beating every `every` (the first rewrite after `every`: TS wrote the claim
    /// `working` just before starting the job).
    pub fn start(
        fs: Arc<ClassFs>,
        state_dir: PathBuf,
        mut state: LectureState,
        claim: ClaimRef,
        every: Duration,
        source: BeatSource,
    ) -> AppResult<Heartbeat> {
        let signal: Arc<(Mutex<Signal>, Condvar)> = Arc::new(Default::default());
        let sig = signal.clone();
        let handle = std::thread::Builder::new()
            .name("tramado-heartbeat".into())
            .spawn(move || {
                let mut file = claim.file.clone();
                loop {
                    let failed = {
                        let (lock, cv) = &*sig;
                        let guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                        let (guard, _) = cv
                            .wait_timeout_while(guard, every, |s| !s.stop && s.failed.is_none())
                            .unwrap_or_else(|e| e.into_inner());
                        if guard.stop && guard.failed.is_none() {
                            return;
                        }
                        guard.failed
                    };
                    let beat = match failed {
                        Some(code) => Beat::Failed(code),
                        None => source(),
                    };
                    let now = time::now_ms();
                    let written = rewrite(&mut file, beat, now).and_then(|()| {
                        let bytes = serde_json::to_vec(&file)?;
                        fs.write(&claim.class_id, &claim.path, &bytes, true)
                    });
                    match written {
                        Ok(_) => {
                            state.last_heartbeat_wall_ms = Some(now);
                            if let Err(e) = write_state(&state_dir, &state) {
                                log::warn!("transcription state not written: {e}");
                            }
                        }
                        Err(e) => log::warn!("claim heartbeat not written: {e}"),
                    }
                    if matches!(beat, Beat::Failed(_)) {
                        return;
                    }
                }
            })?;
        Ok(Heartbeat {
            signal,
            handle: Some(handle),
        })
    }

    /// Writes `status: "failed"` with `error` at once, then stops.
    pub fn fail(&mut self, code: Code) {
        {
            let (lock, cv) = &*self.signal;
            let mut s = lock.lock().unwrap_or_else(|e| e.into_inner());
            s.failed = Some(code);
            cv.notify_all();
        }
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }

    /// Stops beating (the result was taken, or the job cancelled): the claim is TS's again.
    pub fn stop(&mut self) {
        {
            let (lock, cv) = &*self.signal;
            let mut s = lock.lock().unwrap_or_else(|e| e.into_inner());
            s.stop = true;
            cv.notify_all();
        }
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Heartbeat {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tramado_base::paths::Paths;
    use tramado_base::registry::{ClassEntry, ClassRegistry};

    const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ME: &str = "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";
    const LECTURE: &str = "01JBX4Q7Z5W8M2E3C9R6T0YH2K";

    #[test]
    fn claim_heartbeat_preserves_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Arc::new(Paths::for_tests(dir.path()));
        let reg = Arc::new(ClassRegistry::load(&paths.config).unwrap());
        let root = dir.path().join("classes").join("Direito");
        std::fs::create_dir_all(root.join(".tramado")).unwrap();
        reg.insert(ClassEntry::new(CLASS, root.clone())).unwrap();
        let fs = Arc::new(ClassFs::new(paths.clone(), reg));
        fs.set_device(ME);
        let path = format!(".tramado/claims/{LECTURE}/{ME}.json");
        let file = json!({
            "format": "tramado.claim", "version": 1, "kind": "transcribe", "lectureId": LECTURE,
            "round": 1, "deviceId": ME, "memberId": "b6xq2l4p7vjk3m5n2c7hzr4wte",
            "claimedAt": 1_793_721_438_157u64, "status": "working", "heartbeat": 1,
            "updatedAt": "2026-11-03T12:10:38.157Z", "audioSha256": "9f".repeat(32),
            "engine": {"kind": "local", "model": "turbo"},
            "fromTheFuture": {"x": [1, 2, 3]}, "supersedes": []
        });
        fs.write(CLASS, &path, &serde_json::to_vec(&file).unwrap(), true)
            .unwrap();
        let state_dir = paths.transcribe_dir();
        let progress = Arc::new(AtomicU64::new(0));
        let p = progress.clone();
        let mut hb = Heartbeat::start(
            fs.clone(),
            state_dir.clone(),
            LectureState {
                lecture_id: LECTURE.into(),
                job_id: "job-1".into(),
                started_at: time::instant(time::now_ms()),
                class_id: Some(CLASS.into()),
                claim_path: Some(path.clone()),
                last_heartbeat_wall_ms: None,
                taken_at_ms: None,
            },
            ClaimRef {
                class_id: CLASS.into(),
                path: path.clone(),
                file: file.clone(),
            },
            Duration::from_millis(40),
            Arc::new(move || {
                let v = p.load(Ordering::Relaxed);
                if v >= 100 {
                    Beat::Finished
                } else {
                    Beat::Working {
                        progress: v as f64 / 100.0,
                        eta_ms: Some(60_000),
                    }
                }
            }),
        )
        .unwrap();
        let read = || -> Value { serde_json::from_slice(&fs.read(CLASS, &path).unwrap()).unwrap() };
        let wait_for = |n: u64| {
            for _ in 0..200 {
                if read()["heartbeat"].as_u64().unwrap() >= n {
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            panic!("no heartbeat {n}");
        };
        progress.store(40, Ordering::Relaxed);
        wait_for(3);
        let c = read();
        assert_eq!(c["status"], "working");
        assert_eq!(c["fromTheFuture"], json!({"x": [1, 2, 3]}));
        assert_eq!(c["engine"], json!({"kind": "local", "model": "turbo"}));
        assert_eq!(c["claimedAt"], file["claimedAt"]);
        assert_eq!(c["etaMs"], 60_000);
        assert!(c["progress"].as_f64().unwrap() > 0.0);
        assert_ne!(c["updatedAt"], file["updatedAt"]);
        let st = read_state(&state_dir, LECTURE).unwrap();
        assert!(st.last_heartbeat_wall_ms.is_some());
        // Finished but untaken: still working, at 1.0.
        progress.store(100, Ordering::Relaxed);
        let n = read()["heartbeat"].as_u64().unwrap();
        wait_for(n + 2);
        assert_eq!(read()["progress"], 1.0);
        assert_eq!(read()["status"], "working");
        // A failure is written at once, and the heartbeat stops.
        hb.fail(Code::ModelUnreadable);
        let c = read();
        assert_eq!(c["status"], "failed");
        assert_eq!(c["error"], "MODEL_UNREADABLE");
        let n = c["heartbeat"].as_u64().unwrap();
        std::thread::sleep(Duration::from_millis(120));
        assert_eq!(read()["heartbeat"].as_u64().unwrap(), n);
        assert_eq!(read()["fromTheFuture"], json!({"x": [1, 2, 3]}));
    }
}
