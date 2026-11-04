// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The shared and played file, `audio.webm` (folder spec §8.7, audio-pipeline §2.7): a lossless
//! remux of the recording's Opus packets into WebM (Matroska), built in memory (an hour at
//! 24 kbps is about 11 MB) so every size is known and the file is written once, complete:
//! `EBML · Segment{SeekHead · Info(Duration) · Tracks(A_OPUS, CodecDelay, SeekPreRoll) ·
//! Clusters (~5 s) · Cues}`; the last packet carries `DiscardPadding`.
//!
//! Gotcha 3 (audio-pipeline §2.7): block timestamps count decoded samples from 0 **with** the
//! codec delay included; demuxers subtract `CodecDelay` themselves.

use tramado_base::error::{AppError, AppResult};

use crate::encode::{self, packet_samples48, VENDOR};
use crate::journal::OggOpus;

mod ebml {
    pub fn id(out: &mut Vec<u8>, id: u32) {
        let b = id.to_be_bytes();
        let skip = b.iter().position(|&x| x != 0).unwrap_or(3);
        out.extend_from_slice(&b[skip..]);
    }

    /// The smallest variable-size integer that holds `n` (all ones is reserved for "unknown").
    pub fn size(out: &mut Vec<u8>, n: u64) {
        for len in 1..=8u32 {
            if n < (1u64 << (7 * len)) - 1 {
                let v = n | (1u64 << (7 * len));
                out.extend_from_slice(&v.to_be_bytes()[(8 - len) as usize..]);
                return;
            }
        }
        // Unreachable for anything that fits in memory; keep the 8-byte form.
        out.push(0x01);
        out.extend_from_slice(&n.to_be_bytes()[1..]);
    }

    pub fn el(out: &mut Vec<u8>, i: u32, payload: &[u8]) {
        id(out, i);
        size(out, payload.len() as u64);
        out.extend_from_slice(payload);
    }

    pub fn uint(out: &mut Vec<u8>, i: u32, v: u64) {
        let b = v.to_be_bytes();
        let skip = b.iter().position(|&x| x != 0).unwrap_or(7);
        el(out, i, &b[skip..]);
    }

    /// Fixed 8-byte unsigned: positions can be filled in without changing any size.
    pub fn uint8(out: &mut Vec<u8>, i: u32, v: u64) {
        el(out, i, &v.to_be_bytes());
    }

    pub fn float(out: &mut Vec<u8>, i: u32, v: f64) {
        el(out, i, &v.to_be_bytes());
    }

    pub fn int(out: &mut Vec<u8>, i: u32, v: i64) {
        el(out, i, &v.to_be_bytes());
    }

    pub fn string(out: &mut Vec<u8>, i: u32, s: &str) {
        el(out, i, s.as_bytes());
    }
}

/// Element IDs used below (Matroska specification).
mod ids {
    pub const EBML: u32 = 0x1A45_DFA3;
    pub const SEGMENT: u32 = 0x1853_8067;
    pub const SEEK_HEAD: u32 = 0x114D_9B74;
    pub const SEEK: u32 = 0x4DBB;
    pub const SEEK_ID: u32 = 0x53AB;
    pub const SEEK_POSITION: u32 = 0x53AC;
    pub const INFO: u32 = 0x1549_A966;
    pub const TRACKS: u32 = 0x1654_AE6B;
    pub const CUES: u32 = 0x1C53_BB6B;
    pub const CLUSTER: u32 = 0x1F43_B675;
}

/// Clusters start every 5 s (and the Cues point at each).
const CLUSTER_MS: i64 = 5_000;
/// Opus decoders need 80 ms of pre-roll after a seek.
const SEEK_PRE_ROLL_NS: u64 = 80_000_000;

fn ns(samples48: u64) -> u64 {
    samples48 * 1_000_000_000 / 48_000
}

/// The duration of a stream in ms (end granule less pre-skip).
pub fn duration_ms(end_granule: u64, preskip48: u16) -> f64 {
    end_granule.saturating_sub(preskip48 as u64) as f64 / 48.0
}

