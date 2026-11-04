// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Responses of the `tramado-media` scheme (architecture §8, critique C10): URL routing, single
//! byte ranges (200/206/416, `Accept-Ranges: bytes`), an explicit MIME type chosen by extension
//! (never sniffed), `nosniff`, `no-store`, and CORS for the app's own origin only. Pure
//! functions over a file path; the desktop crate resolves the path (class confinement, ULID
//! check, resource dir) and hands the response to Tauri. The Range logic follows Tauri's
//! `protocol/asset.rs`, restricted to one range.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::classfs::ClassFs;
use crate::error::Code;

/// What the scheme handler sends back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl MediaResponse {
    /// The value of a header (case-insensitive name).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// The only origins that may read media cross-origin (the app's own pages).
pub const ALLOWED_ORIGINS: [&str; 2] = ["tauri://localhost", "http://tauri.localhost"];

/// An open-ended range (`bytes=a-`) is answered with at most this many bytes; the media
/// element asks for the rest itself.
pub const OPEN_RANGE_MAX: u64 = 4 << 20;
/// No single response carries more than this (an explicit range is cut to it).
pub const RANGE_MAX: u64 = 64 << 20;

/// `GET` (body) or `HEAD` (headers only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaMethod {
    Get,
    Head,
}

/// The MIME type for a file name, by extension only (never sniffed).
pub fn mime_for(name: &str) -> &'static str {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "webm" => "audio/webm",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "txt" | "md" | "vtt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn h(k: &str, v: impl Into<String>) -> (String, String) {
    (k.to_string(), v.into())
}

/// Headers every response carries: `nosniff`, `no-store`, and CORS when `origin` is the app's.
fn base_headers(origin: Option<&str>) -> Vec<(String, String)> {
    let mut out = vec![
        h("X-Content-Type-Options", "nosniff"),
        h("Cache-Control", "no-store"),
        h("Vary", "Origin"),
    ];
    if let Some(o) = origin.filter(|o| ALLOWED_ORIGINS.contains(o)) {
        out.push(h("Access-Control-Allow-Origin", o));
        out.push(h(
            "Access-Control-Expose-Headers",
            "Content-Range, Accept-Ranges, Content-Length",
        ));
    }
    out
}

/// An empty answer with `status` (404, 403, 405, …).
pub fn status_only(status: u16, origin: Option<&str>) -> MediaResponse {
    let mut headers = base_headers(origin);
    headers.push(h("Content-Length", "0"));
    MediaResponse {
        status,
        headers,
        body: Vec::new(),
    }
}

/// `OPTIONS` (CORS preflight): 204 with the allowed methods and the `Range` header.
pub fn options(origin: Option<&str>) -> MediaResponse {
    let mut r = status_only(204, origin);
    r.headers
        .push(h("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"));
    r.headers.push(h("Access-Control-Allow-Headers", "Range"));
    r.headers.push(h("Access-Control-Max-Age", "600"));
    r
}

/// A single range `start..=end` within `len`, or `None` for 416. Several ranges: the first one
/// (one range per response, architecture §8). Open-ended ranges are cut to [`OPEN_RANGE_MAX`].
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim();
    let open_ended = spec
        .strip_prefix("bytes=")
        .and_then(|s| s.split(',').next())
        .is_some_and(|first| first.trim().ends_with('-'));
    let ranges = http_range::HttpRange::parse(spec, len).ok()?;
    let r = ranges.first()?;
    if r.length == 0 || r.start >= len {
        return None;
    }
    let cap = if open_ended {
        OPEN_RANGE_MAX
    } else {
        RANGE_MAX
    };
    let n = r.length.min(len - r.start).min(cap);
    Some((r.start, r.start + n - 1))
}

fn read_span(file: &mut File, start: u64, n: u64) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity(n as usize);
    file.take(n).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Serves `path` for a `GET` with an optional `Range` header and the request `Origin`.
pub fn serve(path: &Path, mime: &str, range: Option<&str>, origin: Option<&str>) -> MediaResponse {
    serve_request(MediaMethod::Get, path, mime, range, origin)
}

