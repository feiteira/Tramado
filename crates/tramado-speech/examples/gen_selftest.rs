// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Writes `desktop/src-tauri/resources/media/selftest.webm`: 300 s of a synthetic, speech-like
//! signal (voiced "syllables" and pauses, with a click every 10 s so a seek can be checked by
//! ear), encoded and muxed exactly as a recording is (Opus 24 kbps mono, 60 ms packets, our
//! WebM writer). The media self-test (architecture §8) plays it, seeks to 252 s and checks the
//! position and the 300 s duration. Deterministic: the same bytes every run.
//!
//!   cargo run -p tramado-speech --example gen_selftest [-- <out.webm>]

use std::f32::consts::PI;
use std::path::PathBuf;

const RATE: usize = 16_000;
const SECS: usize = 300;

fn signal() -> Vec<f32> {
    let n = SECS * RATE;
    let mut seed = 0x5eed_u32;
    let mut rnd = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f32 / u32::MAX as f32
    };
    let mut out = Vec::with_capacity(n);
    while out.len() < n {
        let word = (2_400.0 + rnd() * 4_800.0) as usize;
        let pause = (800.0 + rnd() * 6_400.0) as usize;
        let f0 = 100.0 + rnd() * 140.0;
        for k in 0..word {
            let t = k as f32 / RATE as f32;
            let env = (PI * k as f32 / word as f32).sin();
            let glide = 1.0 + 0.08 * (PI * k as f32 / word as f32).cos();
            let v: f32 = (1..=5)
                .map(|h| (2.0 * PI * f0 * glide * h as f32 * t).sin() / h as f32)
                .sum();
            out.push(0.22 * env * v);
        }
        out.extend(std::iter::repeat_n(0.0, pause));
    }
    out.truncate(n);
    // A short click every 10 s (at 0 s, 10 s, …, 290 s).
    for s in (0..SECS).step_by(10) {
        let at = s * RATE;
        for k in 0..160 {
            out[at + k] += 0.5 * (2.0 * PI * 1_000.0 * k as f32 / RATE as f32).sin();
        }
    }
    out
}

fn main() {
    let out = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../desktop/src-tauri/resources/media/selftest.webm")
        });
    let pcm = signal();
    let webm = match tramado_speech::webm::encode_pcm(&pcm, 1, 24_000) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("gen_selftest: {e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = std::fs::write(&out, &webm) {
        eprintln!("gen_selftest: {}: {e}", out.display());
        std::process::exit(1);
    }
    println!(
        "gen_selftest: {} ({} bytes, {} s)",
        out.display(),
        webm.len(),
        SECS
    );
}
