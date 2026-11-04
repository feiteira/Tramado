// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The main window (architecture §4.4, §5.5). It is created here, hidden, from its entry in
//! `tauri.conf.json` (`"create": false`, so Tauri does not create it before `setup`), and shown
//! unless the app was started with `--hidden` (autostart). With `TRAMADO_DATA_DIR` the webview
//! keeps its own storage (localStorage, caches) in `$TRAMADO_DATA_DIR/data/webview`: Tauri's
//! default is the platform's app-local data folder, so an isolated run would otherwise share
//! the webview storage of the person's real Tramado and of every other isolated instance. `CloseRequested` is not intercepted in Rust: the
//! webview handles it (Trama pattern). Files dropped on the window become pick tokens and reach
//! the webview as `app:drop` (D-4: it never gets a path it could use).
//!
//! E2E only (`TRAMADO_DATA_DIR` + `TRAMADO_E2E=1`), once the webview logged "webview ready":
//! with `TRAMADO_E2E_MEDIA_SELFTEST=1` Rust runs the media self-test in it (critique R3; result
//! logged as `media selftest {…}`), and with `TRAMADO_E2E_EVAL=<file>` it runs that script
//! (≤ 256 KiB; `tools/desktop-smoke.mjs --ipc-check` uses it to call the commands for real).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, Window, WindowEvent};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::paths::Paths;
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

pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    create_main(app, shared)?;
    if !std::env::args().skip(1).any(|a| a == "--hidden") {
        show_main(app);
    }
    Ok(())
}

/// Builds the main window from its configuration (once).
fn create_main(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    if app.get_webview_window(MAIN).is_some() {
        return Ok(());
    }
    let config = app.config();
    let Some(cfg) = config.app.windows.iter().find(|w| w.label == MAIN) else {
        return Err(AppError::new(
            Code::IoError,
            "no main window in the configuration",
        ));
    };
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, cfg)
        .map_err(|e| AppError::new(Code::IoError, format!("main window: {e}")))?;
    if let Some(dir) = webview_data_dir(&shared.paths) {
        builder = builder.data_directory(dir);
    }
    builder
        .build()
        .map_err(|e| AppError::new(Code::IoError, format!("main window: {e}")))?;
    Ok(())
}

/// The webview's storage folder: Tauri's default (the app-local data folder), except in an
/// isolated run, where it lives under `TRAMADO_DATA_DIR`.
pub fn webview_data_dir(paths: &Paths) -> Option<PathBuf> {
    paths.dev_isolated.then(|| paths.data.join("webview"))
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
    if !(shared.paths.dev_isolated && shared.paths.e2e) {
        return;
    }
    let Some(w) = app.get_webview_window(MAIN) else {
        return;
    };
    if std::env::var("TRAMADO_E2E_MEDIA_SELFTEST").is_ok_and(|v| v == "1") {
        let script = media_selftest_script(crate::commands::app::media_base());
        if let Err(e) = w.eval(&script) {
            log::warn!("cannot start the media self-test: {e}");
        }
    }
    if let Some(file) = std::env::var_os("TRAMADO_E2E_EVAL").filter(|v| !v.is_empty()) {
        let script = std::fs::metadata(&file)
            .ok()
            .filter(|m| m.is_file() && m.len() <= 256 * 1024)
            .and_then(|_| std::fs::read_to_string(&file).ok());
        match script {
            Some(js) => {
                if let Err(e) = w.eval(&js) {
                    log::warn!("cannot run the e2e script: {e}");
                }
            }
            None => log::warn!("the e2e script is missing or too large"),
        }
    }
}

/// The self-test as the Diagnostics screen will run it (critique R3): play the bundled 300 s
/// file through `tramado-media`, seek to 252 s, check `|currentTime − 252| ≤ 0.25` and
/// `duration ≈ 300`. When the element refuses the scheme (`MEDIA_ERR_SRC_NOT_SUPPORTED`, as
/// WebKitGTK does: its GStreamer pipeline has no source for custom schemes), the same check runs
/// on the Blob-URL fallback of architecture §8 / D21, with the bytes fetched over the scheme.
/// Logged as `media selftest {ok, via: "scheme" | "blob", duration, currentTime, scheme}`.
pub fn media_selftest_script(media_base: &str) -> String {
    format!(
        r#"(async () => {{
  const log = (data) => window.__TAURI_INTERNALS__.invoke('app_log', {{ level: 'info', message: 'media selftest', data }});
  const url = '{media_base}/res/selftest.webm';
  const check = async (src) => {{
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.muted = true;
    const once = (name, ms) => new Promise((resolve, reject) => {{
      const t = setTimeout(() => reject(new Error('timeout waiting for ' + name)), ms);
      a.addEventListener(name, () => {{ clearTimeout(t); resolve(); }}, {{ once: true }});
      a.addEventListener('error', () => {{ clearTimeout(t); reject(new Error('MEDIA_ERR ' + (a.error ? a.error.code : '?'))); }}, {{ once: true }});
    }});
    try {{
      const loaded = once('loadedmetadata', 20000);
      a.src = src;
      document.body.appendChild(a);
      await loaded;
      const duration = a.duration;
      const seeked = once('seeked', 20000);
      a.currentTime = 252;
      await seeked;
      const currentTime = a.currentTime;
      return {{ ok: Math.abs(currentTime - 252) <= 0.25 && Math.abs(duration - 300) <= 1, duration, currentTime }};
    }} catch (e) {{
      return {{ ok: false, error: String(e) }};
    }} finally {{
      a.remove();
    }}
  }};
  try {{
    const scheme = await check(url);
    if (scheme.ok || !String(scheme.error || '').includes('MEDIA_ERR 4')) {{
      await log({{ ...scheme, via: 'scheme' }});
      return;
    }}
    const r = await fetch(url);
    const blobUrl = URL.createObjectURL(new Blob([await r.arrayBuffer()], {{ type: 'audio/webm' }}));
    const blob = await check(blobUrl);
    URL.revokeObjectURL(blobUrl);
    await log({{ ...blob, via: 'blob', scheme }});
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
    fn isolated_runs_keep_their_own_webview_storage() {
        let dir = std::path::Path::new("/tmp/tramado-e2e-a");
        let isolated = Paths::for_tests(dir);
        assert_eq!(
            webview_data_dir(&isolated),
            Some(dir.join("data").join("webview"))
        );
        let mut real = Paths::for_tests(dir);
        real.dev_isolated = false;
        assert_eq!(webview_data_dir(&real), None);
    }

    #[test]
    fn selftest_script_names_the_scheme() {
        let s = media_selftest_script("tramado-media://localhost");
        assert!(s.contains("'tramado-media://localhost/res/selftest.webm'"));
        assert!(s.contains("a.currentTime = 252"));
        assert!(s.contains("via: 'blob'"));
        assert!(s.contains("'media selftest'"));
    }
}
