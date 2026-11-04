// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/mod.rs `cpu_supported`), MPL-2.0, same author.

//! Whether this processor can run the speech engine as built: whisper.cpp is compiled with
//! `GGML_NATIVE=OFF` and AVX/AVX2/FMA/F16C on (`.cargo/config.toml`), so an x86-64 processor
//! without them would stop with an illegal instruction. The UI offers cloud transcription or a
//! classmate's claim instead (`SPEECH_UNSUPPORTED_CPU`).

/// x86-64: AVX2, FMA and F16C; aarch64: always; anything else: no.
pub fn cpu_supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::arch::is_x86_feature_detected!("avx2")
            && std::arch::is_x86_feature_detected!("fma")
            && std::arch::is_x86_feature_detected!("f16c")
    }
    #[cfg(target_arch = "aarch64")]
    {
        true
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        false
    }
}

/// Threads for whisper.cpp: all processors but two (one on small machines, at most eight), so
/// the student can go on working while a lecture is transcribed.
pub fn whisper_threads() -> i32 {
    let n = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    let keep = if n > 4 { 2 } else { 1 };
    n.saturating_sub(keep).clamp(1, 8) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_leave_room_for_the_student() {
        let t = whisper_threads();
        assert!((1..=8).contains(&t));
        // The answer is stable (it is asked once per job).
        assert_eq!(t, whisper_threads());
        let _ = cpu_supported();
    }
}
