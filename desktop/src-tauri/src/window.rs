// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The main window (architecture §4.4, §5.5). It is created hidden and shown here unless the
//! app was started with `--hidden` (autostart). `CloseRequested` is not intercepted in Rust: the
//! webview handles it (Trama pattern). Files dropped on the window become pick tokens and reach
//! the webview as `app:drop` (D-4: it never gets a path it could use).
//!
//! E2E only (`TRAMADO_DATA_DIR` + `TRAMADO_E2E=1` + `TRAMADO_E2E_MEDIA_SELFTEST=1`): once the
//! webview logged "webview ready", Rust runs the media self-test in it (critique R3): play
//! `/res/selftest.webm` through `tramado-media`, seek to 252 s, and log the result as
//! `media selftest {ok, duration, currentTime}` in `app.log`.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, Window, WindowEvent};
use tramado_base::error::AppResult;
use tramado_base::picks::{PickKind, Picked};

use crate::commands::events;
use crate::state::Shared;

/// Payload of `app:drop`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropEvent {
    pub picked: Vec<Picked>,
    pub x: f64,
    pub y: f64,
}

pub const MAIN: &str = "main";

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    if !std::env::args().skip(1).any(|a| a == "--hidden") {
        show_main(app);
    }
    Ok(())
}

/// Shows and focuses the main window (errors are logged, never fatal).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        if let Err(e) = w.show() {
            log::warn!("cannot show the main window: {e}");
        }
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) = event {
        let app = window.app_handle();
        let Some(shared) = app.try_state::<Shared>() else {
            return;
        };
        let picked: Vec<Picked> = paths
            .iter()
            .filter(|p| p.is_absolute())
            .map(|p| {
                let kind = if p.is_dir() {
                    PickKind::Folder
                } else {
                    PickKind::Open
                };
                shared.picks.register(p, kind)
            })
            .collect();
        if picked.is_empty() {
            return;
        }
        let scale = window.scale_factor().unwrap_or(1.0);
        let logical = position.to_logical::<f64>(scale);
        let ev = DropEvent {
            picked,
            x: logical.x,
            y: logical.y,
        };
        if let Err(e) = app.emit(events::DROP, &ev) {
            log::warn!("cannot emit app:drop: {e}");
        }
    }
}

/// Called when the webview logged "webview ready".
pub fn on_webview_ready(app: &AppHandle) {
    let Some(shared) = app.try_state::<Shared>() else {
        return;
    };
    let wanted = shared.paths.dev_isolated
        && shared.paths.e2e
        && std::env::var("TRAMADO_E2E_MEDIA_SELFTEST").is_ok_and(|v| v == "1");
    if !wanted {
        return;
    }
    let Some(w) = app.get_webview_window(MAIN) else {
        return;
    };
    let script = media_selftest_script(crate::commands::app::media_base());
    if let Err(e) = w.eval(&script) {
        log::warn!("cannot start the media self-test: {e}");
    }
}

/// The self-test as the Diagnostics screen will run it: metadata, a seek to 252 s, `seeked`.
pub fn media_selftest_script(media_base: &str) -> String {
    format!(
        r#"(async () => {{
  const log = (data) => window.__TAURI_INTERNALS__.invoke('app_log', {{ level: 'info', message: 'media selftest', data }});
  try {{
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.muted = true;
    const once = (name, ms) => new Promise((resolve, reject) => {{
      const t = setTimeout(() => reject(new Error('timeout waiting for ' + name)), ms);
      a.addEventListener(name, () => {{ clearTimeout(t); resolve(); }}, {{ once: true }});
      a.addEventListener('error', () => {{ clearTimeout(t); reject(new Error('media error ' + (a.error ? a.error.code : '?'))); }}, {{ once: true }});
    }});
    const loaded = once('loadedmetadata', 20000);
    a.src = '{media_base}/res/selftest.webm';
    document.body.appendChild(a);
    await loaded;
    const duration = a.duration;
    const seeked = once('seeked', 20000);
    a.currentTime = 252;
    await seeked;
    const currentTime = a.currentTime;
    const ok = Math.abs(currentTime - 252) <= 0.25 && Math.abs(duration - 300) <= 1;
    await log({{ ok, duration, currentTime }});
  }} catch (e) {{
    await log({{ ok: false, error: String(e) }});
  }}
}})();"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selftest_script_names_the_scheme() {
        let s = media_selftest_script("tramado-media://localhost");
        assert!(s.contains("'tramado-media://localhost/res/selftest.webm'"));
        assert!(s.contains("a.currentTime = 252"));
        assert!(s.contains("'media selftest'"));
    }
}
