// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/service/mod.rs `mock`), MPL-2.0, same author.

//! `MockServer`: a tiny HTTP/1.1 server on 127.0.0.1 for tests (AI pipe, model downloads,
//! Syncthing REST client). It answers each request with the next canned response (or a handler),
//! records the request line, headers and body, and can stream a chunked body with delays between
//! chunks (SSE). Available to other crates' tests through the `testutil` feature.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// One request as the server received it.
#[derive(Debug, Clone, Default)]
pub struct Seen {
    pub method: String,
    /// Path and query, as sent (`/api/v1/chat/completions`).
    pub path: String,
    /// The request line (`POST /api/v1/chat/completions HTTP/1.1`).
    pub line: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// The body as JSON (`Null` when it is not JSON).
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or(serde_json::Value::Null)
    }
}

#[derive(Debug, Clone)]
pub enum MockBody {
    /// Sent with `Content-Length`.
    Full(Vec<u8>),
    /// Sent with `Transfer-Encoding: chunked`; each chunk after its delay.
    Chunks(Vec<(Duration, Vec<u8>)>),
}

#[derive(Debug, Clone)]
pub struct MockResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: MockBody,
    /// Wait this long before sending anything (timeouts).
    pub delay: Duration,
}

impl MockResponse {
    pub fn bytes(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        MockResponse {
            status,
            headers: vec![("Content-Type".into(), content_type.into())],
            body: MockBody::Full(body.into()),
            delay: Duration::ZERO,
        }
    }

    pub fn json(status: u16, body: impl Into<String>) -> Self {
        Self::bytes(status, "application/json", body.into().into_bytes())
    }

    pub fn text(status: u16, body: impl Into<String>) -> Self {
        Self::bytes(
            status,
            "text/plain; charset=utf-8",
            body.into().into_bytes(),
        )
    }

    /// A `text/event-stream` body: each item is sent as one chunk after its delay.
    pub fn sse(chunks: Vec<(Duration, String)>) -> Self {
        MockResponse {
            status: 200,
            headers: vec![("Content-Type".into(), "text/event-stream".into())],
            body: MockBody::Chunks(
                chunks
                    .into_iter()
                    .map(|(d, s)| (d, s.into_bytes()))
                    .collect(),
            ),
            delay: Duration::ZERO,
        }
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn delayed(mut self, d: Duration) -> Self {
        self.delay = d;
        self
    }
}

type Handler = Arc<dyn Fn(&Seen) -> MockResponse + Send + Sync>;

pub struct MockServer {
    addr: SocketAddr,
    seen: Arc<(Mutex<Vec<Seen>>, Condvar)>,
    stop: Arc<AtomicBool>,
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        206 => "Partial Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        402 => "Payment Required",
        403 => "Forbidden",
        404 => "Not Found",
        416 => "Range Not Satisfiable",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Status",
    }
}

fn read_request(stream: &TcpStream) -> std::io::Result<Option<Seen>> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let line = line.trim_end().to_string();
    let mut parts = line.split(' ');
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = Vec::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h)? == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    let get = |name: &str| {
        headers
            .iter()
            .find(|(k, _): &&(String, String)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.clone())
    };
    let mut body = Vec::new();
    if get("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked")) {
        loop {
            let mut size = String::new();
            reader.read_line(&mut size)?;
            let n = usize::from_str_radix(size.trim().split(';').next().unwrap_or("0"), 16)
                .unwrap_or(0);
            if n == 0 {
                let mut end = String::new();
                reader.read_line(&mut end)?;
                break;
            }
            let mut chunk = vec![0; n];
            reader.read_exact(&mut chunk)?;
            body.extend_from_slice(&chunk);
            let mut crlf = [0u8; 2];
            reader.read_exact(&mut crlf)?;
        }
    } else if let Some(len) = get("content-length").and_then(|v| v.parse::<usize>().ok()) {
        body = vec![0; len];
        reader.read_exact(&mut body)?;
    }
    Ok(Some(Seen {
        method,
        path,
        line,
        headers,
        body,
    }))
}

fn write_response(
    mut stream: &TcpStream,
    r: &MockResponse,
    head_only: bool,
) -> std::io::Result<()> {
    if !r.delay.is_zero() {
        std::thread::sleep(r.delay);
    }
    let mut head = format!("HTTP/1.1 {} {}\r\n", r.status, reason(r.status));
    for (k, v) in &r.headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("Connection: close\r\n");
    match &r.body {
        MockBody::Full(b) => {
            if !r
                .headers
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case("content-length"))
            {
                head.push_str(&format!("Content-Length: {}\r\n", b.len()));
            }
            head.push_str("\r\n");
            stream.write_all(head.as_bytes())?;
            if !head_only {
                stream.write_all(b)?;
            }
        }
        MockBody::Chunks(chunks) => {
            head.push_str("Transfer-Encoding: chunked\r\n\r\n");
            stream.write_all(head.as_bytes())?;
            stream.flush()?;
            for (delay, c) in chunks {
                if !delay.is_zero() {
                    std::thread::sleep(*delay);
                }
                if c.is_empty() {
                    continue;
                }
                stream.write_all(format!("{:x}\r\n", c.len()).as_bytes())?;
                stream.write_all(c)?;
                stream.write_all(b"\r\n")?;
                stream.flush()?;
            }
            stream.write_all(b"0\r\n\r\n")?;
        }
    }
    stream.flush()
}

