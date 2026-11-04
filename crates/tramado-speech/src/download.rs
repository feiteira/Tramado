// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The resumable, verified model download (audio-pipeline §3.3, critique C12; prototype
//! `tools/lab/audio/proj/modeldl`). Hugging Face answers the pinned URL with a 302 to a
//! **signed, expiring** CDN URL, so every 32 MiB chunk re-requests the huggingface.co URL with a
//! `Range`. The `.part` file always holds a contiguous prefix: a crash, a cancel or a reboot
//! resumes from it, re-hashing what is there so the final SHA-256 covers the whole file. A wrong
//! size or hash deletes the `.part` (`MODEL_INTEGRITY`); the file is renamed into place only
//! when it is right.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::json;
use sha2::{Digest, Sha256};
use tramado_base::error::{AppError, AppResult, Code};

use crate::types::ModelEvent;

/// One request per 32 MiB: each gets a fresh signed CDN URL, and a stalled connection costs at
/// most one chunk.
pub const CHUNK: u64 = 32 * 1024 * 1024;
/// Failed chunks in a row before giving up.
const RETRIES: u32 = 5;
/// Progress events at most this often (≤ 4 Hz).
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// What to fetch, and where to.
#[derive(Debug, Clone)]
pub struct Fetch {
    pub url: String,
    pub file: String,
    pub size: u64,
    pub sha256: String,
    pub dir: PathBuf,
    /// Wait between retries: `backoff × 2^(n−1)` (tests make it short).
    pub backoff: Duration,
}

impl Fetch {
    pub fn dest(&self) -> PathBuf {
        self.dir.join(&self.file)
    }

    pub fn part(&self) -> PathBuf {
        self.dir.join(format!("{}.part", self.file))
    }
}

fn cancelled() -> AppError {
    AppError::new(Code::Cancelled, "download cancelled")
}

fn failed(message: impl Into<String>) -> AppError {
    AppError::new(Code::ModelDownloadFailed, message)
}

/// Hashes the first `have` bytes of the `.part` (about 3 s for the 574 MB default model).
fn hash_prefix(part: &Path, have: u64, cancel: &AtomicBool) -> AppResult<Sha256> {
    let mut h = Sha256::new();
    if have == 0 {
        return Ok(h);
    }
    let mut f = File::open(part)?;
    let mut buf = vec![0u8; 1 << 20];
    let mut left = have;
    while left > 0 {
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled());
        }
        let want = left.min(buf.len() as u64) as usize;
        let n = f.read(&mut buf[..want])?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        left -= n as u64;
    }
    Ok(h)
}

/// Free space for `need` more bytes, with a 5% margin.
pub fn check_space(dir: &Path, need: u64) -> AppResult<()> {
    let need = need + need / 20;
    match fs4::available_space(dir) {
        Ok(free) if free < need => Err(AppError::new(Code::DiskFull, "not enough free space")
            .with_data(json!({ "needBytes": need, "freeBytes": free }))),
        _ => Ok(()),
    }
}

/// Copies a model file the person picked (offline install): hashed while copied, renamed into
/// place only when size and SHA-256 match (`MODEL_INTEGRITY` otherwise).
pub fn import(from: &Path, f: &Fetch) -> AppResult<PathBuf> {
    fs::create_dir_all(&f.dir)?;
    let len = fs::metadata(from)?.len();
    if len != f.size {
        return Err(AppError::new(Code::ModelIntegrity, "not the expected model file")
            .with_data(json!({ "size": len })));
    }
    check_space(&f.dir, f.size)?;
    let part = f.part();
    let mut src = File::open(from)?;
    let mut dst = File::create(&part)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = src.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        dst.write_all(&buf[..n])?;
    }
    dst.sync_all()?;
    drop(dst);
    let digest = tramado_base::ids::hex_lower(&h.finalize());
    if digest != f.sha256 {
        let _ = fs::remove_file(&part);
        return Err(AppError::new(Code::ModelIntegrity, "the model file's SHA-256 differs"));
    }
    fs::rename(&part, f.dest())?;
    Ok(f.dest())
}

