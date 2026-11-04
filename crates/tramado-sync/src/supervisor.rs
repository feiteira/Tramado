// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The supervisor (sync spec §2.4–§2.8): one long-lived thread named `tramado-syncthing` spawns
//! **and waits on** the child (Linux: `PR_SET_PDEATHSIG` follows the forking thread; Windows: a
//! Job Object that kills the child when Tramado dies; macOS: orphan clean-up at the next start),
//! rotates the log, cleans up orphans through `runtime.json`, and restarts by the exit-code
//! table with backoff. Stopping: API shutdown → 3 s → SIGTERM → kill at the deadline.

use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::{files, time};

use crate::engine::Inner;
use crate::init;

pub const LOG_FILE: &str = "syncthing.log";
pub const RUNTIME_FILE: &str = "runtime.json";
const LOG_ROTATE_BYTES: u64 = 5 << 20;
pub const READY_TIMEOUT: Duration = Duration::from_secs(15);
const BACKOFF_S: [u64; 7] = [1, 2, 4, 8, 16, 32, 60];
const MAX_FAILURES: usize = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(300);
const MAX_GUI_RETRIES: u32 = 3;

/// Kill requests from other threads, executed by the supervisor thread (which owns the child).
pub const KILL_NONE: u8 = 0;
pub const KILL_TERM: u8 = 1;
pub const KILL_HARD: u8 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub pid: u32,
    pub gui_port: u16,
    pub started_at: String,
    pub exe: String,
}

pub fn read_runtime(home: &Path) -> Option<Runtime> {
    serde_json::from_slice(&std::fs::read(home.join(RUNTIME_FILE)).ok()?).ok()
}

/// `.log` → `.log.1` → `.log.2` when the log passed 5 MiB (before each spawn).
pub fn rotate_logs(home: &Path) {
    let log = home.join(LOG_FILE);
    if std::fs::metadata(&log).map(|m| m.len()).unwrap_or(0) > LOG_ROTATE_BYTES {
        let _ = std::fs::rename(home.join("syncthing.log.1"), home.join("syncthing.log.2"));
        let _ = std::fs::rename(&log, home.join("syncthing.log.1"));
    }
}

/// The last `n` lines of the log written from byte `from` on (the "log tail" of §2.6).
pub fn log_tail(home: &Path, from: u64, n: usize) -> Vec<String> {
    let Ok(mut f) = File::open(home.join(LOG_FILE)) else {
        return Vec::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = from.min(len).max(len.saturating_sub(256 << 10));
    if f.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let lines: Vec<String> = text.lines().map(str::to_string).collect();
    lines[lines.len().saturating_sub(n)..].to_vec()
}

pub fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: kill with signal 0 only checks that the process exists.
        let r = unsafe { libc::kill(pid as libc::pid_t, 0) };
        r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(not(unix))]
    {
        let out = init::command(Path::new("tasklist"))
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output();
        out.map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}

/// The executable of a running process, when the OS tells (orphan clean-up checks it is ours).
fn exe_of(pid: u32) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_link(format!("/proc/{pid}/exe")).ok()
    }
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!s.is_empty()).then(|| PathBuf::from(s))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}

