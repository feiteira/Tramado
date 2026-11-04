// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The app log, `data/logs/app.log` (architecture §5.1 `applog`, §6.1 `app_log`): one line per
//! entry, rotated at 5 MiB into `app.log.1` (two files of at most 5 MiB each). The `log` crate
//! is bridged into it ([`AppLog::install`]), so warnings of every crate land here too. Lines
//! never carry class content: callers log codes and short messages only. Diagnostics read the
//! tail with device IDs cut to their ShortId ([`truncate_device_ids`]).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::error::AppResult;

pub const FILE_NAME: &str = "app.log";
/// The previous file after a rotation.
pub const ROTATED_NAME: &str = "app.log.1";
/// A file is rotated once it reaches this size.
pub const MAX_BYTES: u64 = 5 << 20;
/// Longest message kept (bytes); longer ones are cut.
const MAX_MESSAGE: usize = 2000;

struct Inner {
    /// Size of `app.log` as far as this process knows (`None` until first measured).
    size: Option<u64>,
}

pub struct AppLog {
    path: PathBuf,
    rotated: PathBuf,
    max_bytes: u64,
    lock: Mutex<Inner>,
}

fn one_line(s: &str) -> String {
    let mut out: String = s
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect();
    if out.len() > MAX_MESSAGE {
        let mut cut = MAX_MESSAGE;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push('…');
    }
    out
}

fn is_b32_upper(b: u8) -> bool {
    b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b)
}

