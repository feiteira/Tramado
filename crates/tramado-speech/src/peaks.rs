// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Waveform peaks for the lecture timeline (D-9): the recording is decoded once (mixed to one
//! track), each bucket keeps its loudest sample, and the result is scaled so the loudest bucket
//! is 255. Cached in `cache/peaks/<sha256>-<buckets>.json` (the audio never changes once
//! published, folder spec §8.7).

use std::path::{Path, PathBuf};

use symphonia::core::io::MediaSource;
use tramado_base::error::{AppError, AppResult};
use tramado_base::files;

use crate::decode::{self, Channels};

pub const MIN_BUCKETS: u32 = 100;
pub const MAX_BUCKETS: u32 = 4000;
/// Peaks are first kept per 10 ms block (a 3-hour lecture: about 4 MB).
const BLOCK: usize = 160;

pub fn cache_path(cache_dir: &Path, sha256: &str, buckets: u32) -> PathBuf {
    cache_dir
        .join("peaks")
        .join(format!("{sha256}-{buckets}.json"))
}

pub fn check_buckets(buckets: u32) -> AppResult<()> {
    if (MIN_BUCKETS..=MAX_BUCKETS).contains(&buckets) {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "buckets must be {MIN_BUCKETS}–{MAX_BUCKETS}"
        )))
    }
}

/// Reduces per-block maxima to exactly `buckets` values, scaled to 0–255.
pub fn bucketize(blocks: &[f32], buckets: u32) -> Vec<u8> {
    let b = buckets as usize;
    if blocks.is_empty() {
        return vec![0; b];
    }
    let n = blocks.len();
    let mut out: Vec<f32> = Vec::with_capacity(b);
    for i in 0..b {
        let lo = i * n / b;
        let hi = ((i + 1) * n / b).max(lo + 1).min(n);
        let lo = lo.min(n - 1);
        out.push(blocks[lo..hi].iter().fold(0.0f32, |m, v| m.max(*v)));
    }
    let max = out.iter().fold(0.0f32, |m, v| m.max(*v));
    if max <= 0.0 {
        return vec![0; b];
    }
    out.iter()
        .map(|v| ((v / max) * 255.0).round().clamp(0.0, 255.0) as u8)
        .collect()
}

/// Decodes `source` and returns `buckets` peaks.
pub fn compute(
    source: Box<dyn MediaSource>,
    ext: Option<&str>,
    buckets: u32,
    stop: &dyn Fn() -> bool,
) -> AppResult<Vec<u8>> {
    check_buckets(buckets)?;
    let mut blocks: Vec<f32> = Vec::new();
    let mut cur = 0.0f32;
    let mut in_block = 0usize;
    decode::decode_stream(source, ext, Channels::Mix, stop, &mut |chunk| {
        for v in &chunk[0] {
            cur = cur.max(v.abs());
            in_block += 1;
            if in_block == BLOCK {
                blocks.push(cur);
                cur = 0.0;
                in_block = 0;
            }
        }
        Ok(())
    })?;
    if in_block > 0 {
        blocks.push(cur);
    }
    Ok(bucketize(&blocks, buckets))
}

/// `cache/peaks/<sha256>-<buckets>.json` (architecture §13.1).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct PeaksFile {
    format: String,
    version: u32,
    buckets: Vec<u8>,
}

const FORMAT: &str = "tramado.peaks";

/// The cached peaks, if any.
pub fn read_cached(path: &Path) -> Option<Vec<u8>> {
    let b = files::read_optional(path).ok()??;
    let f: PeaksFile = serde_json::from_slice(&b).ok()?;
    (f.format == FORMAT && f.version == 1).then_some(f.buckets)
}

pub fn write_cached(path: &Path, peaks: &[u8]) -> AppResult<()> {
    let f = PeaksFile {
        format: FORMAT.into(),
        version: 1,
        buckets: peaks.to_vec(),
    };
    files::write_atomic(path, &serde_json::to_vec(&f)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peaks_bucket_count() {
        // 3 s: silence, a loud second, a quiet second.
        let mut pcm = vec![0.0f32; 48_000];
        for (i, v) in pcm[16_000..32_000].iter_mut().enumerate() {
            *v = (i as f32 * 0.1).sin() * 0.8;
        }
        for (i, v) in pcm[32_000..].iter_mut().enumerate() {
            *v = (i as f32 * 0.1).sin() * 0.2;
        }
        let webm = crate::webm::encode_pcm(&pcm, 1, 24_000).unwrap();
        for buckets in [100, 333, 4000] {
            let p = compute(
                decode::bytes_source(webm.clone()),
                Some("webm"),
                buckets,
                &|| false,
            )
            .unwrap();
            assert_eq!(p.len(), buckets as usize);
            let third = buckets as usize / 3;
            let quiet = p[..third - 2].iter().copied().max().unwrap();
            let loud = p[third + 2..2 * third - 2].iter().copied().max().unwrap();
            let soft = p[2 * third + 2..].iter().copied().max().unwrap();
            assert!(quiet < 20, "{quiet}");
            assert!(loud > 200, "{loud}");
            assert!(soft > 40 && soft < 120, "{soft}");
        }
        assert!(check_buckets(99).is_err() && check_buckets(4001).is_err());
        assert_eq!(bucketize(&[], 100), vec![0; 100]);
        assert_eq!(bucketize(&[0.5], 100).len(), 100);
    }

    #[test]
    fn caches_by_hash_and_bucket_count() {
        let dir = tempfile::tempdir().unwrap();
        let p = cache_path(dir.path(), &"a".repeat(64), 200);
        assert!(p.ends_with(format!("peaks/{}-200.json", "a".repeat(64))));
        assert_eq!(read_cached(&p), None);
        write_cached(&p, &[1, 2, 255]).unwrap();
        assert_eq!(read_cached(&p), Some(vec![1, 2, 255]));
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"format": "tramado.peaks", "version": 1, "buckets": [1, 2, 255]})
        );
    }
}
