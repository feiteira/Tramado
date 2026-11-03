// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The app log, `data/logs/app.log` (architecture §5.1 `applog`, §6.1 `app_log`).
//! **Minimal (M0)**: one line per entry, appended; R-SHELL adds rotation (2 × 5 MiB), the
//! `log` crate bridge and device-ID truncation for diagnostics. Lines never carry class
//! content: callers log codes and short messages only.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::AppResult;

pub const FILE_NAME: &str = "app.log";
/// Longest message kept (bytes); longer ones are cut.
const MAX_MESSAGE: usize = 2000;

pub struct AppLog {
    path: PathBuf,
    lock: Mutex<()>,
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

impl AppLog {
    /// Creates `logs_dir` if needed.
    pub fn open(logs_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(logs_dir)?;
        Ok(AppLog {
            path: logs_dir.join(FILE_NAME),
            lock: Mutex::new(()),
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
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            let _ = f.write_all(line.as_bytes());
        }
    }

    /// Nothing is buffered yet; kept for the exit path.
    pub fn flush(&self) {}

    /// The last `n` lines (diagnostics).
    pub fn tail(&self, n: usize) -> Vec<String> {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        let lines: Vec<&str> = text.lines().collect();
        lines[lines.len().saturating_sub(n)..]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
