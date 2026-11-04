// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Publishing a stopped recording (architecture §9 `PublishRequest`, folder spec §8.6–§8.7):
//! the Ogg journal is remuxed (no re-encode) to WebM in memory, then
//! - `audio+transcript`: staged in the class's `.tramado/tmp/` and renamed to
//!   `<lectureDir>/audio.webm` (`ClassFs::stage_and_place`; `CONFLICT` if it exists);
//! - `transcript-only`: kept on this computer as `data/recordings/<id>.webm` (`AudioSource`
//!   private; `lecture.json` says `audio.shared: false`);
//! - `none`: nothing is written to the class; the WebM is kept privately (to play and
//!   transcribe) and the recording stays pending until a share mode is chosen.
//!
//! A published journal is kept (state `published`, small) and reported by
//! `pending_recordings` until `lecture.json` exists in its lecture directory, so a webview that
//! went away between the two writes never leaves an orphaned `audio.webm`.

use std::io::Write;

use tramado_base::classfs::ClassFs;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::{files, ids};

use crate::journal::{self, Journal, JournalPaths, JournalState};
use crate::types::{AudioSource, PublishRequest, PublishedAudio, ShareMode};
use crate::webm;

/// `<lectureDir>/audio.webm`.
pub fn audio_path(lecture_dir: &str) -> String {
    format!("{}/audio.webm", lecture_dir.trim_end_matches('/'))
}

fn check_dir(lecture_dir: &str) -> AppResult<()> {
    if lecture_dir.is_empty()
        || lecture_dir.starts_with('/')
        || lecture_dir
            .split('/')
            .any(|s| s == ".." || s == "." || s.is_empty())
        || lecture_dir.starts_with(".tramado")
    {
        return Err(AppError::invalid("not a lecture directory"));
    }
    Ok(())
}

fn audio(source: AudioSource, bytes: &[u8], j: &Journal) -> PublishedAudio {
    PublishedAudio {
        source,
        size: bytes.len() as u64,
        sha256: ids::sha256_hex(bytes),
        duration_ms: j.duration_ms.unwrap_or(j.ms),
        channels: j.channels,
        bitrate: j.bitrate,
        sample_rate: crate::SAMPLE_RATE,
    }
}

/// The WebM of a stopped recording (its journal remuxed).
pub fn remux(journals: &JournalPaths, id: &str) -> AppResult<Vec<u8>> {
    let b = journal::read_all(&journals.ogg(id)?)?;
    let o = journal::read_ogg_opus(&b)?;
    if o.packets.is_empty() {
        return Err(AppError::new(
            Code::SpeechNoSpeech,
            "the recording is empty",
        ));
    }
    webm::from_ogg(&o)
}

pub fn publish(
    journals: &JournalPaths,
    fs: &ClassFs,
    req: &PublishRequest,
) -> AppResult<PublishedAudio> {
    let mut j = journals
        .read(&req.recording_id)?
        .ok_or_else(|| AppError::not_found("no such recording"))?;
    match j.state {
        JournalState::Recording => {
            return Err(AppError::new(
                Code::JobBusy,
                "the recording is still running",
            ))
        }
        JournalState::Published => {
            return Err(AppError::conflict("the recording was already published"))
        }
        JournalState::Stopped | JournalState::Recovered => {}
    }
    if req.class_id != j.class_id {
        return Err(AppError::invalid("the recording belongs to another class"));
    }
    // The journal when it is there; else the WebM kept from an earlier "none".
    let webm_bytes = if journals.ogg(&req.recording_id)?.exists() {
        remux(journals, &req.recording_id)?
    } else {
        files::read_optional(&journals.webm(&req.recording_id)?)?
            .ok_or_else(|| AppError::not_found("the recording's audio is gone"))?
    };
    let private = |bytes: &[u8]| -> AppResult<PublishedAudio> {
        let path = journals.webm(&req.recording_id)?;
        crate::download::check_space(&journals.dir, bytes.len() as u64)?;
        files::write_atomic(&path, bytes)?;
        Ok(audio(
            AudioSource::Private {
                recording_id: req.recording_id.clone(),
            },
            bytes,
            &j,
        ))
    };
    match req.share {
        ShareMode::None => private(&webm_bytes),
        ShareMode::TranscriptOnly => {
            check_dir(&req.lecture_dir)?;
            let out = private(&webm_bytes)?;
            j.state = JournalState::Published;
            j.lecture_dir = Some(req.lecture_dir.clone());
            j.audio = Some(out.clone());
            journals.write(&j)?;
            files::remove_file_if_exists(&journals.ogg(&req.recording_id)?)?;
            Ok(out)
        }
        ShareMode::AudioAndTranscript => {
            check_dir(&req.lecture_dir)?;
            let dest = audio_path(&req.lecture_dir);
            let stamp = fs.stage_and_place(
                &req.class_id,
                &dest,
                |f| {
                    f.write_all(&webm_bytes)?;
                    Ok(())
                },
                true,
            )?;
            let out = PublishedAudio {
                source: AudioSource::Class {
                    class_id: req.class_id.clone(),
                    path: dest,
                },
                size: stamp.size,
                sha256: stamp.sha256.unwrap_or_else(|| ids::sha256_hex(&webm_bytes)),
                duration_ms: j.duration_ms.unwrap_or(j.ms),
                channels: j.channels,
                bitrate: j.bitrate,
                sample_rate: crate::SAMPLE_RATE,
            };
            j.state = JournalState::Published;
            j.lecture_dir = Some(req.lecture_dir.clone());
            j.audio = Some(out.clone());
            journals.write(&j)?;
            files::remove_file_if_exists(&journals.ogg(&req.recording_id)?)?;
            files::remove_file_if_exists(&journals.webm(&req.recording_id)?)?;
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lecture_directories_stay_in_the_class() {
        assert!(check_dir("Aulas/2026-11-03 Aula 7").is_ok());
        for bad in ["", "/abs", "a/../b", ".tramado/x", "a//b", "./a"] {
            assert!(check_dir(bad).is_err(), "{bad}");
        }
        assert_eq!(audio_path("Aulas/Aula 7/"), "Aulas/Aula 7/audio.webm");
    }
}