/// Downloads `f` into `f.dir`, resuming a `.part`. `events` gets `Started`, `Progress` (≤ 4 Hz)
/// and `Verifying`; the caller sends `Done` / `Failed` / `Cancelled`.
pub fn fetch(
    agent: &ureq::Agent,
    f: &Fetch,
    cancel: &AtomicBool,
    events: &dyn Fn(ModelEvent),
) -> AppResult<PathBuf> {
    fs::create_dir_all(&f.dir)?;
    let dest = f.dest();
    if fs::metadata(&dest).is_ok_and(|m| m.len() == f.size) {
        return Ok(dest);
    }
    let part = f.part();
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > f.size {
        have = 0;
    }
    check_space(&f.dir, f.size - have)?;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&part)?;
    // Drop a torn tail beyond what is counted.
    file.set_len(have)?;
    file.seek(SeekFrom::Start(have))?;
    let mut hasher = hash_prefix(&part, have, cancel)?;
    events(ModelEvent::Started {
        total: f.size,
        resumed_from: have,
    });
    let started = Instant::now();
    let start_have = have;
    let mut last_report = Instant::now();
    let mut buf = vec![0u8; 256 * 1024];
    let mut failures = 0u32;
    while have < f.size {
        if cancel.load(Ordering::Relaxed) {
            file.flush()?;
            return Err(cancelled());
        }
        let end = (have + CHUNK).min(f.size) - 1;
        let res = agent
            .get(&f.url)
            .header("Range", &format!("bytes={have}-{end}"))
            .call();
        let outcome: AppResult<()> = match res {
            Err(e) => Err(failed(e.to_string())),
            Ok(mut res) => {
                let status = res.status().as_u16();
                let ok = match status {
                    206 => {
                        let cr = res
                            .headers()
                            .get("content-range")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("");
                        if cr.starts_with(&format!("bytes {have}-")) {
                            Ok(())
                        } else {
                            return Err(failed(format!("unexpected Content-Range {cr:?}")));
                        }
                    }
                    // The server ignored the Range: the body is the whole file, from the start.
                    200 => {
                        if have > 0 {
                            file.set_len(0)?;
                            file.seek(SeekFrom::Start(0))?;
                            hasher = Sha256::new();
                            have = 0;
                        }
                        Ok(())
                    }
                    s if s >= 500 || s == 429 => Err(failed(format!("HTTP {s}"))),
                    s => return Err(failed(format!("HTTP {s}"))),
                };
                match ok {
                    Err(e) => Err(e),
                    Ok(()) => {
                        let want = if status == 200 { f.size } else { end + 1 - have };
                        let mut got = 0u64;
                        let mut body = res.body_mut().as_reader();
                        let mut read_err: Option<AppError> = None;
                        loop {
                            if cancel.load(Ordering::Relaxed) {
                                file.flush()?;
                                return Err(cancelled());
                            }
                            let n = match body.read(&mut buf) {
                                Ok(0) => break,
                                Ok(n) => n,
                                Err(e) => {
                                    read_err = Some(failed(e.to_string()));
                                    break;
                                }
                            };
                            let n = (n as u64).min(f.size - have) as usize;
                            file.write_all(&buf[..n])?;
                            hasher.update(&buf[..n]);
                            have += n as u64;
                            got += n as u64;
                            if last_report.elapsed() >= PROGRESS_EVERY {
                                last_report = Instant::now();
                                let secs = started.elapsed().as_secs_f64().max(0.001);
                                events(ModelEvent::Progress {
                                    done: have,
                                    total: f.size,
                                    bytes_per_sec: ((have.saturating_sub(start_have)) as f64 / secs)
                                        as u64,
                                });
                            }
                            if got >= want || have >= f.size {
                                break;
                            }
                        }
                        file.flush()?;
                        if let Some(e) = read_err {
                            Err(e)
                        } else if got < want && have < f.size {
                            Err(failed("the connection closed early"))
                        } else {
                            Ok(())
                        }
                    }
                }
            }
        };
        match outcome {
            Ok(()) => failures = 0,
            Err(e) if e.code() == Code::Cancelled => return Err(e),
            Err(e) => {
                failures += 1;
                log::warn!("model download: chunk failed ({e}); retry {failures}");
                if failures > RETRIES {
                    return Err(e);
                }
                let wait = f.backoff * 2u32.pow(failures - 1);
                let until = Instant::now() + wait;
                while Instant::now() < until {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(cancelled());
                    }
                    std::thread::sleep(Duration::from_millis(50).min(wait));
                }
            }
        }
    }
    events(ModelEvent::Verifying);
    file.flush()?;
    file.sync_all()?;
    drop(file);
    let digest = tramado_base::ids::hex_lower(&hasher.finalize());
    if have != f.size || digest != f.sha256 {
        let _ = fs::remove_file(&part);
        return Err(AppError::new(
            Code::ModelIntegrity,
            format!("{}: wrong size or SHA-256", f.file),
        ));
    }
    fs::rename(&part, &dest)?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tramado_net::testutil::{MockResponse, MockServer, Seen};

    fn content(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i * 7 % 251) as u8).collect()
    }

    fn range(seen: &Seen) -> Option<(u64, u64)> {
        let r = seen.header("range")?.strip_prefix("bytes=")?;
        let (a, b) = r.split_once('-')?;
        Some((a.parse().ok()?, b.parse().ok()?))
    }

    /// Serves `data` honouring Range (206), like the Hugging Face CDN.
    fn server(data: Arc<Vec<u8>>, ignore_range: bool) -> MockServer {
        MockServer::with_handler(move |seen| match range(seen) {
            Some((a, b)) if !ignore_range => {
                let b = (b as usize).min(data.len() - 1);
                MockResponse::bytes(206, "application/octet-stream", data[a as usize..=b].to_vec())
                    .header(
                        "Content-Range",
                        &format!("bytes {a}-{b}/{}", data.len()),
                    )
            }
            _ => MockResponse::bytes(200, "application/octet-stream", data.to_vec()),
        })
    }

    fn agent() -> ureq::Agent {
        tramado_net::http::download_agent("test")
    }

    fn spec(url: String, data: &[u8], dir: &Path) -> Fetch {
        Fetch {
            url,
            file: "ggml-test.bin".into(),
            size: data.len() as u64,
            sha256: tramado_base::ids::sha256_hex(data),
            dir: dir.to_path_buf(),
            backoff: Duration::from_millis(1),
        }
    }

    #[test]
    fn download_resume_and_verify() {
        let data = Arc::new(content(3 * 1024 * 1024 + 123));
        let m = server(data.clone(), false);
        let dir = tempfile::tempdir().unwrap();
        let f = spec(m.url("/model.bin"), &data, dir.path());
        // An earlier attempt left a good 1 MiB prefix.
        fs::write(f.part(), &data[..1024 * 1024]).unwrap();
        let events = Mutex::new(Vec::new());
        let p = fetch(&agent(), &f, &AtomicBool::new(false), &|e| {
            events.lock().unwrap().push(e)
        })
        .unwrap();
        assert_eq!(fs::read(&p).unwrap(), *data);
        assert!(!f.part().exists());
        let ev = events.lock().unwrap();
        assert_eq!(
            ev[0],
            ModelEvent::Started {
                total: data.len() as u64,
                resumed_from: 1024 * 1024
            }
        );
        assert_eq!(ev.last(), Some(&ModelEvent::Verifying));
        let first = range(&m.seen()[0]).unwrap();
        assert_eq!(first.0, 1024 * 1024);
        // A finished file is not fetched again.
        let n = m.seen().len();
        fetch(&agent(), &f, &AtomicBool::new(false), &|_| {}).unwrap();
        assert_eq!(m.seen().len(), n);
    }

    #[test]
    fn download_in_chunks_reasks_each_time() {
        let data = Arc::new(content(70 * 1024 * 1024));
        let m = server(data.clone(), false);
        let dir = tempfile::tempdir().unwrap();
        let f = spec(m.url("/model.bin"), &data, dir.path());
        fetch(&agent(), &f, &AtomicBool::new(false), &|_| {}).unwrap();
        let ranges: Vec<_> = m.seen().iter().filter_map(range).collect();
        assert_eq!(
            ranges,
            vec![
                (0, CHUNK - 1),
                (CHUNK, 2 * CHUNK - 1),
                (2 * CHUNK, data.len() as u64 - 1)
            ]
        );
    }

    #[test]
    fn download_wrong_hash_rejected() {
        let data = Arc::new(content(200_000));
        let m = server(data.clone(), false);
        let dir = tempfile::tempdir().unwrap();
        let mut f = spec(m.url("/model.bin"), &data, dir.path());
        f.sha256 = "0".repeat(64);
        let e = fetch(&agent(), &f, &AtomicBool::new(false), &|_| {}).unwrap_err();
        assert_eq!(e.code(), Code::ModelIntegrity);
        assert!(!f.part().exists() && !f.dest().exists());
    }

    #[test]
    fn download_200_restart() {
        // The server ignores Range: what the .part held is replaced by the whole body.
        let data = Arc::new(content(500_000));
        let m = server(data.clone(), true);
        let dir = tempfile::tempdir().unwrap();
        let f = spec(m.url("/model.bin"), &data, dir.path());
        // A .part from another source that does not match: still restarted and verified.
        fs::write(f.part(), vec![0xFFu8; 100_000]).unwrap();
        let p = fetch(&agent(), &f, &AtomicBool::new(false), &|_| {}).unwrap();
        assert_eq!(fs::read(&p).unwrap(), *data);
        assert_eq!(m.seen().len(), 1);
    }

    #[test]
    fn download_gives_up_on_a_missing_file_and_keeps_the_part_on_cancel() {
        let m = MockServer::start(vec![MockResponse::text(404, "Entry not found")]);
        let dir = tempfile::tempdir().unwrap();
        let data = content(1000);
        let f = spec(m.url("/x.bin"), &data, dir.path());
        let e = fetch(&agent(), &f, &AtomicBool::new(false), &|_| {}).unwrap_err();
        assert_eq!(e.code(), Code::ModelDownloadFailed);
        fs::write(f.part(), &data[..10]).unwrap();
        let e = fetch(&agent(), &f, &AtomicBool::new(true), &|_| {}).unwrap_err();
        assert_eq!(e.code(), Code::Cancelled);
        assert_eq!(fs::metadata(f.part()).unwrap().len(), 10);
    }

    #[test]
    fn imports_a_model_file_by_hash() {
        let dir = tempfile::tempdir().unwrap();
        let data = content(4096);
        let src = dir.path().join("usb.bin");
        fs::write(&src, &data).unwrap();
        let f = spec(String::new(), &data, &dir.path().join("models"));
        let p = import(&src, &f).unwrap();
        assert_eq!(fs::read(p).unwrap(), data);
        let mut bad = f.clone();
        bad.file = "other.bin".into();
        bad.sha256 = "1".repeat(64);
        assert_eq!(import(&src, &bad).unwrap_err().code(), Code::ModelIntegrity);
    }
}
