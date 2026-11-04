// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! System (architecture §6.5): links, notifications, the opt-in OS-global marker shortcuts,
//! power. Every plugin is driven from Rust; the webview has no opener, notification or
//! shortcut permission (§18.4).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt as _;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::power::Power;
use tramado_speech::MarkerKind;

use super::{events, ConfirmText};
use crate::commands::dialogs;
use crate::state::Shared;
use crate::util::blocking;

/// `notify_show` argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyRequest {
    pub title: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// `shortcut_set_markers` argument (`Partial<Record<…, string>>`; default `Ctrl/⌘+Alt+1…4`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkerAccelerators {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub important: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confused: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exam: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub todo: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutId {
    Marker,
}

/// Payload of `app:shortcut`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutEvent {
    pub id: ShortcutId,
    pub kind: MarkerKind,
}

pub struct SystemState {
    /// The marker shortcuts registered now.
    shortcuts: Mutex<Vec<Shortcut>>,
}

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    app.manage(SystemState {
        shortcuts: Mutex::new(Vec::new()),
    });
    Ok(())
}

pub fn on_exit(app: &AppHandle) {
    if let Some(s) = app.try_state::<SystemState>() {
        let mut list = s.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
        for sc in list.drain(..) {
            let _ = app.global_shortcut().unregister(sc);
        }
    }
}

/// Opened without a confirmation (architecture §6.5).
pub const ALLOWED_PREFIXES: [&str; 4] = [
    "https://openrouter.ai/",
    "https://huggingface.co/",
    "https://github.com/feiteira/Tramado",
    "https://feiteira.github.io/Tramado/",
];

/// What `open_external` does with a URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum External {
    /// On the allow-list: open at once.
    Open(String),
    /// Ask first, naming this host.
    Ask { url: String, host: String },
}

/// `https://` only, with a host and no user name; `INVALID` otherwise.
pub fn classify_external(url: &str) -> AppResult<External> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|_| AppError::invalid("not a link"))?;
    if parsed.scheme() != "https" {
        return Err(AppError::invalid("only https links are opened"));
    }
    let host = parsed
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| AppError::invalid("the link has no host"))?
        .to_string();
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::invalid("links with user names are not opened"));
    }
    let normalised = parsed.to_string();
    // The allow-list is matched on the parsed form, so `https://openrouter.ai.evil/` or
    // `https://openrouter.ai@evil/` cannot pass for it.
    let github_exact = normalised == "https://github.com/feiteira/Tramado"
        || normalised.starts_with("https://github.com/feiteira/Tramado/")
        || normalised.starts_with("https://github.com/feiteira/Tramado?")
        || normalised.starts_with("https://github.com/feiteira/Tramado#");
    let allowed = ALLOWED_PREFIXES
        .iter()
        .filter(|p| !p.starts_with("https://github.com/"))
        .any(|p| normalised.starts_with(p))
        || github_exact;
    Ok(if allowed {
        External::Open(normalised)
    } else {
        External::Ask {
            url: normalised,
            host,
        }
    })
}

/// `https://` only (else `INVALID`); a native confirmation showing the host, except for the
/// allow-listed prefixes. `false` = declined. In e2e mode nothing is launched.
#[tauri::command]
pub async fn open_external(
    app: AppHandle,
    shared: State<'_, Shared>,
    url: String,
    text: ConfirmText,
) -> AppResult<bool> {
    let e2e = shared.paths.dev_isolated && shared.paths.e2e;
    let what = classify_external(&url)?;
    blocking(move || {
        let target = match what {
            External::Open(u) => u,
            External::Ask { url, host } => {
                if !dialogs::confirm(&app, &text, Some(&host)) {
                    return Ok(false);
                }
                url
            }
        };
        if e2e {
            log::info!("e2e: not opening an external link");
            return Ok(true);
        }
        app.opener()
            .open_url(target, None::<&str>)
            .map_err(|e| AppError::new(Code::IoError, format!("cannot open the link: {e}")))?;
        Ok(true)
    })
    .await
}

/// Best effort: a desktop without a notification service only logs a warning.
#[tauri::command]
pub async fn notify_show(app: AppHandle, n: NotifyRequest) -> AppResult<()> {
    blocking(move || {
        if let Err(e) = app
            .notification()
            .builder()
            .title(n.title)
            .body(n.body)
            .show()
        {
            log::warn!("cannot show a notification: {e}");
        }
        Ok(())
    })
    .await
}

fn kinds(a: &MarkerAccelerators) -> Vec<(MarkerKind, &str)> {
    let mut out = Vec::new();
    for (k, v) in [
        (MarkerKind::Important, &a.important),
        (MarkerKind::Confused, &a.confused),
        (MarkerKind::Exam, &a.exam),
        (MarkerKind::Todo, &a.todo),
    ] {
        if let Some(s) = v.as_deref().filter(|s| !s.trim().is_empty()) {
            out.push((k, s));
        }
    }
    out
}

