// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Deep links (architecture §5.5, §7.1, critique G17): `tramado://join/…` (and
//! `tramado://pair/…` in v1.1) from the deep-link plugin and from a second instance's argv
//! become `app:deep-link {url}`; an opened `.tramado-invite` file (argv, or the macOS open-file
//! event of the file association, which the plugin forwards as a `file://` URL) is read in Rust
//! (≤ 64 KiB, UTF-8) and delivered as `{url: 'file:', text}` — the webview never gets the path.
//!
//! Until the webview calls `app_take_pending_links`, links are queued: that call returns them
//! (a `tramado://` URL, or the text of an invite file) and from then on links are emitted. A link
//! that arrives twice within two seconds (the plugin and single-instance both forward argv on
//! Linux and Windows) is delivered once.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tramado_base::error::{AppError, AppResult};

use crate::commands::events;
use crate::state::Shared;

/// Payload of `app:deep-link`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkEvent {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Invite files larger than this are not read.
pub const MAX_INVITE_BYTES: u64 = 64 * 1024;
pub const INVITE_EXT: &str = "tramado-invite";
const SCHEME: &str = "tramado";
const DEDUP_WINDOW: Duration = Duration::from_secs(2);

#[derive(Default)]
struct Inner {
    /// Set by `app_take_pending_links`: the webview listens from then on.
    ready: bool,
    pending: Vec<String>,
    recent: Vec<(DeepLinkEvent, Instant)>,
}

pub struct DeepLinkState {
    inner: Mutex<Inner>,
}

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    app.manage(DeepLinkState {
        inner: Mutex::new(Inner::default()),
    });
    let handle = app.clone();
    app.deep_link().on_open_url(move |ev| {
        for url in ev.urls() {
            on_url(&handle, url.as_str());
        }
    });
    // Started by a link or an invite file (first instance).
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            on_url(app, url.as_str());
        }
    }
    for arg in std::env::args().skip(1) {
        on_arg(app, &arg);
    }
    Ok(())
}

/// Called by the single-instance plugin in the first instance with the second one's argv.
pub fn on_second_instance(app: &AppHandle, argv: Vec<String>) {
    crate::window::show_main(app);
    for arg in argv.iter().skip(1) {
        on_arg(app, arg);
    }
}

fn on_arg(app: &AppHandle, arg: &str) {
    if arg.starts_with("tramado://") {
        on_url(app, arg);
    } else if is_invite_path(Path::new(arg)) {
        on_invite_file(app, Path::new(arg));
    }
}

pub fn is_invite_path(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(INVITE_EXT))
}

fn on_url(app: &AppHandle, url: &str) {
    match classify_url(url) {
        Some(Link::Url(u)) => deliver(app, DeepLinkEvent { url: u, text: None }),
        Some(Link::File(p)) => on_invite_file(app, &p),
        None => log::warn!("ignored a link that is not Tramado's"),
    }
}

/// What a URL handed to the app is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Link {
    Url(String),
    File(PathBuf),
}

/// `tramado://…` links (at most 8 KiB) and `file://…/x.tramado-invite`; anything else is
/// ignored.
pub fn classify_url(url: &str) -> Option<Link> {
    let parsed = tauri::Url::parse(url.trim()).ok()?;
    match parsed.scheme() {
        SCHEME if url.len() <= 8192 => Some(Link::Url(url.trim().to_string())),
        "file" => {
            let p = parsed.to_file_path().ok()?;
            is_invite_path(&p).then_some(Link::File(p))
        }
        _ => None,
    }
}

/// The text of an invite file: ≤ 64 KiB of UTF-8.
pub fn read_invite(p: &Path) -> AppResult<String> {
    let meta = std::fs::metadata(p)?;
    if !meta.is_file() || meta.len() > MAX_INVITE_BYTES {
        return Err(AppError::invalid("not an invite file"));
    }
    let bytes = std::fs::read(p)?;
    let text = String::from_utf8(bytes).map_err(|_| AppError::invalid("the invite is not text"))?;
    Ok(text.trim().to_string())
}

/// An invite file opened or dropped on the window: its text goes to the Join dialog.
pub fn open_invite_file(app: &AppHandle, p: &Path) {
    on_invite_file(app, p);
}

fn on_invite_file(app: &AppHandle, p: &Path) {
    match read_invite(p) {
        Ok(text) => deliver(
            app,
            DeepLinkEvent {
                url: "file:".into(),
                text: Some(text),
            },
        ),
        Err(e) => log::warn!("cannot read an invite file: {e}"),
    }
}

fn deliver(app: &AppHandle, ev: DeepLinkEvent) {
    let Some(state) = app.try_state::<DeepLinkState>() else {
        return;
    };
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.recent.retain(|(_, at)| at.elapsed() < DEDUP_WINDOW);
    if inner.recent.iter().any(|(e, _)| *e == ev) {
        return;
    }
    inner.recent.push((ev.clone(), Instant::now()));
    if !inner.ready {
        inner
            .pending
            .push(ev.text.clone().unwrap_or_else(|| ev.url.clone()));
        return;
    }
    drop(inner);
    crate::window::show_main(app);
    if let Err(e) = app.emit(events::DEEP_LINK, &ev) {
        log::warn!("cannot emit app:deep-link: {e}");
    }
}

/// `app_take_pending_links`: the queued links; later links are emitted.
pub fn take_pending(app: &AppHandle) -> Vec<String> {
    let Some(state) = app.try_state::<DeepLinkState>() else {
        return Vec::new();
    };
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.ready = true;
    std::mem::take(&mut inner.pending)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::app::tests::TempDir;

    #[test]
    fn links_and_invite_files() {
        assert_eq!(
            classify_url("tramado://join/eyJ2IjoxfQ"),
            Some(Link::Url("tramado://join/eyJ2IjoxfQ".into()))
        );
        assert_eq!(classify_url("https://example.org/join"), None);
        assert_eq!(classify_url("file:///home/a/notes.pdf"), None);
        assert_eq!(
            classify_url(&format!("tramado://join/{}", "a".repeat(9000))),
            None
        );
        let dir = TempDir::new();
        let f = dir.path().join("Direito Civil.tramado-invite");
        std::fs::write(&f, "  tramado://join/eyJ2IjoxfQ\n").unwrap();
        let url = tauri::Url::from_file_path(&f).unwrap();
        assert_eq!(classify_url(url.as_str()), Some(Link::File(f.clone())));
        assert_eq!(read_invite(&f).unwrap(), "tramado://join/eyJ2IjoxfQ");
        let big = dir.path().join("big.tramado-invite");
        std::fs::write(&big, vec![b'a'; (MAX_INVITE_BYTES + 1) as usize]).unwrap();
        assert!(read_invite(&big).is_err());
        let bin = dir.path().join("bin.tramado-invite");
        std::fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_invite(&bin).is_err());
        assert!(is_invite_path(Path::new("/a/B.TRAMADO-INVITE")));
        assert!(!is_invite_path(Path::new("/a/b.invite")));
    }
}
