// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Native dialogs, run in Rust; results are pick tokens, never paths the webview chose
//! (architecture §6.3, D-4). Every dialog blocks, so callers run it inside `blocking` (never on
//! the main thread, Trama gotcha 14).
//!
//! With `TRAMADO_DATA_DIR` **and** `TRAMADO_E2E=1`, no dialog opens: answers are popped from
//! the JSON array in the file named by `TRAMADO_E2E_DIALOGS` (the file is rewritten without the
//! popped answer, so a test may append more): `{"paths": ["/abs/a.pdf"]}`, `{"cancel": true}`,
//! and, for native confirmations, `{"confirm": true | false}`. An empty or missing queue answers
//! "cancel" / "no".

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tramado_base::error::{AppError, AppResult};
use tramado_base::files;
use tramado_base::picks::{PickKind, Picked};

use super::ConfirmText;
use crate::state::Shared;
use crate::util::blocking;

/// TS `FileFilter` (extensions without the dot; empty lists are dropped, Trama gotcha).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickFilesRequest {
    pub title: String,
    pub filters: Vec<FileFilter>,
    pub multiple: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickFolderRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub title: String,
    pub default_name: String,
    pub filters: Vec<FileFilter>,
}

/// One answer of the e2e queue.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
pub struct E2eAnswer {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<PathBuf>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm: Option<bool>,
}

pub struct DialogsState {
    /// The e2e answer file, when e2e dialogs are on.
    e2e: Option<PathBuf>,
    lock: Mutex<()>,
}

impl DialogsState {
    /// Pops the next e2e answer (`None` when e2e dialogs are off).
    fn pop(&self) -> Option<E2eAnswer> {
        let file = self.e2e.as_ref()?;
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        Some(pop_answer(file))
    }
}

/// Reads the queue, removes its first answer and writes the rest back.
pub fn pop_answer(file: &std::path::Path) -> E2eAnswer {
    let mut queue: Vec<E2eAnswer> = std::fs::read(file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    if queue.is_empty() {
        return E2eAnswer {
            cancel: Some(true),
            ..E2eAnswer::default()
        };
    }
    let first = queue.remove(0);
    if let Ok(rest) = serde_json::to_vec_pretty(&queue) {
        let _ = files::write_atomic(file, &rest);
    }
    first
}

pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    let e2e = (shared.paths.dev_isolated && shared.paths.e2e)
        .then(|| std::env::var_os("TRAMADO_E2E_DIALOGS"))
        .flatten()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from);
    if let Some(f) = &e2e {
        log::info!("e2e dialogs: answers come from {}", f.display());
    }
    app.manage(DialogsState {
        e2e,
        lock: Mutex::new(()),
    });
    Ok(())
}

pub fn on_exit(_app: &AppHandle) {}

/// A native yes/no confirmation with the caller's texts; `{host}` in the message is replaced
/// by `host`. Blocking: call it inside `blocking`. In e2e mode, the next `{"confirm": …}`.
pub fn confirm(app: &AppHandle, text: &ConfirmText, host: Option<&str>) -> bool {
    if let Some(state) = app.try_state::<DialogsState>() {
        if let Some(a) = state.pop() {
            return a.confirm.unwrap_or(false);
        }
    }
    let message = match host {
        Some(h) => text.message.replace("{host}", h),
        None => text.message.clone(),
    };
    let mut b = app
        .dialog()
        .message(message)
        .title(text.title.clone())
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            text.confirm.clone(),
            text.cancel.clone(),
        ));
    if let Some(w) = visible_main(app) {
        b = b.parent(&w);
    }
    b.blocking_show()
}

fn file_dialog(
    app: &AppHandle,
    title: &str,
    filters: &[FileFilter],
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut d = app.dialog().file().set_title(title);
    for f in filters {
        let exts: Vec<&str> = f
            .extensions
            .iter()
            .map(|e| e.trim_start_matches('.'))
            .filter(|e| !e.is_empty())
            .collect();
        // An empty filter hides every file on some systems.
        if !exts.is_empty() {
            d = d.add_filter(f.name.clone(), &exts);
        }
    }
    if let Some(w) = visible_main(app) {
        d = d.set_parent(&w);
    }
    d
}

/// The main window when it is shown (a dialog parented to a hidden window would be hidden).
fn visible_main(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(crate::window::MAIN)
        .filter(|w| w.is_visible().unwrap_or(false))
}

fn to_path(p: tauri_plugin_dialog::FilePath) -> AppResult<PathBuf> {
    p.into_path()
        .map_err(|e| AppError::invalid(format!("not a local file: {e}")))
}

/// Absolute paths only (e2e answers too).
fn checked(paths: Vec<PathBuf>) -> AppResult<Vec<PathBuf>> {
    if paths.iter().any(|p| !p.is_absolute()) {
        return Err(AppError::invalid("dialog answers must be absolute paths"));
    }
    Ok(paths)
}