/// Registers (or, with `null`, unregisters) the opt-in OS-global marker shortcuts (D28). A
/// press emits `app:shortcut {id: 'marker', kind}`. `INVALID` for an unreadable accelerator,
/// `CONFLICT {kind}` when one is taken (then none is registered).
#[tauri::command]
pub async fn shortcut_set_markers(
    app: AppHandle,
    state: State<'_, SystemState>,
    accelerators: Option<MarkerAccelerators>,
) -> AppResult<()> {
    let gs = app.global_shortcut();
    let mut current = state.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
    for sc in current.drain(..) {
        let _ = gs.unregister(sc);
    }
    let Some(acc) = accelerators else {
        return Ok(());
    };
    let mut parsed = Vec::new();
    for (kind, text) in kinds(&acc) {
        let sc: Shortcut = text
            .parse()
            .map_err(|_| AppError::invalid(format!("not a keyboard shortcut: {text}")))?;
        parsed.push((kind, sc));
    }
    for (kind, sc) in parsed {
        let emitter = app.clone();
        let registered = gs.on_shortcut(sc, move |_app, _sc, ev| {
            if ev.state() == ShortcutState::Pressed {
                let _ = emitter.emit(
                    events::SHORTCUT,
                    ShortcutEvent {
                        id: ShortcutId::Marker,
                        kind,
                    },
                );
            }
        });
        if let Err(e) = registered {
            for done in current.drain(..) {
                let _ = gs.unregister(done);
            }
            return Err(
                AppError::new(Code::Conflict, format!("the shortcut is taken: {e}"))
                    .with_data(serde_json::json!({ "kind": kind })),
            );
        }
        current.push(sc);
    }
    Ok(())
}

#[tauri::command]
pub async fn system_power() -> AppResult<Power> {
    blocking(|| Ok(tramado_base::power::system_power())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_list_skips_confirm() {
        for ok in [
            "https://openrouter.ai/keys",
            "https://openrouter.ai/settings/privacy",
            "https://huggingface.co/ggerganov/whisper.cpp",
            "https://github.com/feiteira/Tramado",
            "https://github.com/feiteira/Tramado/issues/new",
            "https://feiteira.github.io/Tramado/join/#abc",
        ] {
            assert!(
                matches!(classify_external(ok).unwrap(), External::Open(_)),
                "{ok}"
            );
        }
        for ask in [
            "https://openrouter.ai.evil.example/keys",
            "https://github.com/feiteira/TramadoEvil",
            "https://github.com/someone/else",
            "https://pt.wikipedia.org/wiki/C%C3%B3digo_Civil",
            "https://huggingface.co.evil.example/",
            // the project's GitHub Pages: only the Tramado repository's own path, after normalising
            "https://feiteira.github.io/TramadoEvil/",
            "https://feiteira.github.io/Tramado/../other/",
            "https://feiteira.github.io/Tramado/%2e%2e/other/",
            "https://feiteira.github.io/other/",
            "https://feiteira.github.io.evil.example/Tramado/",
            "https://evil.github.io/Tramado/join/",
        ] {
            assert!(
                matches!(classify_external(ask).unwrap(), External::Ask { .. }),
                "{ask}"
            );
        }
        assert_eq!(
            classify_external("https://pt.wikipedia.org/wiki/X").unwrap(),
            External::Ask {
                url: "https://pt.wikipedia.org/wiki/X".into(),
                host: "pt.wikipedia.org".into()
            }
        );
        for bad in [
            "http://openrouter.ai/keys",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "mailto:a@example.org",
            "https://user:pw@openrouter.ai/",
            "https://openrouter.ai@evil.example/",
            "not a url",
            "tramado-media://localhost/c/x",
        ] {
            assert_eq!(
                classify_external(bad).unwrap_err().code(),
                Code::Invalid,
                "{bad}"
            );
        }
    }

    #[test]
    fn marker_kinds_in_order() {
        let a = MarkerAccelerators {
            important: Some("CommandOrControl+Alt+1".into()),
            confused: None,
            exam: Some("CommandOrControl+Alt+3".into()),
            todo: Some("  ".into()),
        };
        let k: Vec<_> = kinds(&a)
            .into_iter()
            .map(|(k, s)| (k, s.to_string()))
            .collect();
        assert_eq!(
            k,
            vec![
                (MarkerKind::Important, "CommandOrControl+Alt+1".to_string()),
                (MarkerKind::Exam, "CommandOrControl+Alt+3".to_string())
            ]
        );
        for s in ["CommandOrControl+Alt+1", "CommandOrControl+Alt+4"] {
            assert!(s.parse::<Shortcut>().is_ok(), "{s}");
        }
    }
}