/// [`serve`] for `GET` or `HEAD`. A symbolic link is refused (403) even when the caller did
/// not check; a missing file or a folder is 404.
pub fn serve_request(
    method: MediaMethod,
    path: &Path,
    mime: &str,
    range: Option<&str>,
    origin: Option<&str>,
) -> MediaResponse {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => return status_only(403, origin),
        Ok(m) if m.is_file() => {}
        Ok(_) => return status_only(404, origin),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return status_only(403, origin)
        }
        Err(_) => return status_only(404, origin),
    }
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return status_only(403, origin)
        }
        Err(_) => return status_only(404, origin),
    };
    let len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return status_only(500, origin),
    };
    let mut headers = base_headers(origin);
    headers.push(h("Accept-Ranges", "bytes"));
    headers.push(h("Content-Type", mime));
    if mime == "image/svg+xml" {
        headers.push(h(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'",
        ));
    }
    if mime == "application/octet-stream" {
        headers.push(h("Content-Disposition", "attachment"));
    }
    if let Some(range) = range {
        let Some((start, end)) = parse_range(range, len) else {
            headers.push(h("Content-Range", format!("bytes */{len}")));
            headers.push(h("Content-Length", "0"));
            return MediaResponse {
                status: 416,
                headers,
                body: Vec::new(),
            };
        };
        let n = end + 1 - start;
        headers.push(h("Content-Range", format!("bytes {start}-{end}/{len}")));
        headers.push(h("Content-Length", n.to_string()));
        let body = match method {
            MediaMethod::Head => Vec::new(),
            MediaMethod::Get => match read_span(&mut file, start, n) {
                Ok(b) => b,
                Err(_) => return status_only(500, origin),
            },
        };
        return MediaResponse {
            status: 206,
            headers,
            body,
        };
    }
    headers.push(h("Content-Length", len.to_string()));
    let body = match method {
        MediaMethod::Head => Vec::new(),
        MediaMethod::Get => match read_span(&mut file, 0, len) {
            Ok(b) => b,
            Err(_) => return status_only(500, origin),
        },
    };
    MediaResponse {
        status: 200,
        headers,
        body,
    }
}

/// What a `tramado-media` URL path names (architecture §8; every segment percent-encoded).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaRoute {
    /// `/c/<classId>/<class path segments…>`
    Class { class_id: String, path: String },
    /// `/r/<recordingId>.webm` (a local-only recording)
    Recording { recording_id: String },
    /// `/res/selftest.webm`
    SelfTest,
}

fn decode(seg: &str) -> Option<String> {
    percent_encoding::percent_decode_str(seg)
        .decode_utf8()
        .ok()
        .map(|s| s.into_owned())
}

/// Parses the path of a `tramado-media` URL (no query, no fragment). `None` for anything else
/// (the handler answers 404).
pub fn route(url_path: &str) -> Option<MediaRoute> {
    let p = url_path.strip_prefix('/')?;
    let mut parts = p.split('/');
    match parts.next()? {
        "c" => {
            let class_id = decode(parts.next()?)?;
            if !crate::ids::is_class_id(&class_id) {
                return None;
            }
            let segs: Option<Vec<String>> = parts.map(decode).collect();
            let segs = segs?;
            // A decoded segment must not smuggle a separator in.
            if segs.is_empty() || segs.iter().any(|s| s.is_empty() || s.contains('/')) {
                return None;
            }
            Some(MediaRoute::Class {
                class_id,
                path: segs.join("/"),
            })
        }
        "r" => {
            let file = decode(parts.next()?)?;
            if parts.next().is_some() {
                return None;
            }
            let id = file.strip_suffix(".webm")?;
            crate::ids::is_ulid(id).then(|| MediaRoute::Recording {
                recording_id: id.to_string(),
            })
        }
        "res" => {
            let name = parts.next()?;
            (name == "selftest.webm" && parts.next().is_none()).then_some(MediaRoute::SelfTest)
        }
        _ => None,
    }
}

