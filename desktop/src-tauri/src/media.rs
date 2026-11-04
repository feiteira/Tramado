// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The `tramado-media` scheme (architecture §8, critique C10): `/c/<classId>/<class path…>`
//! (confined through the class registry, no symlinks), `/r/<recordingId>.webm` (a local-only
//! recording, ULID checked) and `/res/selftest.webm` (the bundled media self-test, critique R3).
//! Single byte ranges, explicit MIME, `nosniff`, `no-store`, CORS for the app's origin only —
//! all in `tramado_base::media`. Requests are answered off the main thread.

use std::path::PathBuf;

use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};
use tramado_base::media::{self, MediaMethod, MediaResponse, MediaRoute};

use crate::state::Shared;

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let r = respond(&app, &request);
        responder.respond(to_http(r));
    });
}

fn header<'a>(request: &'a Request<Vec<u8>>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// The bundled self-test file: the resource folder, else (debug builds run from `target/`) the
/// source tree's `resources/media/selftest.webm`.
pub fn selftest_path(resources: Option<&PathBuf>) -> Option<PathBuf> {
    if let Some(r) = resources {
        for p in [
            r.join("media").join("selftest.webm"),
            r.join("resources").join("media").join("selftest.webm"),
        ] {
            if p.is_file() {
                return Some(p);
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("media")
            .join("selftest.webm");
        if dev.is_file() {
            return Some(dev);
        }
    }
    None
}

fn respond<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> MediaResponse {
    let origin = header(request, "origin");
    let method = match *request.method() {
        Method::GET => MediaMethod::Get,
        Method::HEAD => MediaMethod::Head,
        Method::OPTIONS => return media::options(origin),
        _ => return media::status_only(405, origin),
    };
    let Some(shared) = app.try_state::<Shared>() else {
        return media::status_only(503, origin);
    };
    let range = header(request, "range");
    let (path, mime) = match media::route(request.uri().path()) {
        None => return media::status_only(404, origin),
        Some(MediaRoute::Class { class_id, path }) => {
            match media::resolve_class(&shared.fs, &class_id, &path) {
                Ok(p) => (p, media::mime_for(&path)),
                Err(status) => return media::status_only(status, origin),
            }
        }
        Some(MediaRoute::Recording { recording_id }) => (
            shared
                .paths
                .recordings_dir()
                .join(format!("{recording_id}.webm")),
            "audio/webm",
        ),
        Some(MediaRoute::SelfTest) => match selftest_path(shared.paths.resources.as_ref()) {
            Some(p) => (p, "audio/webm"),
            None => return media::status_only(404, origin),
        },
    };
    media::serve_request(method, &path, mime, range, origin)
}

fn to_http(r: MediaResponse) -> Response<Vec<u8>> {
    let mut b = Response::builder()
        .status(StatusCode::from_u16(r.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR));
    for (k, v) in &r.headers {
        b = b.header(k.as_str(), v.as_str());
    }
    match b.body(r.body) {
        Ok(resp) => resp,
        Err(e) => {
            log::warn!("media response could not be built: {e}");
            let mut fallback = Response::new(Vec::new());
            *fallback.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            fallback
        }
    }
}
