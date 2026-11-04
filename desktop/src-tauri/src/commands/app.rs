// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! App, app files, private data, cache, person key (architecture §6.1, §13). The private folder
//! `data/private/<classId>/` is never synced and its `mirror/` is Rust's own; cache keys are an
//! allow-list; the person key never leaves Rust (it signs only bindings of this device).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;
use tramado_base::appfiles::{self, AppFile, StorageUsage};
use tramado_base::applog::AppLog;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::files;
use tramado_net::person::{PersonInfo, PersonProof};
use tramado_speech::ModelState;
use tramado_sync::SyncDiagnostics;

use crate::commands::ai::AiState;
use crate::state::Shared;
use crate::util::{blocking, body_bytes, header, optional_bytes_response};

/// `paths` of `AppInfo` (display only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config: String,
    pub data: String,
    pub cache: String,
}

/// TS `AppInfo`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    /// "linux" | "macos" | "windows"
    pub os: String,
    pub arch: String,
    /// e.g. "WebKitGTK 2.52.6"
    pub webview: Option<String>,
    pub dev_isolated: bool,
    pub e2e: bool,
    pub started_hidden: bool,
    /// "tramado-media://localhost" | "http://tramado-media.localhost"
    pub media_base: String,
    pub paths: AppPaths,
    /// How `<audio>` plays class recordings here: `"scheme"` (a `tramado-media` URL) or `"blob"`
    /// (WebKitGTK: its media pipeline cannot read custom schemes, so the player goes straight to
    /// the Blob-URL fallback of architecture §8; measured by the media self-test, critique R3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_audio: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuFlags {
    pub avx2: bool,
    pub fma: bool,
    pub f16c: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDiag {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub webview: Option<String>,
    pub cpu: CpuFlags,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDiag {
    pub cpu_ok: bool,
    pub models: Vec<ModelState>,
    pub vad: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCodeAt {
    pub at: String,
    pub code: Code,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDiag {
    /// the last 20, no content
    pub last_codes: Vec<AiCodeAt>,
}

/// TS `RustDiagnostics`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RustDiagnostics {
    pub app: AppDiag,
    pub sync: Option<SyncDiagnostics>,
    pub speech: SpeechDiag,
    pub ai: AiDiag,
    /// app.log, device IDs truncated to ShortIds
    pub log_tail: Vec<String>,
}

/// `app_set_background_mode` argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundMode {
    pub tray_on_close: bool,
    pub shared_classes: u32,
}

/// `app_reveal` target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RevealTarget {
    ClassesRoot,
    Private,
    Models,
    Cache,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
        }
    }
}

/// The app domain's managed state.
pub struct AppState {
    pub started_hidden: bool,
    /// Autostart while `TRAMADO_DATA_DIR` is set: kept in memory, never registered with the OS
    /// (a development or e2e build must not start at the developer's login).
    dev_autostart: AtomicBool,
}

/// The message the webview logs once it rendered (M0 `App.tsx`); the desktop smoke test waits
/// for it, and the e2e media self-test starts after it.
pub const WEBVIEW_READY: &str = "webview ready";

pub fn init(app: &AppHandle, shared: &Shared) -> AppResult<()> {
    let started_hidden = std::env::args().skip(1).any(|a| a == "--hidden");
    if let Some(log) = app.try_state::<Arc<AppLog>>() {
        AppLog::install(log.inner().clone());
    }
    // Leftovers of interrupted atomic writes in the private folders (older than an hour).
    let private = shared.paths.data.join("private");
    if let Ok(entries) = std::fs::read_dir(&private) {
        for e in entries.flatten() {
            let _ = files::sweep_stale_tmps(&e.path(), std::time::Duration::from_secs(3600));
        }
    }
    app.manage(AppState {
        started_hidden,
        dev_autostart: AtomicBool::new(false),
    });
    Ok(())
}

pub fn on_exit(app: &AppHandle) {
    if let Some(log) = app.try_state::<Arc<AppLog>>() {
        log.write("info", "Tramado exiting", None);
        log.flush();
    }
}

