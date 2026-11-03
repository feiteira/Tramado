// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Range responses for the `tramado-media` scheme (architecture §8). **Stub (M0)**: R-SHELL
//! implements single byte ranges (200/206/416, `Accept-Ranges: bytes`), the MIME table, the
//! CORS rules and `nosniff`, as a pure function with unit tests.

use std::path::Path;

/// What the scheme handler sends back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// The MIME type for a file name, by extension only (never sniffed). **Stub.**
pub fn mime_for(_name: &str) -> &'static str {
    "application/octet-stream"
}

/// Serves `path` for a `GET` with an optional `Range` header and request `Origin`. **Stub:**
/// answers 501.
pub fn serve(
    _path: &Path,
    _mime: &str,
    _range: Option<&str>,
    _origin: Option<&str>,
) -> MediaResponse {
    MediaResponse {
        status: 501,
        headers: vec![("Cache-Control".into(), "no-store".into())],
        body: Vec::new(),
    }
}