#[tauri::command]
pub async fn dialog_pick_files(
    app: AppHandle,
    shared: State<'_, Shared>,
    dialogs: State<'_, DialogsState>,
    req: PickFilesRequest,
) -> AppResult<Vec<Picked>> {
    let picks = shared.picks.clone();
    if let Some(a) = dialogs.pop() {
        let mut paths = checked(a.paths.unwrap_or_default())?;
        if !req.multiple {
            paths.truncate(1);
        }
        return Ok(paths
            .iter()
            .map(|p| picks.register(p, PickKind::Open))
            .collect());
    }
    blocking(move || {
        let d = file_dialog(&app, &req.title, &req.filters);
        let chosen = if req.multiple {
            d.blocking_pick_files().unwrap_or_default()
        } else {
            d.blocking_pick_file().into_iter().collect()
        };
        let mut out = Vec::new();
        for p in chosen {
            out.push(picks.register(&to_path(p)?, PickKind::Open));
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn dialog_pick_folder(
    app: AppHandle,
    shared: State<'_, Shared>,
    dialogs: State<'_, DialogsState>,
    req: PickFolderRequest,
) -> AppResult<Option<Picked>> {
    let picks = shared.picks.clone();
    if let Some(a) = dialogs.pop() {
        let paths = checked(a.paths.unwrap_or_default())?;
        return Ok(paths.first().map(|p| picks.register(p, PickKind::Folder)));
    }
    blocking(move || {
        let chosen = file_dialog(&app, &req.title, &[]).blocking_pick_folder();
        chosen
            .map(|p| to_path(p).map(|p| picks.register(&p, PickKind::Folder)))
            .transpose()
    })
    .await
}

#[tauri::command]
pub async fn dialog_save(
    app: AppHandle,
    shared: State<'_, Shared>,
    dialogs: State<'_, DialogsState>,
    req: SaveRequest,
) -> AppResult<Option<Picked>> {
    let picks = shared.picks.clone();
    if let Some(a) = dialogs.pop() {
        let paths = checked(a.paths.unwrap_or_default())?;
        return Ok(paths.first().map(|p| picks.register(p, PickKind::Save)));
    }
    blocking(move || {
        let chosen = file_dialog(&app, &req.title, &req.filters)
            .set_file_name(req.default_name.clone())
            .blocking_save_file();
        chosen
            .map(|p| to_path(p).map(|p| picks.register(&p, PickKind::Save)))
            .transpose()
    })
    .await
}

/// The most `dialog_save_text` writes (an invite file, a diagnostics log).
const SAVE_TEXT_MAX: usize = 1 << 20;

/// "Save as a file…" for a small text the page made (G2: the `.tramado-invite` file, sync spec §7.2, and the
/// diagnostics log): the native save dialog, then an atomic write. `false` when the person cancelled.
#[tauri::command]
pub async fn dialog_save_text(
    app: AppHandle,
    dialogs: State<'_, DialogsState>,
    req: SaveRequest,
    text: String,
) -> AppResult<bool> {
    if text.len() > SAVE_TEXT_MAX {
        return Err(AppError::invalid("the text is too long to save"));
    }
    let answer = dialogs.pop();
    blocking(move || {
        let path = match answer {
            Some(a) => checked(a.paths.unwrap_or_default())?.into_iter().next(),
            None => file_dialog(&app, &req.title, &req.filters)
                .set_file_name(req.default_name.clone())
                .blocking_save_file()
                .map(to_path)
                .transpose()?,
        };
        let Some(path) = path else {
            return Ok(false);
        };
        files::write_atomic(&path, text.as_bytes())?;
        Ok(true)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::app::tests::TempDir;

    #[test]
    fn e2e_queue_pops_in_order() {
        let dir = TempDir::new();
        let f = dir.path().join("dialogs.json");
        std::fs::write(
            &f,
            r#"[{"paths":["/abs/Código Civil.pdf"]},{"cancel":true},{"confirm":true}]"#,
        )
        .unwrap();
        assert_eq!(
            pop_answer(&f).paths,
            Some(vec![PathBuf::from("/abs/Código Civil.pdf")])
        );
        assert_eq!(pop_answer(&f).cancel, Some(true));
        assert_eq!(pop_answer(&f).confirm, Some(true));
        // Empty (or missing): cancel, and no confirmation.
        let a = pop_answer(&f);
        assert_eq!((a.cancel, a.confirm, a.paths), (Some(true), None, None));
        assert_eq!(pop_answer(&dir.path().join("none.json")).cancel, Some(true));
        assert!(checked(vec![PathBuf::from("rel/a.pdf")]).is_err());
    }
}