/// `OpusHead` + packets + the real end (Ogg granule, 48 kHz, pre-skip included) → a WebM file.
pub fn mux(head: &[u8], packets: &[Vec<u8>], end_granule: u64) -> AppResult<Vec<u8>> {
    use ebml::*;
    let h = encode::parse_head(head).ok_or_else(|| AppError::invalid("not an OpusHead"))?;
    if packets.is_empty() {
        return Err(AppError::invalid("no audio"));
    }
    let samples: Vec<u64> = packets
        .iter()
        .map(|p| packet_samples48(p).unwrap_or(960) as u64)
        .collect();
    let total48: u64 = samples.iter().sum();

    let mut clusters: Vec<(u64, Vec<u8>)> = Vec::new();
    let mut at48: u64 = 0;
    let mut cur: Option<(u64, Vec<u8>)> = None;
    for (k, p) in packets.iter().enumerate() {
        let t_ms = (at48 as f64 / 48.0).round() as i64;
        let start_new = match &cur {
            None => true,
            Some((ct, _)) => t_ms - *ct as i64 >= CLUSTER_MS,
        };
        if start_new {
            if let Some(c) = cur.take() {
                clusters.push(c);
            }
            let ct = t_ms.max(0) as u64;
            let mut body = Vec::new();
            uint(&mut body, 0xE7, ct); // Timestamp
            cur = Some((ct, body));
        }
        if let Some((ct, body)) = cur.as_mut() {
            let rel = (t_ms - *ct as i64) as i16;
            let mut block = vec![0x81]; // track 1 as a vint
            block.extend_from_slice(&rel.to_be_bytes());
            let last = k + 1 == packets.len();
            if last && total48 > end_granule {
                // The padding past the real end, as DiscardPadding on a BlockGroup.
                block.push(0x00);
                block.extend_from_slice(p);
                let mut group = Vec::new();
                el(&mut group, 0xA1, &block); // Block
                int(&mut group, 0x75A2, ns(total48 - end_granule) as i64); // DiscardPadding
                el(body, 0xA0, &group); // BlockGroup
            } else {
                block.push(0x80); // keyframe
                block.extend_from_slice(p);
                el(body, 0xA3, &block); // SimpleBlock
            }
        }
        at48 += samples[k];
    }
    if let Some(c) = cur.take() {
        clusters.push(c);
    }

    let mut info = Vec::new();
    uint(&mut info, 0x2A_D7B1, 1_000_000); // TimestampScale: 1 ms
    float(&mut info, 0x4489, duration_ms(end_granule, h.preskip48)); // Duration (ms)
    string(&mut info, 0x4D80, VENDOR); // MuxingApp
    string(&mut info, 0x5741, VENDOR); // WritingApp
    let mut info_el = Vec::new();
    el(&mut info_el, ids::INFO, &info);

    let mut audio = Vec::new();
    float(&mut audio, 0xB5, 48_000.0); // SamplingFrequency: Opus always decodes at 48 kHz
    uint(&mut audio, 0x9F, h.channels as u64); // Channels
    let mut entry = Vec::new();
    uint(&mut entry, 0xD7, 1); // TrackNumber
    uint(&mut entry, 0x73C5, 1); // TrackUID
    uint(&mut entry, 0x83, 2); // TrackType: audio
    uint(&mut entry, 0x9C, 0); // FlagLacing
    string(&mut entry, 0x86, "A_OPUS"); // CodecID
    el(&mut entry, 0x63A2, head); // CodecPrivate: the OpusHead
    uint(&mut entry, 0x56AA, ns(h.preskip48 as u64)); // CodecDelay (ns)
    uint(&mut entry, 0x56BB, SEEK_PRE_ROLL_NS); // SeekPreRoll
    el(&mut entry, 0xE1, &audio);
    let mut tracks = Vec::new();
    el(&mut tracks, 0xAE, &entry);
    let mut tracks_el = Vec::new();
    el(&mut tracks_el, ids::TRACKS, &tracks);

    let seek = |target: u32, pos: u64| {
        let mut s = Vec::new();
        let mut idb = Vec::new();
        id(&mut idb, target);
        el(&mut s, ids::SEEK_ID, &idb);
        uint8(&mut s, ids::SEEK_POSITION, pos);
        let mut out = Vec::new();
        el(&mut out, ids::SEEK, &s);
        out
    };
    let seekhead = |info: u64, tracks: u64, cues: u64| {
        let mut b = Vec::new();
        b.extend(seek(ids::INFO, info));
        b.extend(seek(ids::TRACKS, tracks));
        b.extend(seek(ids::CUES, cues));
        let mut out = Vec::new();
        el(&mut out, ids::SEEK_HEAD, &b);
        out
    };
    // Positions are relative to the start of the Segment's payload.
    let sh_len = seekhead(0, 0, 0).len() as u64;
    let info_pos = sh_len;
    let tracks_pos = info_pos + info_el.len() as u64;
    let mut pos = tracks_pos + tracks_el.len() as u64;
    let mut cluster_bytes = Vec::new();
    let mut cues = Vec::new();
    for (ct, body) in &clusters {
        let mut tp = Vec::new();
        uint(&mut tp, 0xF7, 1); // CueTrack
        uint(&mut tp, 0xF1, pos); // CueClusterPosition
        let mut cp = Vec::new();
        uint(&mut cp, 0xB3, *ct); // CueTime
        el(&mut cp, 0xB7, &tp); // CueTrackPositions
        el(&mut cues, 0xBB, &cp); // CuePoint
        let mut c = Vec::new();
        el(&mut c, ids::CLUSTER, body);
        pos += c.len() as u64;
        cluster_bytes.extend(c);
    }
    let cues_pos = pos;
    let mut cues_el = Vec::new();
    el(&mut cues_el, ids::CUES, &cues);

    let mut segment = seekhead(info_pos, tracks_pos, cues_pos);
    segment.extend(info_el);
    segment.extend(tracks_el);
    segment.extend(cluster_bytes);
    segment.extend(cues_el);

    let mut header = Vec::new();
    uint(&mut header, 0x4286, 1); // EBMLVersion
    uint(&mut header, 0x42F7, 1); // EBMLReadVersion
    uint(&mut header, 0x42F2, 4); // EBMLMaxIDLength
    uint(&mut header, 0x42F3, 8); // EBMLMaxSizeLength
    string(&mut header, 0x4282, "webm"); // DocType
    uint(&mut header, 0x4287, 4); // DocTypeVersion
    uint(&mut header, 0x4285, 2); // DocTypeReadVersion
    let mut out = Vec::with_capacity(segment.len() + 64);
    el(&mut out, ids::EBML, &header);
    el(&mut out, ids::SEGMENT, &segment);
    Ok(out)
}