/// Replaces every Syncthing device ID in `line` (canonical dashed form, or the 56-character
/// dashless form of invites) by its ShortId (first 7 characters).
pub fn truncate_device_ids(line: &str) -> String {
    let b = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    let mut copied = 0;
    while i < b.len() {
        // Only at a word start, so a longer token is never cut in the middle.
        let at_start = i == 0 || !b[i - 1].is_ascii_alphanumeric();
        if at_start {
            let dashed = 63;
            if i + dashed <= b.len()
                && (0..dashed).all(|k| {
                    if k % 8 == 7 {
                        b[i + k] == b'-'
                    } else {
                        is_b32_upper(b[i + k])
                    }
                })
                && (i + dashed == b.len() || !b[i + dashed].is_ascii_alphanumeric())
            {
                out.push_str(&line[copied..i + 7]);
                i += dashed;
                copied = i;
                continue;
            }
            let plain = 56;
            if i + plain <= b.len()
                && (0..plain).all(|k| is_b32_upper(b[i + k]))
                && (i + plain == b.len() || !b[i + plain].is_ascii_alphanumeric())
            {
                out.push_str(&line[copied..i + 7]);
                i += plain;
                copied = i;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&line[copied..]);
    out
}

impl AppLog {
    /// Creates `logs_dir` if needed.
    pub fn open(logs_dir: &Path) -> AppResult<Self> {
        Self::open_with_limit(logs_dir, MAX_BYTES)
    }

    /// [`AppLog::open`] with another rotation size (tests).
    pub fn open_with_limit(logs_dir: &Path, max_bytes: u64) -> AppResult<Self> {
        fs::create_dir_all(logs_dir)?;
        Ok(AppLog {
            path: logs_dir.join(FILE_NAME),
            rotated: logs_dir.join(ROTATED_NAME),
            max_bytes: max_bytes.max(1024),
            lock: Mutex::new(Inner { size: None }),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// `<instant> <LEVEL> <message>[ <data as compact JSON>]`. Failures to write are ignored.
    pub fn write(&self, level: &str, message: &str, data: Option<&serde_json::Value>) {
        let mut line = format!(
            "{} {} {}",
            crate::time::instant(crate::time::now_ms()),
            level.to_ascii_uppercase(),
            one_line(message)
        );
        if let Some(d) = data {
            line.push(' ');
            line.push_str(&one_line(&d.to_string()));
        }
        line.push('\n');
        let mut inner = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let size = *inner
            .size
            .get_or_insert_with(|| fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0));
        if size > 0 && size + line.len() as u64 > self.max_bytes {
            // Keep one previous file; the one before it goes.
            let _ = fs::rename(&self.path, &self.rotated);
            inner.size = Some(0);
        }
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            if f.write_all(line.as_bytes()).is_ok() {
                inner.size = Some(inner.size.unwrap_or(0) + line.len() as u64);
            }
        }
    }

    /// Nothing is buffered (every line is written at once); kept for the exit path.
    pub fn flush(&self) {}

    /// The last `n` lines, the rotated file included when the current one is short.
    pub fn tail(&self, n: usize) -> Vec<String> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut lines: Vec<String> = Vec::new();
        for p in [&self.rotated, &self.path] {
            if let Ok(text) = fs::read_to_string(p) {
                lines.extend(text.lines().map(str::to_string));
            }
        }
        lines.split_off(lines.len().saturating_sub(n))
    }

    /// [`AppLog::tail`] with device IDs cut to ShortIds (diagnostics, architecture §16).
    pub fn tail_for_diagnostics(&self, n: usize) -> Vec<String> {
        self.tail(n)
            .iter()
            .map(|l| truncate_device_ids(l))
            .collect()
    }

    /// Routes the `log` crate into this file: `info` and above from Tramado's own crates,
    /// `warn` and above from everything else. Only the first call in a process takes effect.
    pub fn install(log: Arc<AppLog>) {
        // One logger per process, alive until exit: leaking it is the `log` crate's model.
        let bridge: &'static Bridge = Box::leak(Box::new(Bridge(log)));
        if log::set_logger(bridge).is_ok() {
            log::set_max_level(log::LevelFilter::Info);
        }
    }
}

struct Bridge(Arc<AppLog>);

impl log::Log for Bridge {
    fn enabled(&self, m: &log::Metadata<'_>) -> bool {
        let ours = m.target().starts_with("tramado");
        m.level()
            <= if ours {
                log::Level::Info
            } else {
                log::Level::Warn
            }
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let message = record.args().to_string();
        if is_noise(record.target(), &message) {
            return;
        }
        let level = match record.level() {
            log::Level::Error => "error",
            log::Level::Warn => "warn",
            _ => "info",
        };
        self.0
            .write(level, &format!("[{}] {message}", record.target()), None);
    }

    fn flush(&self) {}
}

/// Records of other crates that say nothing wrong happened: the PulseAudio client (cpal's
/// PulseAudio host, every device list and system-audio check) logs its own normal disconnect as
/// an error, two lines each time, which made diagnostics look alarming.
fn is_noise(target: &str, message: &str) -> bool {
    target.starts_with("pulseaudio::") && message.contains("Client disconnected")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulseaudio_disconnects_are_not_errors() {
        assert!(is_noise(
            "pulseaudio::client::reactor",
            "Reactor error: Client disconnected"
        ));
        assert!(!is_noise(
            "pulseaudio::client::reactor",
            "Reactor error: Protocol error"
        ));
        assert!(!is_noise("tramado_speech::capture", "Client disconnected"));
    }

    #[test]
    fn appends_one_line_per_entry() {
        let dir = tempfile::tempdir().unwrap();
        let log = AppLog::open(&dir.path().join("logs")).unwrap();
        log.write("info", "webview ready", None);
        log.write(
            "warn",
            "two\nlines",
            Some(&serde_json::json!({"code": "IO_ERROR"})),
        );
        let tail = log.tail(10);
        assert_eq!(tail.len(), 2);
        assert!(tail[0].ends_with(" INFO webview ready"), "{}", tail[0]);
        assert!(
            tail[1].ends_with(" WARN two lines {\"code\":\"IO_ERROR\"}"),
            "{}",
            tail[1]
        );
        assert_eq!(log.tail(1).len(), 1);
    }

    #[test]
    fn rotates_into_two_files() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs");
        let log = AppLog::open_with_limit(&logs, 2048).unwrap();
        for i in 0..200 {
            log.write("info", &format!("line {i:03} {}", "x".repeat(40)), None);
        }
        let cur = fs::metadata(logs.join(FILE_NAME)).unwrap().len();
        let old = fs::metadata(logs.join(ROTATED_NAME)).unwrap().len();
        assert!(cur <= 2048 && old <= 2048, "{cur} {old}");
        let names: Vec<_> = fs::read_dir(&logs).unwrap().flatten().collect();
        assert_eq!(names.len(), 2, "app.log and app.log.1 only");
        let tail = log.tail(3);
        assert!(tail[2].contains("line 199"), "{tail:?}");
        // The tail reaches into the rotated file when asked for more than the current holds.
        let all = log.tail(1000);
        assert!(all.len() > cur as usize / 80, "{}", all.len());
        // A reopened log continues with the measured size.
        let again = AppLog::open_with_limit(&logs, 2048).unwrap();
        again.write("info", "after restart", None);
        assert!(fs::metadata(logs.join(FILE_NAME)).unwrap().len() <= 2048);
    }

    #[test]
    fn diagnostics_truncate_device_ids() {
        let id = "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";
        let plain = id.replace('-', "");
        assert_eq!(
            truncate_device_ids(&format!("connected to {id} via relay")),
            "connected to AB4Z76W via relay"
        );
        assert_eq!(truncate_device_ids(id), "AB4Z76W");
        assert_eq!(
            truncate_device_ids(&format!("invite d=[{plain}], x")),
            "invite d=[AB4Z76W], x"
        );
        assert_eq!(
            truncate_device_ids(&format!("{id},{id}")),
            "AB4Z76W,AB4Z76W"
        );
        // Not IDs: too short, lower case, glued to other letters.
        for keep in [
            "AB4Z76W-GA7E7XY",
            "ab4z76w-ga7e7xy-6yxm3zp-clw473t-ryrb5q6-ktoc53u-ht4s232-zwb42q2",
            "XAB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2Y",
            "Ação ✓ ok",
        ] {
            assert_eq!(truncate_device_ids(keep), keep);
        }
        let dir = tempfile::tempdir().unwrap();
        let log = AppLog::open(dir.path()).unwrap();
        log.write("warn", &format!("device {id} rejected"), None);
        let tail = log.tail_for_diagnostics(5);
        assert!(tail[0].ends_with("device AB4Z76W rejected"), "{tail:?}");
    }
}
