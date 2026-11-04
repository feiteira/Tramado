// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The Opus encoder (libopus 1.6.1 through `opusic-c`; audio-pipeline §2.7): 16 kHz input,
//! `Voip` application, `Voice` signal, VBR, complexity 10, 60 ms packets; 24 kbps mono (16 kbps
//! "storage saver") or 32 kbps stereo (L = me, R = class). Plus the two Opus header packets
//! (RFC 7845 `OpusHead`, `OpusTags`) and the packet-duration rule of RFC 6716 §3.1.

use opusic_c::{Application, Bitrate, Channels, Encoder, SampleRate, Signal};
use tramado_base::error::{AppError, AppResult, Code};

use crate::SAMPLE_RATE;

/// Samples per channel in one packet: 60 ms at 16 kHz.
pub const FRAME: usize = 960;
/// The largest packet libopus writes for one frame (the RFC's limit is 1275 B per 20 ms).
const MAX_PACKET: usize = 4000;
/// What every recording and import names as its writer in `OpusTags` and the WebM header.
pub const VENDOR: &str = "Tramado";

/// The bitrates a recording may use (folder spec §8.6–§8.7, D-14).
pub fn valid_bitrate(bps: u32) -> bool {
    matches!(bps, 16_000 | 24_000 | 32_000)
}

fn opus_err(e: opusic_c::ErrorCode) -> AppError {
    AppError::new(Code::IoError, format!("opus encoder: {e:?}"))
}

pub struct OpusEncoder {
    enc: Encoder,
    channels: usize,
    preskip48: u16,
    packet: Vec<u8>,
}

impl OpusEncoder {
    /// `channels` 1 or 2; `bitrate` in bits per second.
    pub fn new(channels: usize, bitrate: u32) -> AppResult<Self> {
        let ch = match channels {
            1 => Channels::Mono,
            2 => Channels::Stereo,
            n => return Err(AppError::invalid(format!("{n} channels"))),
        };
        let mut enc = Encoder::new(ch, SampleRate::Hz16000, Application::Voip).map_err(opus_err)?;
        enc.set_bitrate(Bitrate::Value(bitrate)).map_err(opus_err)?;
        enc.set_vbr(true).map_err(opus_err)?;
        enc.set_signal(Signal::Voice).map_err(opus_err)?;
        enc.set_complexity(10).map_err(opus_err)?;
        if channels == 2 {
            // Below ~30 kbps libopus may fold stereo to mono, which would merge the two sides of
            // an online class (measured not to happen at 16 kHz; kept as a guard).
            enc.set_force_channels(Some(Channels::Stereo))
                .map_err(opus_err)?;
        }
        // Reported at the encoder's rate (16 kHz); RFC 7845 counts at 48 kHz.
        let look_ahead = enc.get_look_ahead().map_err(opus_err)?;
        Ok(OpusEncoder {
            enc,
            channels,
            preskip48: (look_ahead * (48_000 / SAMPLE_RATE)) as u16,
            packet: vec![0; MAX_PACKET],
        })
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    /// RFC 7845 pre-skip in 48 kHz samples (312 for libopus at 16 kHz).
    pub fn preskip48(&self) -> u16 {
        self.preskip48
    }

    /// One packet from exactly `FRAME × channels` interleaved samples.
    pub fn encode(&mut self, frame: &[f32]) -> AppResult<Vec<u8>> {
        if frame.len() != FRAME * self.channels {
            return Err(AppError::invalid("an Opus frame is 60 ms"));
        }
        let n = self
            .enc
            .encode_float_to_slice(frame, &mut self.packet)
            .map_err(opus_err)?;
        Ok(self.packet[..n].to_vec())
    }
}

/// Opus packets with their Ogg granules.
pub type Packets = Vec<(Vec<u8>, u64)>;

/// Feeds interleaved samples of any length to the encoder in 60 ms frames and keeps the
/// RFC 7845 accounting: samples in, granule of every packet, and the end trim.
pub struct FrameEncoder {
    enc: OpusEncoder,
    pending: Vec<f32>,
    /// Real samples per channel handed in so far.
    samples_in: u64,
    /// Samples per channel encoded (whole frames, padding included).
    samples_out: u64,
}

impl FrameEncoder {
    pub fn new(channels: usize, bitrate: u32) -> AppResult<Self> {
        Ok(FrameEncoder {
            enc: OpusEncoder::new(channels, bitrate)?,
            pending: Vec::with_capacity(FRAME * channels * 2),
            samples_in: 0,
            samples_out: 0,
        })
    }

    pub fn channels(&self) -> usize {
        self.enc.channels()
    }

    pub fn preskip48(&self) -> u16 {
        self.enc.preskip48()
    }

    /// Real samples per channel handed in (16 kHz): the recording's length so far.
    pub fn samples_in(&self) -> u64 {
        self.samples_in
    }

    /// Takes interleaved samples; returns the packets they complete with each packet's Ogg
    /// granule.
    pub fn push(&mut self, interleaved: &[f32]) -> AppResult<Packets> {
        let ch = self.channels();
        self.samples_in += (interleaved.len() / ch) as u64;
        self.pending.extend_from_slice(interleaved);
        let mut out = Vec::new();
        let step = FRAME * ch;
        let mut at = 0;
        while self.pending.len() - at >= step {
            let packet = self.enc.encode(&self.pending[at..at + step])?;
            self.samples_out += FRAME as u64;
            out.push((packet, Self::granule(self.samples_out)));
            at += step;
        }
        self.pending.drain(..at);
        Ok(out)
    }