fn webview_label(version: String) -> String {
    match std::env::consts::OS {
        "linux" => format!("WebKitGTK {version}"),
        "windows" => format!("WebView2 {version}"),
        "macos" => format!("WKWebView {version}"),
        _ => version,
    }
}

/// `AppInfo.mediaAudio`: WebKitGTK cannot play media from a custom scheme (the media self-test
/// fails with `MEDIA_ERR_SRC_NOT_SUPPORTED`; the Blob fallback seeks within 0.25 s).
pub fn media_audio() -> &'static str {
    if cfg!(target_os = "linux") {
        "blob"
    } else {
        "scheme"
    }
}

/// `AppInfo.mediaBase` (architecture §8).
pub fn media_base() -> &'static str {
    if cfg!(windows) {
        "http://tramado-media.localhost"
    } else {
        "tramado-media://localhost"
    }
}

fn webview_version() -> Option<String> {
    tauri::webview_version().ok().map(webview_label)
}

#[tauri::command]
pub async fn app_info(
    app: AppHandle,
    shared: State<'_, Shared>,
    state: State<'_, AppState>,
) -> AppResult<AppInfo> {
    let p = &shared.paths;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        webview: webview_version(),
        dev_isolated: p.dev_isolated,
        e2e: p.dev_isolated && p.e2e,
        started_hidden: state.started_hidden,
        media_base: media_base().to_string(),
        paths: AppPaths {
            config: p.config.to_string_lossy().into_owned(),
            data: p.data.to_string_lossy().into_owned(),
            cache: p.cache.to_string_lossy().into_owned(),
        },
        media_audio: Some(media_audio().to_string()),
    })
}

#[tauri::command]
pub async fn app_file_read(shared: State<'_, Shared>, name: String) -> AppResult<Option<String>> {
    let f = AppFile::from_name(&name)?;
    let paths = shared.paths.clone();
    blocking(move || appfiles::read(&paths, f)).await
}

#[tauri::command]
pub async fn app_file_write(
    shared: State<'_, Shared>,
    name: String,
    text: String,
) -> AppResult<()> {
    let f = AppFile::from_name(&name)?;
    let paths = shared.paths.clone();
    blocking(move || appfiles::write(&paths, f, &text)).await
}

#[tauri::command]
pub async fn app_log(
    app: AppHandle,
    log: State<'_, Arc<AppLog>>,
    level: LogLevel,
    message: String,
    data: Option<serde_json::Value>,
) -> AppResult<()> {
    let log = log.inner().clone();
    let ready = message == WEBVIEW_READY;
    blocking(move || {
        log.write(level.as_str(), &message, data.as_ref());
        Ok(())
    })
    .await?;
    if ready {
        crate::window::on_webview_ready(&app);
    }
    Ok(())
}

/// Links received before the webview listened (`tramado://…` URLs, or the text of an opened
/// `.tramado-invite` file). From this call on, new links arrive as `app:deep-link` events.
#[tauri::command]
pub async fn app_take_pending_links(app: AppHandle) -> AppResult<Vec<String>> {
    Ok(crate::deeplink::take_pending(&app))
}

#[tauri::command]
pub async fn app_set_background_mode(app: AppHandle, mode: BackgroundMode) -> AppResult<()> {
    crate::tray::set_mode(&app, mode);
    Ok(())
}

#[tauri::command]
pub async fn app_autostart_get(
    app: AppHandle,
    shared: State<'_, Shared>,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    if shared.paths.dev_isolated {
        return Ok(state.dev_autostart.load(Ordering::SeqCst));
    }
    blocking(move || {
        app.autolaunch()
            .is_enabled()
            .map_err(|e| AppError::new(Code::IoError, format!("autostart: {e}")))
    })
    .await
}

/// Launch argument `--hidden` (registered by the plugin in `lib.rs`).
#[tauri::command]
pub async fn app_autostart_set(
    app: AppHandle,
    shared: State<'_, Shared>,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<()> {
    if shared.paths.dev_isolated {
        state.dev_autostart.store(enabled, Ordering::SeqCst);
        return Ok(());
    }
    blocking(move || {
        let al = app.autolaunch();
        let r = if enabled { al.enable() } else { al.disable() };
        r.map_err(|e| AppError::new(Code::PermissionDenied, format!("autostart: {e}")))
    })
    .await
}

