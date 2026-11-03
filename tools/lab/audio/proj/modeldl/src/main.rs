//! Throwaway lab: resumable, verified download of a whisper.cpp model from Hugging Face.
//!   modeldl NAME SIZE SHA256 DIR [--stop-after-bytes N]
//! The URL is pinned to a repository commit, so the bytes behind a name never change.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

const REPO: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1";
/// One request per 32 MiB: each one gets a fresh signed CDN URL (they expire), and a stalled
/// connection costs at most one chunk.
const CHUNK: u64 = 32 * 1024 * 1024;
const RETRIES: u32 = 5;

#[derive(Debug)]
enum DlError {
    Cancelled,
    Http(String),
    Io(std::io::Error),
    Integrity(String),
}
impl From<std::io::Error> for DlError {
    fn from(e: std::io::Error) -> Self {
        DlError::Io(e)
    }
}

pub struct ModelFile<'a> {
    name: &'a str,
    size: u64,
    sha256: &'a str,
}

#[derive(Clone, Copy)]
pub struct Progress {
    done: u64,
    total: u64,
    bytes_per_sec: f64,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        // A stall, not a slow line: no single read may wait longer than this.
        .timeout_per_read(Some(Duration::from_secs(30)))
        .user_agent("Tramado-lab/0.0 (model download)")
        .build()
        .into()
}

/// Hashes what an earlier attempt left, so the final check covers the whole file.
fn hash_existing(part: &Path, have: u64) -> Result<Sha256, DlError> {
    let mut h = Sha256::new();
    let mut f = File::open(part)?;
    let mut buf = vec![0u8; 1 << 20];
    let mut left = have;
    while left > 0 {
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

fn fetch(
    f: &ModelFile,
    dir: &Path,
    cancel: &AtomicBool,
    stop_after: Option<u64>,
    mut progress: impl FnMut(Progress),
) -> Result<PathBuf, DlError> {
    fs::create_dir_all(dir)?;
    let dest = dir.join(f.name);
    if fs::metadata(&dest).is_ok_and(|m| m.len() == f.size) {
        return Ok(dest); // verified when it was renamed into place
    }
    let part = dir.join(format!("{}.part", f.name));
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > f.size {
        have = 0;
    }
    let mut file = OpenOptions::new().create(true).write(true).truncate(false).open(&part)?;
    file.set_len(have)?; // drop a torn tail beyond what we count
    file.seek(SeekFrom::Start(have))?;
    let t = Instant::now();
    let mut hasher = hash_existing(&part, have)?;
    if have > 0 {
        println!("resuming at {have} B (re-hashed in {:.2} s)", t.elapsed().as_secs_f64());
    }
    let agent = agent();
    let url = format!("{REPO}/{}", f.name);
    let started = Instant::now();
    let start_have = have;
    let mut last_report = Instant::now();
    let mut buf = vec![0u8; 256 * 1024];
    let mut failures = 0;
    while have < f.size {
        if cancel.load(Ordering::Relaxed) {
            return Err(DlError::Cancelled);
        }
        let end = (have + CHUNK).min(f.size) - 1;
        let res = agent.get(&url).header("Range", &format!("bytes={have}-{end}")).call();
        let mut res = match res {
            Ok(r) => r,
            Err(e) => {
                failures += 1;
                if failures > RETRIES {
                    return Err(DlError::Http(e.to_string()));
                }
                std::thread::sleep(Duration::from_secs(1 << failures));
                continue;
            }
        };
        match res.status().as_u16() {
            206 => {
                let cr = res.headers().get("content-range").and_then(|v| v.to_str().ok()).unwrap_or("");
                if !cr.starts_with(&format!("bytes {have}-")) {
                    return Err(DlError::Http(format!("unexpected Content-Range {cr:?}")));
                }
            }
            // The server ignored Range: only usable from the very start.
            200 if have == 0 => {}
            s => return Err(DlError::Http(format!("HTTP {s}"))),
        }
        let mut body = res.body_mut().as_reader();
        let mut got_this = 0u64;
        let want = end + 1 - have;
        let outcome: Result<(), DlError> = loop {
            if cancel.load(Ordering::Relaxed) {
                break Err(DlError::Cancelled);
            }
            let n = match body.read(&mut buf) {
                Ok(0) => break Ok(()),
                Ok(n) => n,
                Err(e) => break Err(DlError::Io(e)),
            };
            let n = (n as u64).min(f.size - have) as usize;
            file.write_all(&buf[..n])?;
            hasher.update(&buf[..n]);
            have += n as u64;
            got_this += n as u64;
            if stop_after.is_some_and(|s| have - start_have >= s) {
                // Simulates the app being killed: whatever was written stays in the .part file.
                file.flush()?;
                println!("simulated crash at {have} B");
                std::process::exit(3);
            }
            if last_report.elapsed() > Duration::from_millis(250) {
                last_report = Instant::now();
                let secs = started.elapsed().as_secs_f64().max(0.001);
                progress(Progress { done: have, total: f.size, bytes_per_sec: (have - start_have) as f64 / secs });
            }
            if got_this >= want {
                break Ok(());
            }
        };
        match outcome {
            Ok(()) => failures = 0,
            Err(DlError::Cancelled) => {
                file.flush()?;
                return Err(DlError::Cancelled); // the .part stays for next time
            }
            Err(e) => {
                failures += 1;
                eprintln!("chunk failed ({e:?}); retry {failures}");
                if failures > RETRIES {
                    return Err(e);
                }
            }
        }
    }
    file.flush()?;
    file.sync_all()?;
    drop(file);
    let digest = hex::encode(hasher.finalize());
    if have != f.size || digest != f.sha256 {
        let _ = fs::remove_file(&part);
        return Err(DlError::Integrity(format!("size {have} sha256 {digest}")));
    }
    fs::rename(&part, &dest)?;
    let secs = started.elapsed().as_secs_f64();
    println!(
        "done: {} B in {secs:.1} s ({:.1} MB/s), sha256 ok",
        have - start_have,
        (have - start_have) as f64 / secs / 1e6
    );
    Ok(dest)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let f = ModelFile { name: &a[1], size: a[2].parse().unwrap(), sha256: &a[3] };
    let dir = PathBuf::from(&a[4]);
    let stop_after = a.iter().position(|x| x == "--stop-after-bytes").map(|i| a[i + 1].parse().unwrap());
    let cancel = AtomicBool::new(false);
    let mut shown = 0;
    let r = fetch(&f, &dir, &cancel, stop_after, |p| {
        let pct = p.done * 100 / p.total;
        if pct / 10 != shown {
            shown = pct / 10;
            println!("  {pct}% ({:.1} MB/s)", p.bytes_per_sec / 1e6);
        }
    });
    match r {
        Ok(p) => println!("ok {}", p.display()),
        Err(e) => {
            eprintln!("error: {e:?}");
            std::process::exit(1)
        }
    }
}