    /// RFC 7845 §4: a page's granule counts every sample decoded up to its end (48 kHz), the
    /// pre-skip included; only the last page's (`finish`) trims the end.
    fn granule(samples16: u64) -> u64 {
        samples16 * 3
    }

    /// Pads the last frame with silence, then one more frame of silence (the encoder runs
    /// `look_ahead` samples behind its input, audio-pipeline gotcha 2); the last packet's
    /// granule is the real end, which trims the padding again. Returns the remaining packets
    /// and the end granule.
    pub fn finish(mut self) -> AppResult<(Packets, u64)> {
        let ch = self.channels();
        let step = FRAME * ch;
        let real = self.samples_in;
        let mut out = Vec::new();
        let rest = self.pending.len();
        let mut frames: Vec<Vec<f32>> = Vec::new();
        if rest > 0 {
            let mut f = std::mem::take(&mut self.pending);
            f.resize(step, 0.0);
            frames.push(f);
        }
        frames.push(vec![0.0; step]);
        for f in frames {
            let packet = self.enc.encode(&f)?;
            self.samples_out += FRAME as u64;
            out.push((packet, Self::granule(self.samples_out)));
        }
        let end = self.preskip48() as u64 + real * 3;
        // Granules never pass the real end (they must not decrease from page to page).
        for p in &mut out {
            p.1 = p.1.min(end);
        }
        Ok((out, end))
    }
}

/// RFC 7845 §5.1 identification header: version 1, channels, pre-skip, input rate
/// (informational), gain 0, mapping family 0 (mono, or stereo L/R).
pub fn opus_head(channels: u8, preskip48: u16) -> Vec<u8> {
    let mut h = Vec::with_capacity(19);
    h.extend_from_slice(b"OpusHead");
    h.push(1);
    h.push(channels);
    h.extend_from_slice(&preskip48.to_le_bytes());
    h.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    h.extend_from_slice(&0i16.to_le_bytes());
    h.push(0);
    h
}

/// The fields of an `OpusHead`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Head {
    pub channels: u8,
    pub preskip48: u16,
}

pub fn parse_head(b: &[u8]) -> Option<Head> {
    if b.len() < 19 || !b.starts_with(b"OpusHead") {
        return None;
    }
    Some(Head {
        channels: b[9],
        preskip48: u16::from_le_bytes([b[10], b[11]]),
    })
}

/// RFC 7845 §5.2 comment header (`TITLE=…`, `TRAMADO_RECORDING_ID=…`, `DATE=…`).
pub fn opus_tags(comments: &[String]) -> Vec<u8> {
    let vendor = format!("{VENDOR} (libopus {})", opusic_c::version());
    let mut t = Vec::new();
    t.extend_from_slice(b"OpusTags");
    t.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
    t.extend_from_slice(vendor.as_bytes());
    t.extend_from_slice(&(comments.len() as u32).to_le_bytes());
    for c in comments {
        t.extend_from_slice(&(c.len() as u32).to_le_bytes());
        t.extend_from_slice(c.as_bytes());
    }
    t
}

/// How many 48 kHz samples an Opus packet decodes to (RFC 6716 §3.1, the TOC byte).
pub fn packet_samples48(p: &[u8]) -> Option<u32> {
    let toc = *p.first()?;
    let config = toc >> 3;
    let frame = match config {
        0..=11 => [480, 960, 1920, 2880][(config % 4) as usize],
        12..=15 => [480, 960][(config % 2) as usize],
        _ => [120, 240, 480, 960][(config % 4) as usize],
    };
    let frames = match toc & 3 {
        0 => 1,
        1 | 2 => 2,
        _ => (*p.get(1)? & 0x3f) as u32,
    };
    Some(frame * frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_preskip_312() {
        for (ch, bps) in [(1, 24_000), (1, 16_000), (2, 32_000)] {
            let e = OpusEncoder::new(ch, bps).unwrap();
            assert_eq!(e.preskip48(), 312, "{ch} ch {bps}");
        }
        let h = opus_head(2, 312);
        assert_eq!(h.len(), 19);
        assert_eq!(
            parse_head(&h),
            Some(Head {
                channels: 2,
                preskip48: 312
            })
        );
        assert!(valid_bitrate(24_000) && !valid_bitrate(48_000));
    }

    #[test]
    fn packets_are_sixty_milliseconds_and_end_trimmed() {
        let mut e = FrameEncoder::new(1, 24_000).unwrap();
        // 1.01 s of a tone, handed in uneven blocks.
        let x: Vec<f32> = (0..16_160).map(|i| (i as f32 * 0.07).sin() * 0.3).collect();
        let mut packets = Vec::new();
        for block in x.chunks(333) {
            packets.extend(e.push(block).unwrap());
        }
        assert_eq!(e.samples_in(), 16_160);
        let (rest, end) = e.finish().unwrap();
        packets.extend(rest);
        // 16 whole frames + the padded 17th + one frame of silence.
        assert_eq!(packets.len(), 18);
        for (p, _) in &packets {
            assert_eq!(packet_samples48(p), Some(2880));
        }
        assert_eq!(end, 312 + 16_160 * 3);
        assert_eq!(packets.last().unwrap().1, end);
        assert_eq!(packets[0].1, 960 * 3);
    }

    #[test]
    fn tags_name_the_writer() {
        let t = opus_tags(&["TITLE=Aula 7".to_string()]);
        assert!(t.starts_with(b"OpusTags"));
        assert!(t.windows(7).any(|w| w == b"Tramado"));
        assert!(t.ends_with(b"TITLE=Aula 7"));
    }
}