/// The exit path (architecture §5.5): `RunEvent::Exit` runs speech, sync and log shutdown.
#[tauri::command]
pub async fn app_quit(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

fn cpu_flags() -> CpuFlags {
    #[cfg(target_arch = "x86_64")]
    {
        CpuFlags {
            avx2: std::arch::is_x86_feature_detected!("avx2"),
            fma: std::arch::is_x86_feature_detected!("fma"),
            f16c: std::arch::is_x86_feature_detected!("f16c"),
        }
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        CpuFlags {
            avx2: false,
            fma: false,
            f16c: false,
        }
    }
}

/// Everything Rust knows for Settings → Help → Diagnostics, with no content and device IDs cut
/// to ShortIds. Sync and speech are read through their managed handles (`Arc<SyncEngine>`,
/// `Arc<Speech>`) when those domains manage them.
#[tauri::command]
pub async fn diag_collect(app: AppHandle, shared: State<'_, Shared>) -> AppResult<RustDiagnostics> {
    let paths = shared.paths.clone();
    let version = app.package_info().version.to_string();
    blocking(move || {
        let sync = app
            .try_state::<Arc<tramado_sync::SyncEngine>>()
            .and_then(|s| s.diagnostics().ok());
        let speech = match app.try_state::<Arc<tramado_speech::Speech>>() {
            Some(s) => {
                let info = s.info();
                SpeechDiag {
                    cpu_ok: info.cpu_ok,
                    models: info.models,
                    vad: info.vad,
                }
            }
            None => SpeechDiag {
                cpu_ok: false,
                models: Vec::new(),
                vad: paths.vad_path().is_some(),
            },
        };
        let last_codes = app
            .try_state::<AiState>()
            .map(|ai| {
                ai.activity
                    .last_codes(20)
                    .into_iter()
                    .map(|(at, code)| AiCodeAt { at, code })
                    .collect()
            })
            .unwrap_or_default();
        let log_tail = app
            .try_state::<Arc<AppLog>>()
            .map(|l| l.tail_for_diagnostics(200))
            .unwrap_or_default();
        let sync = sync.map(|mut d| {
            d.log_tail = d
                .log_tail
                .iter()
                .map(|l| tramado_base::applog::truncate_device_ids(l))
                .collect();
            d
        });
        Ok(RustDiagnostics {
            app: AppDiag {
                version,
                os: std::env::consts::OS.to_string(),
                arch: std::env::consts::ARCH.to_string(),
                webview: webview_version(),
                cpu: cpu_flags(),
            },
            sync,
            speech,
            ai: AiDiag { last_codes },
            log_tail,
        })
    })
    .await
}

/// Creates the person key on the first call (onboarding).
#[tauri::command]
pub async fn person_init(ai: State<'_, AiState>) -> AppResult<PersonInfo> {
    let person = ai.person.clone();
    blocking(move || person.init()).await
}

/// Signs the binding of **this** device (the one `ClassFs` knows) to the person for `classId`.
#[tauri::command]
pub async fn person_prove(
    shared: State<'_, Shared>,
    ai: State<'_, AiState>,
    class_id: String,
) -> AppResult<PersonProof> {
    let person = ai.person.clone();
    let device = shared.fs.device();
    blocking(move || person.prove_own(&class_id, device.as_deref())).await
}

#[tauri::command]
pub async fn storage_usage(shared: State<'_, Shared>) -> AppResult<StorageUsage> {
    let (paths, registry) = (shared.paths.clone(), shared.registry.clone());
    blocking(move || Ok(appfiles::storage_usage(&paths, &registry))).await
}

/// Deletes the cache except `models-catalog.json`.
pub fn clear_cache(cache: &Path) -> AppResult<()> {
    let Ok(entries) = std::fs::read_dir(cache) else {
        return Ok(());
    };
    for e in entries.flatten() {
        if e.file_name() == "models-catalog.json" {
            continue;
        }
        let p = e.path();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            files::remove_dir_all_if_exists(&p)?;
        } else {
            files::remove_file_if_exists(&p)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn cache_clear(shared: State<'_, Shared>) -> AppResult<()> {
    let cache = shared.paths.cache.clone();
    blocking(move || clear_cache(&cache)).await
}

fn reveal_target(
    shared: &Shared,
    which: RevealTarget,
    class_id: Option<&str>,
) -> AppResult<PathBuf> {
    let p = &shared.paths;
    Ok(match which {
        RevealTarget::ClassesRoot => shared
            .registry
            .root_dir()
            .unwrap_or_else(|| p.default_classes_root.clone()),
        RevealTarget::Private => match class_id {
            Some(c) => {
                let entry = shared
                    .registry
                    .get(c)
                    .ok_or_else(|| AppError::not_found("no such class"))?;
                appfiles::private_root(p, &entry.class_id)?
            }
            None => p.data.join("private"),
        },
        RevealTarget::Models => p.models_dir(),
        RevealTarget::Cache => p.cache.clone(),
    })
}

/// Shows a folder of Tramado's in the file manager (created when missing, so there is
/// something to show).
#[tauri::command]
pub async fn app_reveal(
    app: AppHandle,
    shared: State<'_, Shared>,
    which: RevealTarget,
    class_id: Option<String>,
) -> AppResult<()> {
    let target = reveal_target(&shared, which, class_id.as_deref())?;
    blocking(move || {
        std::fs::create_dir_all(&target)?;
        app.opener()
            .reveal_item_in_dir(&target)
            .map_err(|e| AppError::new(Code::IoError, format!("cannot open the folder: {e}")))
    })
    .await
}

fn private_file(shared: &Shared, class_id: &str, path: &str) -> AppResult<PathBuf> {
    appfiles::private_path(&shared.paths, class_id, path)
}

/// `ArrayBuffer | null`.
#[tauri::command]
pub async fn private_read(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
) -> AppResult<Response> {
    let abs = private_file(&shared, &class_id, &path)?;
    blocking(move || Ok(optional_bytes_response(files::read_optional(&abs)?))).await
}

/// Raw body; headers `x-class`, `x-path`.
#[tauri::command]
pub async fn private_write(shared: State<'_, Shared>, request: Request<'_>) -> AppResult<()> {
    let abs = private_file(
        &shared,
        &header(&request, "x-class")?,
        &header(&request, "x-path")?,
    )?;
    let bytes = body_bytes(&request)?;
    blocking(move || files::write_atomic(&abs, &bytes)).await
}

/// Raw body (one line incl. `\n`); headers `x-class`, `x-path`. Returns the new length.
#[tauri::command]
pub async fn private_append(shared: State<'_, Shared>, request: Request<'_>) -> AppResult<u64> {
    let abs = private_file(
        &shared,
        &header(&request, "x-class")?,
        &header(&request, "x-path")?,
    )?;
    let line = body_bytes(&request)?;
    blocking(move || {
        files::check_line(&line)?;
        files::append_line(&abs, &line)
    })
    .await
}

/// Every file under `dir` (`""` = the class's private folder), as paths relative to `dir`,
/// sorted; `mirror/` is never listed; a missing folder lists nothing.
pub fn list_private(root: &Path, dir: &Path) -> Vec<String> {
    let mirror = root.join("mirror");
    let mut out: Vec<String> = walkdir_files(dir)
        .into_iter()
        .filter(|p| !p.starts_with(&mirror))
        .filter_map(|p| {
            let rel = p.strip_prefix(dir).ok()?;
            let parts: Option<Vec<&str>> =
                rel.components().map(|c| c.as_os_str().to_str()).collect();
            Some(parts?.join("/"))
        })
        .filter(|rel| !rel.split('/').any(files::is_skipped_name))
        .collect();
    out.sort();
    out
}

fn walkdir_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for e in entries.flatten() {
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() {
                stack.push(e.path());
            } else if t.is_file() {
                out.push(e.path());
            }
        }
    }
    out
}

#[tauri::command]
pub async fn private_list(
    shared: State<'_, Shared>,
    class_id: String,
    dir: String,
) -> AppResult<Vec<String>> {
    let root = appfiles::private_root(&shared.paths, &class_id)?;
    let abs = if dir.is_empty() {
        root.clone()
    } else {
        private_file(&shared, &class_id, &dir)?
    };
    blocking(move || Ok(list_private(&root, &abs))).await
}

/// Nothing there is not an error.
#[tauri::command]
pub async fn private_remove(
    shared: State<'_, Shared>,
    class_id: String,
    path: String,
    recursive: bool,
) -> AppResult<()> {
    let abs = private_file(&shared, &class_id, &path)?;
    blocking(move || {
        match std::fs::symlink_metadata(&abs) {
            Ok(m) if m.is_dir() => {
                if recursive {
                    files::remove_dir_all_if_exists(&abs)?;
                } else {
                    std::fs::remove_dir(&abs)?;
                }
            }
            Ok(_) => {
                files::remove_file_if_exists(&abs)?;
            }
            Err(_) => {}
        }
        Ok(())
    })
    .await
}

/// Deletes `data/private/<classId>/`, the mirror included.
#[tauri::command]
pub async fn private_purge(shared: State<'_, Shared>, class_id: String) -> AppResult<()> {
    let root = appfiles::private_root(&shared.paths, &class_id)?;
    blocking(move || files::remove_dir_all_if_exists(&root).map(|_| ())).await
}

/// `ArrayBuffer | null`.
#[tauri::command]
pub async fn cache_read(shared: State<'_, Shared>, key: String) -> AppResult<Response> {
    let abs = appfiles::cache_path(&shared.paths, &key)?;
    blocking(move || Ok(optional_bytes_response(files::read_optional(&abs)?))).await
}

/// Raw body; header `x-name` (= the cache key).
#[tauri::command]
pub async fn cache_write(shared: State<'_, Shared>, request: Request<'_>) -> AppResult<()> {
    let abs = appfiles::cache_path(&shared.paths, &header(&request, "x-name")?)?;
    let bytes = body_bytes(&request)?;
    blocking(move || files::write_atomic(&abs, &bytes)).await
}

#[tauri::command]
pub async fn cache_remove(shared: State<'_, Shared>, key: String) -> AppResult<()> {
    let abs = appfiles::cache_path(&shared.paths, &key)?;
    blocking(move || files::remove_file_if_exists(&abs).map(|_| ())).await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A fresh folder under the system temp dir, removed on drop (the desktop crate has no
    /// dev-dependencies).
    pub(crate) struct TempDir(PathBuf);
    impl TempDir {
        pub(crate) fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "tramado-desktop-test-{}",
                tramado_base::ids::random_token_hex(8)
            ));
            std::fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
        pub(crate) fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn private_listing_hides_the_mirror() {
        let dir = TempDir::new();
        let root = dir.path().join("tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa");
        for p in [
            "ask/b.jsonl",
            "notes/a.md",
            "mirror/.tramado/x.json",
            "trust.json",
            "notes/.x.abcdefgh.tmp",
        ] {
            let f = files::join_rel(&root, p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, b"x").unwrap();
        }
        assert_eq!(
            list_private(&root, &root),
            vec!["ask/b.jsonl", "notes/a.md", "trust.json"]
        );
        assert_eq!(list_private(&root, &root.join("notes")), vec!["a.md"]);
        assert!(list_private(&root, &root.join("none")).is_empty());
    }

    #[test]
    fn cache_clear_keeps_the_catalog() {
        let dir = TempDir::new();
        let h = "0".repeat(64);
        for p in [
            "models-catalog.json".to_string(),
            format!("text/{h}.json"),
            format!("peaks/{h}-100.json"),
        ] {
            let f = files::join_rel(dir.path(), &p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, b"{}").unwrap();
        }
        clear_cache(dir.path()).unwrap();
        let left: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("models-catalog.json")]);
        clear_cache(&dir.path().join("missing")).unwrap();
    }
}
