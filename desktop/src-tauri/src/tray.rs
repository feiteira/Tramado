// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The tray icon (architecture §4.3, §5.5): present while `app_set_background_mode` says
//! `trayOnClose && sharedClasses > 0`; menu Open Tramado, Pause sharing / Resume sharing, Quit.
//! Every click emits `app:tray {action}` (the webview pauses sharing or runs its savers before
//! `app_quit`); "Open" also shows the window from Rust, so it works even while the webview is
//! busy. The labels follow `ui.locale` of `prefs.json` (English, Portuguese, Spanish).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tramado_base::appfiles::{self, AppFile};
use tramado_base::error::AppResult;

use crate::commands::app::BackgroundMode;
use crate::commands::events;
use crate::state::Shared;

/// TS `TrayAction`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrayAction {
    Open,
    PauseSharing,
    ResumeSharing,
    Quit,
}

/// Payload of `app:tray`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayEvent {
    pub action: TrayAction,
}

pub const TRAY_ID: &str = "tramado";
const ITEM_OPEN: &str = "tray-open";
const ITEM_SHARING: &str = "tray-sharing";
const ITEM_QUIT: &str = "tray-quit";

struct Inner {
    shown: bool,
    /// The toggle offers "Resume sharing" after "Pause sharing" was chosen.
    paused: bool,
    sharing_item: Option<MenuItem<tauri::Wry>>,
}

pub struct TrayState {
    inner: Mutex<Inner>,
}

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    app.manage(TrayState {
        inner: Mutex::new(Inner {
            shown: false,
            paused: false,
            sharing_item: None,
        }),
    });
    Ok(())
}

/// The four labels in the interface language.
pub fn labels(locale: &str) -> [&'static str; 4] {
    match locale {
        "pt" => [
            "Abrir o Tramado",
            "Pausar a partilha",
            "Retomar a partilha",
            "Sair",
        ],
        "es" => [
            "Abrir Tramado",
            "Pausar el uso compartido",
            "Reanudar el uso compartido",
            "Salir",
        ],
        _ => ["Open Tramado", "Pause sharing", "Resume sharing", "Quit"],
    }
}

fn locale(app: &AppHandle) -> String {
    let Some(shared) = app.try_state::<Shared>() else {
        return "en".into();
    };
    appfiles::read(&shared.paths, AppFile::Prefs)
        .ok()
        .flatten()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| {
            v.get("ui.locale")
                .and_then(|l| l.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "en".into())
}

fn emit(app: &AppHandle, action: TrayAction) {
    if let Err(e) = app.emit(events::TRAY, TrayEvent { action }) {
        log::warn!("cannot emit app:tray: {e}");
    }
}

fn build(app: &AppHandle) -> tauri::Result<MenuItem<tauri::Wry>> {
    let [open, pause, _resume, quit] = labels(&locale(app));
    let open_item = MenuItem::with_id(app, ITEM_OPEN, open, true, None::<&str>)?;
    let sharing = MenuItem::with_id(app, ITEM_SHARING, pause, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, ITEM_QUIT, quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &sharing, &quit_item])?;
    let mut b = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Tramado")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            ITEM_OPEN => {
                crate::window::show_main(app);
                emit(app, TrayAction::Open);
            }
            ITEM_SHARING => toggle_sharing(app),
            ITEM_QUIT => emit(app, TrayAction::Quit),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                crate::window::show_main(tray.app_handle());
                emit(tray.app_handle(), TrayAction::Open);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    Ok(sharing)
}

fn toggle_sharing(app: &AppHandle) {
    let Some(state) = app.try_state::<TrayState>() else {
        return;
    };
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let action = if inner.paused {
        TrayAction::ResumeSharing
    } else {
        TrayAction::PauseSharing
    };
    inner.paused = !inner.paused;
    let [_, pause, resume, _] = labels(&locale(app));
    if let Some(item) = &inner.sharing_item {
        let _ = item.set_text(if inner.paused { resume } else { pause });
    }
    drop(inner);
    emit(app, action);
}

/// Shows or removes the tray icon (on the main thread, where GTK and AppKit want it).
pub fn set_mode(app: &AppHandle, mode: BackgroundMode) {
    let want = mode.tray_on_close && mode.shared_classes > 0;
    let handle = app.clone();
    let run = app.run_on_main_thread(move || {
        let Some(state) = handle.try_state::<TrayState>() else {
            return;
        };
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if want == inner.shown {
            return;
        }
        if want {
            match build(&handle) {
                Ok(item) => {
                    inner.shown = true;
                    inner.sharing_item = Some(item);
                }
                // No tray on this desktop (no AppIndicator): closing then quits (TS decides).
                Err(e) => log::warn!("cannot show the tray icon: {e}"),
            }
        } else {
            let _ = handle.remove_tray_by_id(TRAY_ID);
            inner.shown = false;
            inner.sharing_item = None;
            inner.paused = false;
        }
    });
    if let Err(e) = run {
        log::warn!("cannot change the tray icon: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_per_locale() {
        assert_eq!(labels("pt")[0], "Abrir o Tramado");
        assert_eq!(labels("es")[3], "Salir");
        assert_eq!(labels("de"), labels("en"));
        assert_eq!(
            serde_json::to_value(TrayEvent {
                action: TrayAction::PauseSharing
            })
            .unwrap(),
            serde_json::json!({"action": "pause-sharing"})
        );
    }
}