/// The file behind a class route: confined through `ClassFs` (registered class, class path
/// rules, no symlink on any component). `Err(403)` for a symlink, `Err(404)` otherwise.
pub fn resolve_class(fs: &ClassFs, class_id: &str, path: &str) -> Result<PathBuf, u16> {
    let entry = fs.registry().get(class_id).ok_or(404u16)?;
    if !entry.path.is_dir() {
        return Err(404);
    }
    match crate::confine::confine(&entry.path, path) {
        Ok(p) => Ok(p),
        Err(e) if e.code() == Code::SymlinkRefused => Err(403),
        Err(_) => Err(404),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_of(n: usize) -> (tempfile::TempDir, PathBuf, Vec<u8>) {
        let dir = tempfile::tempdir().unwrap();
        let bytes: Vec<u8> = (0..n).map(|i| (i % 251) as u8).collect();
        let p = dir.path().join("Aula 1.webm");
        fs::write(&p, &bytes).unwrap();
        (dir, p, bytes)
    }

    #[test]
    fn range_200() {
        let (_d, p, bytes) = file_of(1000);
        let r = serve(&p, "audio/webm", None, None);
        assert_eq!(r.status, 200);
        assert_eq!(r.body, bytes);
        assert_eq!(r.header("content-length"), Some("1000"));
        assert_eq!(r.header("accept-ranges"), Some("bytes"));
        assert_eq!(r.header("content-type"), Some("audio/webm"));
        assert_eq!(r.header("x-content-type-options"), Some("nosniff"));
        assert_eq!(r.header("cache-control"), Some("no-store"));
        let head = serve_request(MediaMethod::Head, &p, "audio/webm", None, None);
        assert_eq!((head.status, head.body.len()), (200, 0));
        assert_eq!(head.header("content-length"), Some("1000"));
    }

    #[test]
    fn range_206() {
        let (_d, p, bytes) = file_of(1000);
        let r = serve(&p, "audio/webm", Some("bytes=10-19"), None);
        assert_eq!(r.status, 206);
        assert_eq!(r.body, &bytes[10..20]);
        assert_eq!(r.header("content-range"), Some("bytes 10-19/1000"));
        assert_eq!(r.header("content-length"), Some("10"));
        // Open-ended and suffix ranges.
        let r = serve(&p, "audio/webm", Some("bytes=990-"), None);
        assert_eq!(r.body, &bytes[990..]);
        assert_eq!(r.header("content-range"), Some("bytes 990-999/1000"));
        let r = serve(&p, "audio/webm", Some("bytes=-5"), None);
        assert_eq!(r.body, &bytes[995..]);
        // An end past the file is cut to the file.
        let r = serve(&p, "audio/webm", Some("bytes=995-5000"), None);
        assert_eq!(r.header("content-range"), Some("bytes 995-999/1000"));
        // Several ranges: the first one only.
        let r = serve(&p, "audio/webm", Some("bytes=0-1, 5-6"), None);
        assert_eq!((r.status, r.body.as_slice()), (206, &bytes[0..2]));
        // An open-ended range on a large file is capped.
        let (_d2, big, _) = file_of((OPEN_RANGE_MAX + 10) as usize);
        let r = serve(&big, "audio/webm", Some("bytes=0-"), None);
        assert_eq!(r.body.len() as u64, OPEN_RANGE_MAX);
        assert_eq!(
            r.header("content-range"),
            Some(format!("bytes 0-{}/{}", OPEN_RANGE_MAX - 1, OPEN_RANGE_MAX + 10).as_str())
        );
    }

    #[test]
    fn range_416() {
        let (_d, p, _) = file_of(1000);
        for bad in ["bytes=1000-", "bytes=2000-3000", "bytes=abc", "items=0-1"] {
            let r = serve(&p, "audio/webm", Some(bad), None);
            assert_eq!(r.status, 416, "{bad}");
            assert_eq!(r.header("content-range"), Some("bytes */1000"), "{bad}");
            assert!(r.body.is_empty());
        }
        let (_d, empty, _) = file_of(0);
        assert_eq!(
            serve(&empty, "audio/webm", Some("bytes=0-"), None).status,
            416
        );
        assert_eq!(serve(&empty, "audio/webm", None, None).status, 200);
    }

    #[test]
    fn cors_origin_echo() {
        let (_d, p, _) = file_of(10);
        for o in ALLOWED_ORIGINS {
            let r = serve(&p, "audio/webm", None, Some(o));
            assert_eq!(r.header("access-control-allow-origin"), Some(o));
            assert_eq!(
                r.header("access-control-expose-headers"),
                Some("Content-Range, Accept-Ranges, Content-Length")
            );
        }
        for o in [
            "https://evil.example",
            "tauri://localhost.evil",
            "null",
            "http://localhost:1420",
        ] {
            let r = serve(&p, "audio/webm", None, Some(o));
            assert_eq!(r.header("access-control-allow-origin"), None, "{o}");
        }
        let pre = options(Some("tauri://localhost"));
        assert_eq!(pre.status, 204);
        assert_eq!(
            pre.header("access-control-allow-origin"),
            Some("tauri://localhost")
        );
        assert_eq!(pre.header("access-control-allow-headers"), Some("Range"));
        assert_eq!(
            options(Some("https://x.example")).header("access-control-allow-origin"),
            None
        );
        assert_eq!(
            status_only(404, Some("http://tauri.localhost")).header("access-control-allow-origin"),
            Some("http://tauri.localhost")
        );
    }

    #[test]
    fn mime_by_extension() {
        for (name, mime) in [
            ("a.webm", "audio/webm"),
            ("A.WEBM", "audio/webm"),
            ("a.ogg", "audio/ogg"),
            ("a.oga", "audio/ogg"),
            ("a.opus", "audio/ogg"),
            ("a.mp3", "audio/mpeg"),
            ("a.m4a", "audio/mp4"),
            ("a.wav", "audio/wav"),
            ("a.flac", "audio/flac"),
            ("a.mp4", "video/mp4"),
            ("Código Civil.pdf", "application/pdf"),
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.jpeg", "image/jpeg"),
            ("a.gif", "image/gif"),
            ("a.webp", "image/webp"),
            ("a.svg", "image/svg+xml"),
            ("a.md", "text/plain; charset=utf-8"),
            ("a.txt", "text/plain; charset=utf-8"),
            ("transcript.vtt", "text/plain; charset=utf-8"),
            ("a.html", "application/octet-stream"),
            ("noext", "application/octet-stream"),
        ] {
            assert_eq!(mime_for(name), mime, "{name}");
        }
        let dir = tempfile::tempdir().unwrap();
        let svg = dir.path().join("a.svg");
        fs::write(&svg, "<svg/>").unwrap();
        let r = serve(&svg, mime_for("a.svg"), None, None);
        assert_eq!(
            r.header("content-security-policy"),
            Some("default-src 'none'; style-src 'unsafe-inline'")
        );
        let html = dir.path().join("a.html");
        fs::write(&html, "<script>alert(1)</script>").unwrap();
        let r = serve(&html, mime_for("a.html"), None, None);
        assert_eq!(r.header("content-type"), Some("application/octet-stream"));
        assert_eq!(r.header("content-disposition"), Some("attachment"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_refused() {
        use crate::paths::Paths;
        use crate::registry::{ClassEntry, ClassRegistry};
        use std::sync::Arc;
        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join("id_rsa");
        fs::write(&secret, b"secret").unwrap();
        let link = dir.path().join("link.webm");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        assert_eq!(serve(&link, "audio/webm", None, None).status, 403);
        assert_eq!(
            serve(&dir.path().join("none.webm"), "audio/webm", None, None).status,
            404
        );
        assert_eq!(serve(dir.path(), "audio/webm", None, None).status, 404);
        // Through a class: a planted link anywhere on the path is refused.
        const CLASS: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
        let paths = Arc::new(Paths::for_tests(dir.path()));
        let reg = Arc::new(ClassRegistry::load(&paths.config).unwrap());
        let root = dir.path().join("classes").join("Direito");
        fs::create_dir_all(root.join("Aulas")).unwrap();
        fs::write(root.join("Aulas/ok.webm"), b"ok").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("Aulas/notes.webm")).unwrap();
        std::os::unix::fs::symlink(dir.path(), root.join("Escape")).unwrap();
        reg.insert(ClassEntry::new(CLASS, root.clone())).unwrap();
        let cfs = ClassFs::new(paths, reg);
        assert_eq!(
            resolve_class(&cfs, CLASS, "Aulas/ok.webm").unwrap(),
            root.join("Aulas").join("ok.webm")
        );
        assert_eq!(resolve_class(&cfs, CLASS, "Aulas/notes.webm"), Err(403));
        assert_eq!(resolve_class(&cfs, CLASS, "Escape/id_rsa"), Err(403));
        assert_eq!(resolve_class(&cfs, CLASS, "../id_rsa"), Err(404));
        assert_eq!(
            resolve_class(&cfs, "tramado-bbbbbbbbbbbbbbbbbbbbbbbbbb", "Aulas/ok.webm"),
            Err(404)
        );
    }

    #[test]
    fn routes() {
        let c = "tramado-mde5jfv46prdf2fjxvmbjr4242";
        assert_eq!(
            route(&format!(
                "/c/{c}/Aulas/2026-10-14%201015%20Aula%206/audio.webm"
            )),
            Some(MediaRoute::Class {
                class_id: c.into(),
                path: "Aulas/2026-10-14 1015 Aula 6/audio.webm".into()
            })
        );
        assert_eq!(
            route(&format!("/c/{c}/Docs/C%C3%B3digo%20Civil.pdf")),
            Some(MediaRoute::Class {
                class_id: c.into(),
                path: "Docs/Código Civil.pdf".into()
            })
        );
        assert_eq!(
            route("/r/01JBX4Q7Z5W8M2E3C9R6T0YH2K.webm"),
            Some(MediaRoute::Recording {
                recording_id: "01JBX4Q7Z5W8M2E3C9R6T0YH2K".into()
            })
        );
        assert_eq!(route("/res/selftest.webm"), Some(MediaRoute::SelfTest));
        for bad in [
            "/",
            "/c/",
            &format!("/c/{c}"),
            &format!("/c/{c}/"),
            &format!("/c/{c}/a%2Fb"),
            "/c/not-a-class/a.webm",
            "/r/../x.webm",
            "/r/01JBX4Q7Z5W8M2E3C9R6T0YH2K.wav",
            "/r/01JBX4Q7Z5W8M2E3C9R6T0YH2K.webm/x",
            "/res/other.webm",
            "/x/y",
            "c/x",
        ] {
            assert_eq!(route(bad), None, "{bad}");
        }
    }
}
