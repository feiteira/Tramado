// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/decode.rs), MPL-2.0, same author.

//! Reads a recording into 16 kHz samples, streamed in chunks: Symphonia demuxes (WebM/MKV,
//! Ogg, MP4/M4A/MOV, WAV, FLAC, MP3, CAF) and decodes WAV, MP3, AAC-LC, FLAC, Vorbis and ALAC;
//! **Opus** (Symphonia 0.6 has no decoder for it) goes to libopus, which decodes straight to
//! 16 kHz. Symphonia applies neither the Opus pre-skip nor WebM's `DiscardPadding`
//! (audio-pipeline gotcha 1): the pre-skip is read from the `OpusHead` and dropped here, and the
//! exact length comes from the WebM `Duration` or the Ogg end granule.
//!
//! HE-AAC (AAC+, SBR) is not decoded by Symphonia 0.6 (LC only): it is refused with
//! `SPEECH_UNSUPPORTED_AUDIO` (critique G23).

use std::io::Cursor;

use symphonia::core::codecs::audio::well_known::profiles::{
    CODEC_PROFILE_AAC_HE, CODEC_PROFILE_AAC_HE_V2,
};
use symphonia::core::codecs::audio::well_known::{CODEC_ID_AAC, CODEC_ID_OPUS};
use symphonia::core::codecs::audio::{AudioCodecParameters, AudioDecoderOptions};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use tramado_base::error::{AppError, AppResult, Code};

use crate::resample::Resampler;
use crate::SAMPLE_RATE;

/// How the channels of a recording become what is transcribed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channels {
    /// Everyone together: all channels mixed into one.
    Mix,
    /// The first two channels apart (an online class: me on the left, the class on the right).
    /// A mono file feeds both tracks.
    Split,
    /// One channel only (0 = left): split transcription decodes each side in its own pass, so
    /// only one track is in memory at a time (critique G22).
    One(usize),
}

impl Channels {
    fn tracks(self) -> usize {
        match self {
            Channels::Split => 2,
            Channels::Mix | Channels::One(_) => 1,
        }
    }
}

/// What a decode found out about the file.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamInfo {
    pub codec: String,
    pub channels_in: usize,
    pub rate_in: u32,
    pub had_video: bool,
    /// Samples per output track, at 16 kHz.
    pub samples: u64,
}

fn unsupported_audio(detail: impl std::fmt::Display) -> AppError {
    AppError::new(
        Code::SpeechUnsupportedAudio,
        format!("the recording could not be read: {detail}"),
    )
}

fn cancelled() -> AppError {
    AppError::new(Code::Cancelled, "stopped")
}

/// AAC with spectral band replication (HE-AAC v1/v2), from the profile or the
/// AudioSpecificConfig (ISO 14496-3 §1.6.2.1: object type 5 or 29, or the explicit
/// backward-compatible SBR extension `0x2B7`).
pub fn is_he_aac(params: &AudioCodecParameters) -> bool {
    if params.codec != CODEC_ID_AAC {
        return false;
    }
    if matches!(params.profile, Some(p) if p == CODEC_PROFILE_AAC_HE || p == CODEC_PROFILE_AAC_HE_V2)
    {
        return true;
    }
    params.extra_data.as_deref().is_some_and(asc_has_sbr)
}

struct Bits<'a> {
    b: &'a [u8],
    at: usize,
}

impl Bits<'_> {
    fn read(&mut self, n: usize) -> Option<u32> {
        let mut v = 0u32;
        for _ in 0..n {
            let byte = *self.b.get(self.at / 8)?;
            let bit = (byte >> (7 - self.at % 8)) & 1;
            v = (v << 1) | bit as u32;
            self.at += 1;
        }
        Some(v)
    }

    fn object_type(&mut self) -> Option<u32> {
        let t = self.read(5)?;
        if t == 31 {
            Some(32 + self.read(6)?)
        } else {
            Some(t)
        }
    }

    fn rate_index(&mut self) -> Option<()> {
        if self.read(4)? == 0xF {
            self.read(24)?;
        }
        Some(())
    }
}