impl MockServer {
    /// Answers requests with `responses` in order; once they run out, with 500.
    pub fn start(responses: Vec<MockResponse>) -> Self {
        let queue = Arc::new(Mutex::new(std::collections::VecDeque::from(responses)));
        Self::with_handler(move |_| {
            queue
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .pop_front()
                .unwrap_or_else(|| MockResponse::text(500, "no more canned responses"))
        })
    }

    /// Answers every request with `handler(request)`.
    pub fn with_handler(handler: impl Fn(&Seen) -> MockResponse + Send + Sync + 'static) -> Self {
        let listener = match TcpListener::bind("127.0.0.1:0") {
            Ok(l) => l,
            Err(e) => panic!("MockServer cannot listen on loopback: {e}"),
        };
        let addr = match listener.local_addr() {
            Ok(a) => a,
            Err(e) => panic!("MockServer has no address: {e}"),
        };
        let seen: Arc<(Mutex<Vec<Seen>>, Condvar)> =
            Arc::new((Mutex::new(Vec::new()), Condvar::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let handler: Handler = Arc::new(handler);
        let (log, stopping) = (seen.clone(), stop.clone());
        let spawned = std::thread::Builder::new()
            .name("tramado-mock-accept".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    if stopping.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = stream else { continue };
                    let (log, handler) = (log.clone(), handler.clone());
                    let _ = std::thread::Builder::new()
                        .name("tramado-mock-conn".into())
                        .spawn(move || {
                            let Ok(Some(req)) = read_request(&stream) else {
                                return;
                            };
                            let response = handler(&req);
                            let head_only = req.method == "HEAD";
                            {
                                let (lock, cv) = &*log;
                                lock.lock().unwrap_or_else(|e| e.into_inner()).push(req);
                                cv.notify_all();
                            }
                            let _ = write_response(&stream, &response, head_only);
                            let _ = stream.shutdown(std::net::Shutdown::Both);
                        });
                }
            });
        if let Err(e) = spawned {
            panic!("MockServer cannot start its thread: {e}");
        }
        MockServer { addr, seen, stop }
    }

    /// `http://127.0.0.1:<port>`
    pub fn base(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// `base()` + `path` (`path` starts with `/`).
    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base(), path)
    }

    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// The requests received so far, in order.
    pub fn seen(&self) -> Vec<Seen> {
        self.seen
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Waits until at least `n` requests arrived; false on timeout.
    pub fn wait_for(&self, n: usize, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let (lock, cv) = &*self.seen;
        let mut seen = lock.lock().unwrap_or_else(|e| e.into_inner());
        while seen.len() < n {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            seen = match cv.wait_timeout(seen, deadline - now) {
                Ok((g, _)) => g,
                Err(e) => e.into_inner().0,
            };
        }
        true
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wakes the accept loop so it sees the flag.
        let _ = TcpStream::connect_timeout(&self.addr, Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_requests_and_streams_chunks() {
        let m = MockServer::start(vec![
            MockResponse::json(201, r#"{"a":1}"#).header("Retry-After", "3"),
            MockResponse::sse(vec![
                (Duration::ZERO, ": OPENROUTER PROCESSING\n\n".into()),
                (Duration::from_millis(30), "data: {\"x\":1}\n\n".into()),
                (Duration::from_millis(30), "data: [DONE]\n\n".into()),
            ]),
        ]);
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .into();
        let mut r = agent
            .post(m.url("/v1/chat"))
            .header("Authorization", "Bearer sk-test")
            .send_json(serde_json::json!({"q": "olá"}))
            .unwrap();
        assert_eq!(r.status().as_u16(), 201);
        assert_eq!(
            r.headers().get("retry-after").and_then(|v| v.to_str().ok()),
            Some("3")
        );
        assert_eq!(r.body_mut().read_to_string().unwrap(), r#"{"a":1}"#);
        let mut r = agent.get(m.url("/v1/stream?x=1")).call().unwrap();
        let text = r.body_mut().read_to_string().unwrap();
        assert_eq!(
            text,
            ": OPENROUTER PROCESSING\n\ndata: {\"x\":1}\n\ndata: [DONE]\n\n"
        );
        assert!(m.wait_for(2, Duration::from_secs(2)));
        let seen = m.seen();
        assert_eq!(seen[0].line, "POST /v1/chat HTTP/1.1");
        assert_eq!(seen[0].header("authorization"), Some("Bearer sk-test"));
        assert_eq!(seen[0].json()["q"], "olá");
        assert_eq!(seen[1].method, "GET");
        assert_eq!(seen[1].path, "/v1/stream?x=1");
        // Out of canned responses: 500.
        let r = agent.get(m.url("/more")).call().unwrap();
        assert_eq!(r.status().as_u16(), 500);
    }

    #[test]
    fn handler_answers_by_request() {
        let m = MockServer::with_handler(|req| match req.header("range") {
            Some(r) => MockResponse::bytes(206, "application/octet-stream", r.as_bytes().to_vec()),
            None => MockResponse::bytes(200, "application/octet-stream", b"all".to_vec()),
        });
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .into();
        let mut r = agent
            .get(m.url("/f"))
            .header("Range", "bytes=1-2")
            .call()
            .unwrap();
        assert_eq!(r.status().as_u16(), 206);
        assert_eq!(r.body_mut().read_to_string().unwrap(), "bytes=1-2");
        let mut r = agent.get(m.url("/f")).call().unwrap();
        assert_eq!(r.body_mut().read_to_string().unwrap(), "all");
    }
}