/// Remuxes an Ogg Opus stream (a recording journal) to WebM.
pub fn from_ogg(o: &OggOpus) -> AppResult<Vec<u8>> {
    mux(&o.head, &o.packets, o.end_granule)
}

/// Interleaved 16 kHz samples → Opus → WebM (imports, the self-test file, test fixtures).
pub fn encode_pcm(pcm: &[f32], channels: usize, bitrate: u32) -> AppResult<Vec<u8>> {
    let (head, packets, end) = crate::journal::encode_to_packets(pcm, channels, bitrate)?;
    let packets: Vec<Vec<u8>> = packets.into_iter().map(|(p, _)| p).collect();
    mux(&head, &packets, end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variable_size_integers() {
        let mut v = Vec::new();
        ebml::size(&mut v, 0);
        ebml::size(&mut v, 126);
        ebml::size(&mut v, 127);
        ebml::size(&mut v, 16_382);
        assert_eq!(v, vec![0x80, 0xFE, 0x40, 0x7F, 0x7F, 0xFE]);
        let mut u = Vec::new();
        ebml::uint(&mut u, 0xE7, 0);
        assert_eq!(u, vec![0xE7, 0x81, 0x00]);
    }

    #[test]
    fn writes_the_header_and_the_codec_delay() {
        let pcm: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.03).sin() * 0.2).collect();
        let w = encode_pcm(&pcm, 1, 24_000).unwrap();
        assert_eq!(&w[..4], &[0x1A, 0x45, 0xDF, 0xA3]);
        assert!(w.windows(4).any(|x| x == b"webm"));
        assert!(w.windows(6).any(|x| x == b"A_OPUS"));
        // CodecDelay = 312/48000 s = 6 500 000 ns.
        let delay = [0x56, 0xAA, 0x83, 0x63, 0x2E, 0xA0];
        assert!(w.windows(6).any(|x| x == delay));
        assert_eq!(duration_ms(312 + 16_000 * 3, 312), 1000.0);
    }
}