fn kill_pid(pid: u32, hard: bool) {
    #[cfg(unix)]
    {
        let sig = if hard { libc::SIGKILL } else { libc::SIGTERM };
        // SAFETY: plain kill(2) of a process we checked is our own sidecar.
        unsafe {
            libc::kill(pid as libc::pid_t, sig);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = hard;
        let _ = init::command(Path::new("taskkill"))
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Orphan clean-up (§2.6): ask the instance in `runtime.json` to shut down, wait 3 s, kill it
/// if it is still alive **and** runs our sidecar, delete `runtime.json`.
pub fn orphan_cleanup(home: &Path, bin: &Path) {
    let Some(rt) = read_runtime(home) else {
        return;
    };
    if let Ok(key) = init::api_key(home) {
        let rest = crate::client::HttpRest::new(rt.gui_port, &key);
        let _ = crate::client::Rest::call(
            &rest,
            crate::client::Method::Post,
            "/rest/system/shutdown",
            None,
            Duration::from_secs(2),
        );
    }
    let start = Instant::now();
    while pid_alive(rt.pid) && start.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(100));
    }
    if pid_alive(rt.pid) {
        let ours = exe_of(rt.pid).is_some_and(|e| same_file(&e, bin))
            || (exe_of(rt.pid).is_none() && Path::new(&rt.exe) == bin && cfg!(windows));
        if ours {
            log::warn!("sync: killing an orphaned Syncthing (pid {})", rt.pid);
            kill_pid(rt.pid, true);
            let t = Instant::now();
            while pid_alive(rt.pid) && t.elapsed() < Duration::from_secs(2) {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    let _ = std::fs::remove_file(home.join(RUNTIME_FILE));
}

#[cfg(windows)]
fn assign_job(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    // SAFETY: Win32 calls on a fresh job object and our own child's handle; the job handle is
    // deliberately never closed (it closes, and kills the child, when Tramado dies).
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        AssignProcessToJobObject(job, child.as_raw_handle() as _);
    }
}

/// Spawns `tramado-syncthing serve` (argv and environment of §2.4); stdout and stderr go to
/// the log file (never a pipe).
pub fn spawn(bin: &Path, home: &Path, gui_port: u16, api_key: &str) -> AppResult<(Child, u64)> {
    std::fs::create_dir_all(home)?;
    let log_path = home.join(LOG_FILE);
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let start = log.metadata().map(|m| m.len()).unwrap_or(0);
    let log2 = log.try_clone()?;
    let mut cmd = init::command(bin);
    cmd.arg("serve")
        .arg(format!("--home={}", home.display()))
        .args(["--no-browser", "--no-restart", "--no-upgrade"])
        .arg(format!("--gui-address=http://127.0.0.1:{gui_port}"))
        .env("STMONITORED", "yes")
        .env("STNOUPGRADE", "1")
        .env("STVERSIONEXTRA", "Tramado")
        .env("STGUIAPIKEY", api_key)
        .env_remove("STGUIADDRESS")
        .env_remove("STHOMEDIR")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log2));
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: getpid is async-signal-safe; the closure only calls prctl, getppid and raise.
        let parent = unsafe { libc::getpid() };
        unsafe {
            cmd.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::getppid() != parent {
                    libc::raise(libc::SIGTERM);
                }
                Ok(())
            });
        }
    }
    let child = cmd.spawn().map_err(|e| {
        AppError::new(
            Code::SyncUnavailable,
            format!("cannot start Syncthing: {e}"),
        )
    })?;
    #[cfg(windows)]
    assign_job(&child);
    Ok((child, start))
}

fn write_runtime(home: &Path, pid: u32, gui_port: u16, bin: &Path) {
    let rt = Runtime {
        pid,
        gui_port,
        started_at: time::instant(time::now_ms()),
        exe: bin.display().to_string(),
    };
    if let Ok(b) = serde_json::to_vec(&rt) {
        let _ = files::write_atomic_mode(&home.join(RUNTIME_FILE), &b, 0o600);
    }
}

/// Why the child exited, from the exit-code table of §2.6.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitAction {
    Done,
    RestartAfter1s,
    RestartNow,
    LockHeld,
    GuiPort,
    Crash,
}

pub fn classify(requested: bool, code: Option<i32>, tail: &[String]) -> ExitAction {
    if requested {
        return ExitAction::Done;
    }
    let has = |s: &str| tail.iter().any(|l| l.contains(s));
    match code {
        Some(0) => ExitAction::RestartAfter1s,
        Some(3) => ExitAction::RestartNow,
        Some(1) if has("Failed to acquire lock") => ExitAction::LockHeld,
        Some(1) if has("Failed to start API") || has("address already in use") => {
            ExitAction::GuiPort
        }
        _ => ExitAction::Crash,
    }
}