/// Parses enough of an AudioSpecificConfig to tell whether SBR is signalled.
pub fn asc_has_sbr(asc: &[u8]) -> bool {
    let mut r = Bits { b: asc, at: 0 };
    let Some(aot) = r.object_type() else {
        return false;
    };
    if aot == 5 || aot == 29 {
        return true;
    }
    // AAC-LC GASpecificConfig, then look for the explicit SBR extension.
    if aot != 2 || r.rate_index().is_none() || r.read(4).is_none() || r.read(3).is_none() {
        return false;
    }
    while r.at + 16 <= asc.len() * 8 {
        let mut probe = Bits { b: asc, at: r.at };
        if probe.read(11) == Some(0x2B7) {
            let ext = probe.object_type();
            let sbr = probe.read(1);
            return ext == Some(5) && sbr == Some(1);
        }
        r.at += 1;
    }
    false
}

struct Opened {
    format: Box<dyn FormatReader>,
    track_id: u32,
    params: AudioCodecParameters,
    had_video: bool,
    /// Exact length in 16 kHz samples when the container says (WebM Duration).
    exact: Option<u64>,
    num_frames: Option<u64>,
}

fn open(source: Box<dyn MediaSource>, ext: Option<&str>) -> AppResult<Opened> {
    let mss = MediaSourceStream::new(source, MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(e) = ext.filter(|e| !e.is_empty()) {
        hint.with_extension(e);
    }
    let format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| {
            AppError::new(
                Code::UnsupportedFile,
                format!("not a sound or video file this app can read: {e}"),
            )
        })?;
    let had_video = format
        .tracks()
        .iter()
        .any(|t| t.track_type() == Some(TrackType::Video));
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| unsupported_audio("no sound track"))?;
    let track_id = track.id;
    let num_frames = track.num_frames;
    // Ogg reports its length with the codec delay (pre-skip) included; WebM's Duration is
    // the real length.
    let delay_secs = match (track.delay, track.time_base) {
        (Some(d), Some(tb)) => d as f64 * tb.numer.get() as f64 / tb.denom.get() as f64,
        _ => 0.0,
    };
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| unsupported_audio("unknown sound format"))?
        .clone();
    let info = format.media_info();
    let exact = match (info.duration, info.time_base) {
        (Some(d), Some(tb)) if tb.denom.get() > 0 => {
            let secs = d.get() as f64 * tb.numer.get() as f64 / tb.denom.get() as f64 - delay_secs;
            Some((secs.max(0.0) * SAMPLE_RATE as f64).round() as u64)
        }
        _ => None,
    };
    Ok(Opened {
        format,
        track_id,
        params,
        had_video,
        exact,
        num_frames,
    })
}

/// Only the codec, the channels and whether a video track is there (import checks).
pub fn probe(source: Box<dyn MediaSource>, ext: Option<&str>) -> AppResult<StreamInfo> {
    let o = open(source, ext)?;
    if is_he_aac(&o.params) {
        return Err(he_aac());
    }
    Ok(StreamInfo {
        codec: codec_name(&o.params),
        channels_in: o.params.channels.as_ref().map(|c| c.count()).unwrap_or(0),
        rate_in: o.params.sample_rate.unwrap_or(0),
        had_video: o.had_video,
        samples: o
            .exact
            .or_else(|| {
                let rate = o.params.sample_rate? as u64;
                (rate > 0).then(|| o.num_frames.unwrap_or(0) * SAMPLE_RATE as u64 / rate)
            })
            .unwrap_or(0),
    })
}

fn he_aac() -> AppError {
    unsupported_audio("HE-AAC (AAC+) is not supported; convert the file to MP3 or M4A (AAC-LC)")
}

fn codec_name(p: &AudioCodecParameters) -> String {
    use symphonia::core::codecs::audio::well_known::{
        CODEC_ID_ALAC, CODEC_ID_FLAC, CODEC_ID_MP1, CODEC_ID_MP2, CODEC_ID_MP3, CODEC_ID_VORBIS,
    };
    let c = p.codec;
    let name = if c == CODEC_ID_OPUS {
        "opus"
    } else if c == CODEC_ID_AAC {
        "aac"
    } else if c == CODEC_ID_MP3 || c == CODEC_ID_MP2 || c == CODEC_ID_MP1 {
        "mp3"
    } else if c == CODEC_ID_FLAC {
        "flac"
    } else if c == CODEC_ID_VORBIS {
        "vorbis"
    } else if c == CODEC_ID_ALAC {
        "alac"
    } else {
        "pcm"
    };
    name.into()
}

