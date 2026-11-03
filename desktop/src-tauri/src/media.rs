// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The `tramado-media` scheme (architecture §8): `/c/<classId>/<class path…>`, `/r/<recordingId>.webm`,
//! `/res/selftest.webm`, with single byte ranges, explicit MIME, `nosniff` and CORS for the app's
//! origin only. **Stub (M0)**: answers 501; R-SHELL implements it on `tramado_base::media`.

use tauri::http::{Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let _ = request;
    let mut response = Response::new(Vec::new());
    *response.status_mut() = StatusCode::NOT_IMPLEMENTED;
    responder.respond(response);
}
