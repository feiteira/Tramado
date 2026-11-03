// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! App, app files, private data, cache, person key (architecture §6.1). M0 implements
//! `app_info`, `app_file_read`, `app_file_write`, `app_log` and `app_take_pending_links` (so the
//! desktop app boots); R-SHELL implements the rest.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Manager, State};
use tramado_base::appfiles::{self, AppFile, StorageUsage};
use tramado_base::applog::AppLog;
use tramado_base::error::{AppResult, Code};
use tramado_net::person::{PersonInfo, PersonProof};
use tramado_speech::ModelState;
use tramado_sync::SyncDiagnostics;

use crate::state::Shared;
use crate::util::{blocking, not_implemented};

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
}

pub fn init(app: &AppHandle, _shared: &Shared) -> AppResult<()> {
    let started_hidden = std::env::args().skip(1).any(|a| a == "--hidden");
    app.manage(AppState { started_hidden });
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
        webview: tauri::webview_version().ok().map(webview_label),
        dev_isolated: p.dev_isolated,
        e2e: p.dev_isolated && p.e2e,
        started_hidden: state.started_hidden,
        media_base: if cfg!(windows) {
            "http://tramado-media.localhost"
        } else {
            "tramado-media://localhost"
        }
        .to_string(),
        paths: AppPaths {
            config: p.config.to_string_lossy().into_owned(),
            data: p.data.to_string_lossy().into_owned(),
            cache: p.cache.to_string_lossy().into_owned(),
        },
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
    log: State<'_, Arc<AppLog>>,
    level: LogLevel,
    message: String,
    data: Option<serde_json::Value>,
) -> AppResult<()> {
    let log = log.inner().clone();
    blocking(move || {
        log.write(level.as_str(), &message, data.as_ref());
        Ok(())
    })
    .await
}

/// Links received before the webview listened (R-SHELL: the deeplink.rs queue). M0: none.
#[tauri::command]
pub async fn app_take_pending_links() -> AppResult<Vec<String>> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn app_set_background_mode(mode: BackgroundMode) -> AppResult<()> {
    let _ = mode;
    Err(not_implemented("app_set_background_mode"))
}

#[tauri::command]
pub async fn app_autostart_get() -> AppResult<bool> {
    Err(not_implemented("app_autostart_get"))
}

#[tauri::command]
pub async fn app_autostart_set(enabled: bool) -> AppResult<()> {
    let _ = enabled;
    Err(not_implemented("app_autostart_set"))
}

#[tauri::command]
pub async fn app_quit() -> AppResult<()> {
    Err(not_implemented("app_quit"))
}

#[tauri::command]
pub async fn diag_collect() -> AppResult<RustDiagnostics> {
    Err(not_implemented("diag_collect"))
}

#[tauri::command]
pub async fn person_init() -> AppResult<PersonInfo> {
    Err(not_implemented("person_init"))
}

#[tauri::command]
pub async fn person_prove(class_id: String) -> AppResult<PersonProof> {
    let _ = class_id;
    Err(not_implemented("person_prove"))
}

#[tauri::command]
pub async fn storage_usage() -> AppResult<StorageUsage> {
    Err(not_implemented("storage_usage"))
}

#[tauri::command]
pub async fn cache_clear() -> AppResult<()> {
    Err(not_implemented("cache_clear"))
}

#[tauri::command]
pub async fn app_reveal(which: RevealTarget, class_id: Option<String>) -> AppResult<()> {
    let _ = (which, class_id);
    Err(not_implemented("app_reveal"))
}

/// `ArrayBuffer | null`.
#[tauri::command]
pub async fn private_read(class_id: String, path: String) -> AppResult<Response> {
    let _ = (class_id, path);
    Err(not_implemented("private_read"))
}

/// Raw body; headers `x-class`, `x-path`.
#[tauri::command]
pub async fn private_write(request: Request<'_>) -> AppResult<()> {
    let _ = request;
    Err(not_implemented("private_write"))
}

/// Raw body (one line incl. `\n`); headers `x-class`, `x-path`. Returns the new length.
#[tauri::command]
pub async fn private_append(request: Request<'_>) -> AppResult<u64> {
    let _ = request;
    Err(not_implemented("private_append"))
}

#[tauri::command]
pub async fn private_list(class_id: String, dir: String) -> AppResult<Vec<String>> {
    let _ = (class_id, dir);
    Err(not_implemented("private_list"))
}

#[tauri::command]
pub async fn private_remove(class_id: String, path: String, recursive: bool) -> AppResult<()> {
    let _ = (class_id, path, recursive);
    Err(not_implemented("private_remove"))
}

#[tauri::command]
pub async fn private_purge(class_id: String) -> AppResult<()> {
    let _ = class_id;
    Err(not_implemented("private_purge"))
}

/// `ArrayBuffer | null`.
#[tauri::command]
pub async fn cache_read(key: String) -> AppResult<Response> {
    let _ = key;
    Err(not_implemented("cache_read"))
}

/// Raw body; header `x-name` (= the cache key).
#[tauri::command]
pub async fn cache_write(request: Request<'_>) -> AppResult<()> {
    let _ = request;
    Err(not_implemented("cache_write"))
}

#[tauri::command]
pub async fn cache_remove(key: String) -> AppResult<()> {
    let _ = key;
    Err(not_implemented("cache_remove"))
}