/// Splits decoded planes (one `Vec` per source channel) into the output tracks.
fn route(planes: &[Vec<f32>], frames: usize, channels: Channels, out: &mut [Vec<f32>]) {
    for o in out.iter_mut() {
        o.clear();
    }
    if planes.is_empty() || frames == 0 {
        return;
    }
    match channels {
        Channels::Mix => {
            let n = planes.len() as f32;
            out[0].extend((0..frames).map(|i| planes.iter().map(|p| p[i]).sum::<f32>() / n));
        }
        Channels::Split => {
            for (t, o) in out.iter_mut().enumerate() {
                o.extend_from_slice(&planes[t.min(planes.len() - 1)][..frames]);
            }
        }
        Channels::One(c) => {
            out[0].extend_from_slice(&planes[c.min(planes.len() - 1)][..frames]);
        }
    }
}

/// Decodes a recording, handing 16 kHz chunks (one slice per output track, equal lengths) to
/// `sink`. `ext` is a hint (the file's extension); the content decides. `stop` is asked between
/// packets (`CANCELLED`).
pub fn decode_stream(
    source: Box<dyn MediaSource>,
    ext: Option<&str>,
    channels: Channels,
    stop: &dyn Fn() -> bool,
    sink: &mut dyn FnMut(&[Vec<f32>]) -> AppResult<()>,
) -> AppResult<StreamInfo> {
    let o = open(source, ext)?;
    if is_he_aac(&o.params) {
        return Err(he_aac());
    }
    if o.params.codec == CODEC_ID_OPUS {
        decode_opus(o, channels, stop, sink)
    } else {
        decode_generic(o, channels, stop, sink)
    }
}

fn decode_opus(
    mut o: Opened,
    channels: Channels,
    stop: &dyn Fn() -> bool,
    sink: &mut dyn FnMut(&[Vec<f32>]) -> AppResult<()>,
) -> AppResult<StreamInfo> {
    let head = o
        .params
        .extra_data
        .as_deref()
        .and_then(crate::encode::parse_head)
        .ok_or_else(|| unsupported_audio("an Opus track without its OpusHead"))?;
    let ch = match head.channels {
        1 => opusic_c::Channels::Mono,
        2 => opusic_c::Channels::Stereo,
        n => return Err(unsupported_audio(format!("Opus with {n} channels"))),
    };
    let nch = head.channels as usize;
    let mut dec = opusic_c::Decoder::new(ch, opusic_c::SampleRate::Hz16000)
        .map_err(|e| unsupported_audio(format!("opus: {e:?}")))?;
    // The exact length: WebM's Duration, or the Ogg end granule less the pre-skip.
    let limit = o.exact.or(o
        .num_frames
        .map(|n| n.saturating_sub(head.preskip48 as u64) / 3));
    let mut skip = head.preskip48 as usize / 3;
    let mut produced: u64 = 0;
    let mut buf = vec![0f32; 5760 * nch];
    let tracks = channels.tracks();
    let mut out: Vec<Vec<f32>> = vec![Vec::new(); tracks];
    let mut planes: Vec<Vec<f32>> = vec![Vec::new(); nch];
    loop {
        if stop() {
            return Err(cancelled());
        }
        let packet = match o.format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(unsupported_audio(e)),
        };
        if packet.track_id != o.track_id {
            continue;
        }
        let n = match dec.decode_float_to_slice(&packet.data, &mut buf, false) {
            Ok(n) => n,
            // A damaged packet becomes silence of its length, so later times stay right.
            Err(_) => {
                let n = crate::encode::packet_samples48(&packet.data).unwrap_or(960) as usize / 3;
                buf[..n * nch].fill(0.0);
                n
            }
        };
        let mut a = 0;
        if skip > 0 {
            a = skip.min(n);
            skip -= a;
        }
        let mut b = n;
        if let Some(limit) = limit {
            let room = limit.saturating_sub(produced) as usize;
            b = b.min(a + room);
        }
        if b <= a {
            continue;
        }
        for (c, p) in planes.iter_mut().enumerate() {
            p.clear();
            p.extend((a..b).map(|i| buf[i * nch + c]));
        }
        route(&planes, b - a, channels, &mut out);
        produced += (b - a) as u64;
        sink(&out)?;
    }
    if produced == 0 {
        return Err(unsupported_audio("no sound"));
    }
    Ok(StreamInfo {
        codec: "opus".into(),
        channels_in: nch,
        rate_in: 48_000,
        had_video: o.had_video,
        samples: produced,
    })
}