/// The supervisor thread's body: runs until the engine no longer wants Syncthing running or a
/// start fails for good.
pub(crate) fn run(inner: Arc<Inner>) {
    let Some(bin) = inner.cfg.sidecar.clone() else {
        inner.fail(Code::SyncUnavailable, "the Syncthing sidecar is missing");
        return;
    };
    let home = inner.home.clone();
    let mut failures: VecDeque<Instant> = VecDeque::new();
    let mut backoff = 0usize;
    let mut gui_retries = 0u32;
    let mut lock_retried = false;
    let mut reprobe = false;
    loop {
        if !inner.want_running() {
            break;
        }
        rotate_logs(&home);
        orphan_cleanup(&home, &bin);
        let prep = match init::prespawn(&home, inner.dev_isolated, reprobe) {
            Ok(p) => p,
            Err(e) => {
                inner.fail(e.code(), &e.to_string());
                return;
            }
        };
        reprobe = false;
        let (mut child, log_start) = match spawn(&bin, &home, prep.gui_port, &prep.api_key) {
            Ok(x) => x,
            Err(e) => {
                inner.fail(e.code(), &e.to_string());
                return;
            }
        };
        let pid = child.id();
        write_runtime(&home, pid, prep.gui_port, &bin);
        let gen = inner.spawned(pid, &prep);
        let spawned_at = Instant::now();
        // wait, executing kill requests from other threads
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break Some(s),
                Ok(None) => {}
                Err(_) => break None,
            }
            match inner.take_kill_request() {
                KILL_TERM => {
                    #[cfg(unix)]
                    kill_pid(pid, false);
                    #[cfg(not(unix))]
                    let _ = child.kill();
                }
                KILL_HARD => {
                    let _ = child.kill();
                }
                _ => {}
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let code = status.and_then(|s| s.code());
        let requested = !inner.want_running();
        inner.exited(gen, code);
        let tail = log_tail(&home, log_start, 50);
        let action = classify(requested, code, &tail);
        log::info!("sync: Syncthing exited ({code:?}) → {action:?}");
        if action == ExitAction::Done {
            let _ = std::fs::remove_file(home.join(RUNTIME_FILE));
            break;
        }
        if spawned_at.elapsed() > Duration::from_secs(60) {
            backoff = 0;
            gui_retries = 0;
        }
        inner.note_error(&format!("Syncthing exited with {code:?}"));
        match action {
            ExitAction::RestartNow => {}
            ExitAction::RestartAfter1s => {
                if !inner.sleep_unless_stopped(Duration::from_secs(1)) {
                    break;
                }
            }
            ExitAction::LockHeld => {
                if lock_retried {
                    inner.fail(Code::SyncLocked, "another process holds the Syncthing home");
                    return;
                }
                lock_retried = true;
            }
            ExitAction::GuiPort => {
                gui_retries += 1;
                if gui_retries > MAX_GUI_RETRIES {
                    inner.fail(Code::SyncUnavailable, "no GUI port could be used");
                    return;
                }
            }
            ExitAction::Crash | ExitAction::Done => {
                let now = Instant::now();
                failures.push_back(now);
                while failures
                    .front()
                    .is_some_and(|t| now.duration_since(*t) > FAILURE_WINDOW)
                {
                    failures.pop_front();
                }
                if failures.len() >= MAX_FAILURES {
                    inner.fail(Code::SyncUnavailable, "Syncthing keeps stopping");
                    return;
                }
                let wait = Duration::from_secs(BACKOFF_S[backoff.min(BACKOFF_S.len() - 1)]);
                backoff += 1;
                if !inner.sleep_unless_stopped(wait) {
                    break;
                }
            }
        }
        if tail
            .iter()
            .any(|l| l.contains("listen") && l.contains("address already in use"))
        {
            reprobe = true;
        }
        inner.restarting();
    }
    inner.supervisor_done();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_follow_the_table() {
        let t = |s: &str| vec![s.to_string()];
        assert_eq!(classify(true, Some(0), &[]), ExitAction::Done);
        assert_eq!(classify(false, Some(0), &[]), ExitAction::RestartAfter1s);
        assert_eq!(classify(false, Some(3), &[]), ExitAction::RestartNow);
        assert_eq!(
            classify(
                false,
                Some(1),
                &t("ERR Failed to acquire lock: is another Syncthing instance already running?")
            ),
            ExitAction::LockHeld
        );
        assert_eq!(
            classify(
                false,
                Some(1),
                &t("Failed to start API … bind: address already in use")
            ),
            ExitAction::GuiPort
        );
        assert_eq!(classify(false, Some(1), &t("panic")), ExitAction::Crash);
        assert_eq!(classify(false, None, &[]), ExitAction::Crash);
    }

    #[test]
    fn logs_rotate_and_tail_reads_since_the_spawn() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join(LOG_FILE);
        std::fs::write(&log, vec![b'x'; (LOG_ROTATE_BYTES + 1) as usize]).unwrap();
        rotate_logs(dir.path());
        assert!(!log.exists() && dir.path().join("syncthing.log.1").exists());
        std::fs::write(&log, "old\n").unwrap();
        let from = 4;
        std::fs::write(&log, "old\na\nb\nc\n").unwrap();
        assert_eq!(log_tail(dir.path(), from, 2), vec!["b", "c"]);
        assert_eq!(log_tail(dir.path(), from, 50), vec!["a", "b", "c"]);
    }

    #[test]
    fn orphan_cleanup_without_runtime_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        orphan_cleanup(dir.path(), Path::new("/nonexistent"));
        // a stale runtime.json of a dead process is removed
        std::fs::write(
            dir.path().join(RUNTIME_FILE),
            serde_json::to_vec(&Runtime {
                pid: 9_999_999,
                gui_port: 1,
                started_at: String::new(),
                exe: String::new(),
            })
            .unwrap(),
        )
        .unwrap();
        orphan_cleanup(dir.path(), Path::new("/nonexistent"));
        assert!(!dir.path().join(RUNTIME_FILE).exists());
        assert!(!pid_alive(9_999_999));
        assert!(pid_alive(std::process::id()));
    }
}
