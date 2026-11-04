// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Importing a recording the student already has (critique G23: Zoom/Teams M4A, MP4 video,
//! WhatsApp `.opus`, Telegram `.oga`, MP3, WAV, FLAC): decoded (symphonia, Opus through
//! libopus), mixed to mono and encoded like a room recording (Opus 24 kbps, 60 ms) into WebM,
//! so every lecture in a class plays and transcribes the same way. The original video is not
//! copied unless asked ("Keep the video too?"). HE-AAC is refused with
//! `SPEECH_UNSUPPORTED_AUDIO`; a file that is not media at all with `UNSUPPORTED_FILE`.

use std::path::Path;

use tramado_base::error::AppResult;

use crate::decode::{self, Channels};
use crate::encode::FrameEncoder;
use crate::webm;

/// Imports use the room recording's bitrate.
pub const BITRATE: u32 = 24_000;

/// An imported file, ready to place.
#[derive(Debug, Clone)]
pub struct Imported {
    pub webm: Vec<u8>,
    pub duration_ms: u64,
    pub had_video: bool,
    pub codec: String,
}

/// The MIME type recorded in `lecture.json` `import.mime`, from the file name.
pub fn mime_for(name: &str) -> &'static str {
    let ext = name
        .rsplit('.')
        .next()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/ogg; codecs=opus",
        "webm" => "audio/webm",
        "mkv" => "video/x-matroska",
        "caf" => "audio/x-caf",
        _ => "application/octet-stream",
    }
}

fn ext_of(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase())
}

/// Decodes `path` and encodes it to WebM Opus; `progress` gets 0..1 (when the length is known).
pub fn to_webm(
    path: &Path,
    stop: &dyn Fn() -> bool,
    progress: &dyn Fn(f64),
) -> AppResult<Imported> {
    let ext = ext_of(path);
    let info = decode::probe(decode::file_source(path)?, ext.as_deref())?;
    let total = info.samples.max(1) as f64;
    let mut enc = FrameEncoder::new(1, BITRATE)?;
    let head = crate::encode::opus_head(1, enc.preskip48());
    let mut packets: Vec<Vec<u8>> = Vec::new();
    let mut done = 0u64;
    let mut last = 0.0f64;
    let decoded = decode::decode_stream(
        decode::file_source(path)?,
        ext.as_deref(),
        Channels::Mix,
        stop,
        &mut |chunk| {
            for (p, _) in enc.push(&chunk[0])? {
                packets.push(p);
            }
            done += chunk[0].len() as u64;
            let f = (done as f64 / total).min(0.99);
            if info.samples > 0 && f - last >= 0.01 {
                last = f;
                progress(f);
            }
            Ok(())
        },
    )?;
    let samples = enc.samples_in();
    let (rest, end) = enc.finish()?;
    packets.extend(rest.into_iter().map(|(p, _)| p));
    let webm = webm::mux(&head, &packets, end)?;
    progress(1.0);
    Ok(Imported {
        webm,
        duration_ms: samples * 1000 / crate::SAMPLE_RATE as u64,
        had_video: info.had_video || decoded.had_video,
        codec: decoded.codec,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_mime_type() {
        assert_eq!(mime_for("Aula.M4A"), "audio/mp4");
        assert_eq!(mime_for("x.opus"), "audio/ogg; codecs=opus");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }

    #[test]
    fn imports_a_wav_and_keeps_its_length() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("aula.wav");
        let tone: Vec<f32> = (0..44_100 * 2)
            .map(|i| (i as f32 * 0.05).sin() * 0.3)
            .collect();
        let mut b = Vec::new();
        let data_len = (tone.len() * 2) as u32;
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&(36 + data_len).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&44_100u32.to_le_bytes());
        b.extend_from_slice(&(44_100u32 * 2).to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&data_len.to_le_bytes());
        for v in &tone {
            b.extend_from_slice(&((v * 32767.0) as i16).to_le_bytes());
        }
        std::fs::write(&p, b).unwrap();
        let seen = std::sync::Mutex::new(Vec::new());
        let im = to_webm(&p, &|| false, &|f| seen.lock().unwrap().push(f)).unwrap();
        assert!((im.duration_ms as i64 - 2000).abs() <= 2, "{}", im.duration_ms);
        assert!(!im.had_video);
        assert_eq!(seen.lock().unwrap().last(), Some(&1.0));
        let (t, info) = decode::decode(
            decode::bytes_source(im.webm),
            Some("webm"),
            Channels::Mix,
            &|| false,
        )
        .unwrap();
        assert_eq!(info.codec, "opus");
        // WebM's Duration is read back to the millisecond.
        assert!((t[0].len() as i64 - (im.duration_ms * 16) as i64).abs() <= 16);
    }
}