fn decode_generic(
    mut o: Opened,
    channels: Channels,
    stop: &dyn Fn() -> bool,
    sink: &mut dyn FnMut(&[Vec<f32>]) -> AppResult<()>,
) -> AppResult<StreamInfo> {
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&o.params, &AudioDecoderOptions::default())
        .map_err(unsupported_audio)?;
    let tracks = channels.tracks();
    let mut resamplers: Option<(u32, Vec<Resampler>)> = None;
    let mut planes: Vec<Vec<f32>> = Vec::new();
    let mut routed: Vec<Vec<f32>> = vec![Vec::new(); tracks];
    let mut out: Vec<Vec<f32>> = vec![Vec::new(); tracks];
    let mut produced: u64 = 0;
    let mut channels_in = 0;
    loop {
        if stop() {
            return Err(cancelled());
        }
        let packet = match o.format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // Some files end without a clean end-of-stream: what was read is kept.
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(unsupported_audio(e)),
        };
        if packet.track_id != o.track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // A damaged packet is skipped, as players do.
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(unsupported_audio(e)),
        };
        let rate = decoded.spec().rate();
        decoded.copy_to_vecs_planar::<f32>(&mut planes);
        if planes.is_empty() || planes[0].is_empty() {
            continue;
        }
        channels_in = planes.len();
        // The rate is known for certain only from decoded audio for some formats; it does not
        // change.
        let rs = resamplers.get_or_insert_with(|| {
            (
                rate,
                (0..tracks)
                    .map(|_| Resampler::new(rate, SAMPLE_RATE))
                    .collect(),
            )
        });
        if rs.0 != rate {
            return Err(unsupported_audio("the sample rate changes"));
        }
        let frames = planes[0].len();
        route(&planes, frames, channels, &mut routed);
        for (t, r) in routed.iter().enumerate() {
            out[t].clear();
            rs.1[t].push(r, &mut out[t]);
        }
        let n = out.iter().map(Vec::len).min().unwrap_or(0);
        for t in &mut out {
            t.truncate(n);
        }
        if n > 0 {
            produced += n as u64;
            sink(&out)?;
        }
    }
    if produced == 0 {
        return Err(unsupported_audio("no sound"));
    }
    Ok(StreamInfo {
        codec: codec_name(&o.params),
        channels_in,
        rate_in: resamplers.map(|r| r.0).unwrap_or(0),
        had_video: o.had_video,
        samples: produced,
    })
}

/// Decodes everything into memory: one `Vec` per output track.
pub fn decode(
    source: Box<dyn MediaSource>,
    ext: Option<&str>,
    channels: Channels,
    stop: &dyn Fn() -> bool,
) -> AppResult<(Vec<Vec<f32>>, StreamInfo)> {
    let mut tracks: Vec<Vec<f32>> = vec![Vec::new(); channels.tracks()];
    let info = decode_stream(source, ext, channels, stop, &mut |chunk| {
        for (t, c) in tracks.iter_mut().zip(chunk) {
            t.extend_from_slice(c);
        }
        Ok(())
    })?;
    Ok((tracks, info))
}

/// A byte buffer as a media source.
pub fn bytes_source(bytes: Vec<u8>) -> Box<dyn MediaSource> {
    Box::new(Cursor::new(bytes))
}

