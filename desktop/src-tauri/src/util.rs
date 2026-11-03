// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/lib.rs helpers), MPL-2.0, same author.

//! Helpers every command module uses (architecture §5.5 `util.rs`, §6.0). Frozen after M0.

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, InvokeResponseBody, Request, Response};
use tramado_base::error::{AppError, AppResult, Code};

/// Runs disk, CPU or network work off the async runtime's threads.
pub async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::new(Code::IoError, format!("background work failed: {e}")))?
}

/// The raw body of a command called with a `Uint8Array` (class writes, appends, signatures).
pub fn body_bytes(req: &Request<'_>) -> AppResult<Vec<u8>> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        InvokeBody::Json(_) => Err(AppError::invalid("expected raw bytes")),
    }
}

/// A request header, percent-decoded: the webview encodes values with `encodeURIComponent`
/// because HTTP headers cannot carry non-ASCII class paths.
pub fn header(req: &Request<'_>, name: &str) -> AppResult<String> {
    header_opt(req, name)?.ok_or_else(|| AppError::invalid(format!("missing header {name}")))
}

pub fn header_opt(req: &Request<'_>, name: &str) -> AppResult<Option<String>> {
    let Some(raw) = req.headers().get(name) else {
        return Ok(None);
    };
    let raw = raw
        .to_str()
        .map_err(|_| AppError::invalid(format!("header {name} is not ASCII")))?;
    percent_decode_str(raw)
        .decode_utf8()
        .map(|s| Some(s.into_owned()))
        .map_err(|_| AppError::invalid(format!("header {name} is not UTF-8")))
}

/// `"1"` → true, `"0"` or absent → false (`x-own`).
pub fn header_flag(req: &Request<'_>, name: &str) -> AppResult<bool> {
    match header_opt(req, name)?.as_deref() {
        None | Some("0") => Ok(false),
        Some("1") => Ok(true),
        Some(_) => Err(AppError::invalid(format!("header {name} must be 0 or 1"))),
    }
}

/// The error of a command that is not implemented yet (architecture D-2).
pub fn not_implemented(cmd: &str) -> AppError {
    AppError::not_implemented(cmd)
}

/// Bytes for the webview (it receives an `ArrayBuffer`).
pub fn bytes_response(bytes: Vec<u8>) -> Response {
    Response::new(InvokeResponseBody::Raw(bytes))
}

/// `ArrayBuffer | null`.
pub fn optional_bytes_response(bytes: Option<Vec<u8>>) -> Response {
    match bytes {
        Some(b) => bytes_response(b),
        None => Response::new(InvokeResponseBody::Json("null".to_string())),
    }
}