/// A file as a media source.
pub fn file_source(path: &std::path::Path) -> AppResult<Box<dyn MediaSource>> {
    Ok(Box::new(std::fs::File::open(path)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16-bit PCM WAV file.
    pub fn wav(rate: u32, channels: &[Vec<f32>]) -> Vec<u8> {
        let n = channels[0].len();
        let ch = channels.len() as u16;
        let data_len = (n * channels.len() * 2) as u32;
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&(36 + data_len).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&ch.to_le_bytes());
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&(rate * ch as u32 * 2).to_le_bytes());
        b.extend_from_slice(&(ch * 2).to_le_bytes());
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..n {
            for c in channels {
                b.extend_from_slice(&((c[i].clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
            }
        }
        b
    }

    fn tone(rate: u32, hz: f32, secs: f32, amp: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize)
            .map(|i| (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin() * amp)
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    #[test]
    fn splits_a_two_sided_recording() {
        let left = tone(16_000, 300.0, 1.0, 0.5);
        let right = vec![0.0; 16_000];
        let bytes = wav(16_000, &[left, right]);
        let (tracks, info) =
            decode(bytes_source(bytes), Some("wav"), Channels::Split, &|| false).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(info.channels_in, 2);
        assert!((tracks[0].len() as i64 - 16_000).abs() < 4);
        assert!(rms(&tracks[0]) > 0.3);
        assert!(rms(&tracks[1]) < 0.001);
        // One side at a time.
        let bytes = wav(16_000, &[vec![0.0; 16_000], tone(16_000, 300.0, 1.0, 0.5)]);
        let (one, _) = decode(bytes_source(bytes), Some("wav"), Channels::One(1), &|| {
            false
        })
        .unwrap();
        assert_eq!(one.len(), 1);
        assert!(rms(&one[0]) > 0.3);
    }

    #[test]
    fn mixes_and_resamples_to_sixteen_kilohertz() {
        let a = tone(48_000, 440.0, 2.0, 0.4);
        let bytes = wav(48_000, &[a.clone(), a]);
        let (tracks, info) = decode(bytes_source(bytes), None, Channels::Mix, &|| false).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(info.rate_in, 48_000);
        assert!((tracks[0].len() as i64 - 32_000).abs() < 8);
        assert!((rms(&tracks[0][1000..]) - 0.4 / 2f32.sqrt()).abs() < 0.02);
    }

    #[test]
    fn refuses_what_is_not_audio() {
        let e = decode(
            bytes_source(b"not a recording".to_vec()),
            Some("mp3"),
            Channels::Mix,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(e.code(), Code::UnsupportedFile);
    }

    #[test]
    fn stops_when_asked() {
        let bytes = wav(16_000, &[tone(16_000, 300.0, 1.0, 0.5)]);
        let e = decode(bytes_source(bytes), Some("wav"), Channels::Mix, &|| true).unwrap_err();
        assert_eq!(e.code(), Code::Cancelled);
    }

    #[test]
    fn decode_opus_length_exact() {
        // 7.777 s: not a whole number of 60 ms packets.
        let pcm = tone(16_000, 330.0, 7.777, 0.4);
        let n = pcm.len();
        let webm = crate::webm::encode_pcm(&pcm, 1, 24_000).unwrap();
        let (t, info) = decode(bytes_source(webm), Some("webm"), Channels::Mix, &|| false).unwrap();
        assert_eq!(info.codec, "opus");
        assert_eq!(t[0].len(), n);
        // The pre-skip is gone: the decoded tone lines up with the source (no 6.5 ms shift).
        let corr = |lag: usize| -> f32 {
            let m = 16_000;
            (0..m)
                .map(|i| pcm[4000 + i] * t[0][4000 + i + lag])
                .sum::<f32>()
        };
        assert!(corr(0) > corr(104) && corr(0) > 0.0);
        // The Ogg journal decodes to the same length.
        let (head, packets, end) = crate::journal::encode_to_packets(&pcm, 1, 24_000).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.ogg");
        let mut w =
            crate::journal::OggWriter::create(&p, head, crate::encode::opus_tags(&[])).unwrap();
        let k = packets.len();
        let mut last = Vec::new();
        for (i, pk) in packets.into_iter().enumerate() {
            if i + 1 == k {
                last.push(pk);
            } else {
                w.write(pk.0, pk.1).unwrap();
            }
        }
        w.finish(last).unwrap();
        assert_eq!(end, 312 + n as u64 * 3);
        let (o, _) = decode(
            file_source(&p).unwrap(),
            Some("ogg"),
            Channels::Mix,
            &|| false,
        )
        .unwrap();
        assert_eq!(o[0].len(), n);
        // Stereo keeps the two sides apart.
        let mut st = Vec::with_capacity(n * 2);
        for x in &pcm {
            st.push(*x);
            st.push(0.0);
        }
        let webm = crate::webm::encode_pcm(&st, 2, 32_000).unwrap();
        let (s, info) =
            decode(bytes_source(webm), Some("webm"), Channels::Split, &|| false).unwrap();
        assert_eq!(info.channels_in, 2);
        assert_eq!(s[0].len(), n);
        assert!(rms(&s[0]) > 0.2 && rms(&s[1]) < 0.01);
    }

    #[test]
    fn spots_sbr_in_an_audio_specific_config() {
        // AAC-LC, 44.1 kHz, mono.
        assert!(!asc_has_sbr(&[0x12, 0x08]));
        // HE-AAC, explicit hierarchical signalling (object type 5, core 22.05 kHz).
        assert!(asc_has_sbr(&[0x2B, 0x8A, 0x08, 0x00]));
        // HE-AAC v2 (object type 29).
        assert!(asc_has_sbr(&[0xEB, 0x8A, 0x08, 0x00]));
        // AAC-LC followed by the backward-compatible SBR extension (0x2B7, type 5, present).
        assert!(asc_has_sbr(&[0x13, 0x10, 0x56, 0xE5, 0x98]));
        assert!(!asc_has_sbr(&[]));
    }
}
