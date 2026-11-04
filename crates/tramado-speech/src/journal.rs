// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The recording journal (audio-pipeline §4.3, critique C36): while a lecture is recorded, Rust
//! appends Ogg Opus (RFC 7845, `ogg` 0.9.2) to `data/recordings/<id>.ogg` and keeps its
//! metadata in `data/recordings/<id>.json`. A page is closed about every second and the file
//! is synced every 5 s, so a crash loses about a second (a power cut about five). Recovery cuts
//! a torn file after its last page with a valid CRC and marks that page end-of-stream; the
//! normal stop path (remux to WebM, publish) follows.
//!
//! This module also reads Ogg Opus back (pages → packets), which the remux and the tests use.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use ogg::writing::{PacketWriteEndInfo, PacketWriter};
use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::files;

use crate::encode::{self, Head};
use crate::types::{
    FinishedRecording, FinishedState, ImportInfo, Marker, Pause, PublishedAudio, RecordMode,
    SpeakerTrack,
};

/// Packets per page: 17 × 60 ms ≈ 1 s, the most a crash loses (audio-pipeline §4.3).
pub const PAGE_PACKETS: usize = 17;
/// The logical stream's serial number (any number; one stream per file).
const SERIAL: u32 = 0x7472_6d64;

// ── Ogg CRC (RFC 3533: poly 0x04C11DB7, init 0, unreflected, CRC field zeroed) ─────────────

const fn crc_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut r = (i as u32) << 24;
        let mut k = 0;
        while k < 8 {
            r = if r & 0x8000_0000 != 0 {
                (r << 1) ^ 0x04c1_1db7
            } else {
                r << 1
            };
            k += 1;
        }
        t[i] = r;
        i += 1;
    }
    t
}

static CRC: [u32; 256] = crc_table();

/// The CRC of a page whose CRC field (bytes 22..26) is zero.
pub fn ogg_crc(data: &[u8]) -> u32 {
    data.iter().fold(0u32, |crc, &b| {
        (crc << 8) ^ CRC[(((crc >> 24) as u8) ^ b) as usize]
    })
}

/// One page found in a byte buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Page {
    pub offset: usize,
    pub len: usize,
    pub granule: i64,
    /// The page's last packet continues on the next page (lacing value 255 at the end).
    pub continued: bool,
}

/// Every whole page with a valid CRC, from the start, up to the first that is not.
pub fn whole_pages(b: &[u8]) -> Vec<Page> {
    let mut pages = Vec::new();
    let mut at = 0;
    while at + 27 <= b.len() && &b[at..at + 4] == b"OggS" {
        let nseg = b[at + 26] as usize;
        if at + 27 + nseg > b.len() {
            break;
        }
        let lacing = &b[at + 27..at + 27 + nseg];
        let body: usize = lacing.iter().map(|&x| x as usize).sum();
        let len = 27 + nseg + body;
        if at + len > b.len() {
            break;
        }
        let stored = u32::from_le_bytes([b[at + 22], b[at + 23], b[at + 24], b[at + 25]]);
        let mut page = b[at..at + len].to_vec();
        page[22..26].fill(0);
        if ogg_crc(&page) != stored {
            break;
        }
        let mut g = [0u8; 8];
        g.copy_from_slice(&b[at + 6..at + 14]);
        pages.push(Page {
            offset: at,
            len,
            granule: i64::from_le_bytes(g),
            continued: lacing.last().is_some_and(|&l| l == 255),
        });
        at += len;
    }
    pages
}

/// An Ogg Opus stream read back: the two header packets, the audio packets and the granule of
/// the last page (the real end, pre-skip included, in 48 kHz samples).
#[derive(Debug, Clone)]
pub struct OggOpus {
    pub head: Vec<u8>,
    pub tags: Vec<u8>,
    pub packets: Vec<Vec<u8>>,
    pub end_granule: u64,
}

impl OggOpus {
    pub fn head(&self) -> AppResult<Head> {
        encode::parse_head(&self.head).ok_or_else(|| AppError::invalid("not Ogg Opus"))
    }

    /// Real samples per channel at 16 kHz (the end granule less the pre-skip).
    pub fn samples16(&self) -> AppResult<u64> {
        let h = self.head()?;
        Ok(self.end_granule.saturating_sub(h.preskip48 as u64) / 3)
    }
}

/// Reads the packets of the valid pages of an Ogg Opus file (a torn tail is ignored).
pub fn read_ogg_opus(b: &[u8]) -> AppResult<OggOpus> {
    let mut packets: Vec<Vec<u8>> = Vec::new();
    let mut cur: Vec<u8> = Vec::new();
    let mut end_granule = 0u64;
    for p in whole_pages(b) {
        let page = &b[p.offset..p.offset + p.len];
        let nseg = page[26] as usize;
        let lacing = &page[27..27 + nseg];
        let mut at = 27 + nseg;
        let mut completed = false;
        for &l in lacing {
            cur.extend_from_slice(&page[at..at + l as usize]);
            at += l as usize;
            if l < 255 {
                packets.push(std::mem::take(&mut cur));
                completed = true;
            }
        }
        if completed && p.granule >= 0 {
            end_granule = p.granule as u64;
        }
    }
    if packets.len() < 2 || encode::parse_head(&packets[0]).is_none() {
        return Err(AppError::new(
            Code::SpeechUnsupportedAudio,
            "not an Ogg Opus recording",
        ));
    }
    let mut it = packets.into_iter();
    let head = it.next().unwrap_or_default();
    let tags = it.next().unwrap_or_default();
    Ok(OggOpus {
        head,
        tags,
        packets: it.collect(),
        end_granule,
    })
}

/// What recovery did to a torn journal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recovered {
    pub bytes_before: u64,
    pub bytes_after: u64,
    pub pages: usize,
    pub end_granule: u64,
}

/// Cuts `path` after its last whole page with a valid CRC that ends on a packet boundary,
/// marks that page end-of-stream (flag 0x04) and recomputes its CRC (audio-pipeline §4.3).
pub fn recover(path: &Path) -> AppResult<Recovered> {
    let mut b = fs::read(path)?;
    let before = b.len() as u64;
    let mut pages = whole_pages(&b);
    while pages.last().is_some_and(|p| p.continued) {
        pages.pop();
    }
    let Some(last) = pages.last().copied() else {
        return Err(AppError::new(
            Code::SpeechUnsupportedAudio,
            "the recording journal has no whole page",
        ));
    };
    let end = last.offset + last.len;
    b.truncate(end);
    let page = &mut b[last.offset..end];
    page[5] |= 0x04;
    page[22..26].fill(0);
    let crc = ogg_crc(page);
    page[22..26].copy_from_slice(&crc.to_le_bytes());
    let mut f = OpenOptions::new().write(true).open(path)?;
    f.seek(SeekFrom::Start(last.offset as u64))?;
    f.write_all(&b[last.offset..end])?;
    f.set_len(end as u64)?;
    f.sync_all()?;
    Ok(Recovered {
        bytes_before: before,
        bytes_after: end as u64,
        pages: pages.len(),
        end_granule: last.granule.max(0) as u64,
    })
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────

/// A `File` that counts what was written through it (the recorder's `bytesWritten`).
pub struct CountingFile {
    file: File,
    written: Arc<AtomicU64>,
}

impl Write for CountingFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.file.write(buf)?;
        self.written.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

/// Appends Opus packets to an Ogg file, closing a page every `PAGE_PACKETS` packets.
pub struct OggWriter {
    w: PacketWriter<'static, CountingFile>,
    in_page: usize,
    written: Arc<AtomicU64>,
    sync: File,
}

impl OggWriter {
    /// Creates `path` (it must not exist) and writes the two header pages.
    pub fn create(path: &Path, head: Vec<u8>, tags: Vec<u8>) -> AppResult<Self> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let file = OpenOptions::new().write(true).create_new(true).open(path)?;
        let sync = file.try_clone()?;
        let written = Arc::new(AtomicU64::new(0));
        let mut w = PacketWriter::new(CountingFile {
            file,
            written: written.clone(),
        });
        w.write_packet(head, SERIAL, PacketWriteEndInfo::EndPage, 0)?;
        w.write_packet(tags, SERIAL, PacketWriteEndInfo::EndPage, 0)?;
        Ok(OggWriter {
            w,
            in_page: 0,
            written,
            sync,
        })
    }

    /// Bytes on disk so far (whole pages).
    pub fn written(&self) -> Arc<AtomicU64> {
        self.written.clone()
    }

    /// A second handle to the file, for `sync_data` from another thread.
    pub fn sync_handle(&self) -> AppResult<File> {
        Ok(self.sync.try_clone()?)
    }

    pub fn write(&mut self, packet: Vec<u8>, granule: u64) -> AppResult<()> {
        self.in_page += 1;
        let end = if self.in_page >= PAGE_PACKETS {
            self.in_page = 0;
            PacketWriteEndInfo::EndPage
        } else {
            PacketWriteEndInfo::NormalPacket
        };
        self.w.write_packet(packet, SERIAL, end, granule)?;
        Ok(())
    }

    /// Writes the last packets, the final one ending the stream, and syncs the file.
    pub fn finish(mut self, last: encode::Packets) -> AppResult<()> {
        let n = last.len();
        for (i, (p, g)) in last.into_iter().enumerate() {
            if i + 1 == n {
                self.w
                    .write_packet(p, SERIAL, PacketWriteEndInfo::EndStream, g)?;
            } else {
                self.write(p, g)?;
            }
        }
        let mut f = self.w.into_inner();
        f.flush()?;
        f.file.sync_all()?;
        Ok(())
    }
}

/// Encodes interleaved 16 kHz samples straight into an in-memory Ogg Opus stream (imports,
/// tests and the self-test file go through the same packets as a recording).
pub fn encode_to_packets(
    pcm: &[f32],
    channels: usize,
    bitrate: u32,
) -> AppResult<(Vec<u8>, encode::Packets, u64)> {
    let mut enc = encode::FrameEncoder::new(channels, bitrate)?;
    let head = encode::opus_head(channels as u8, enc.preskip48());
    let mut packets = Vec::new();
    for block in pcm.chunks(encode::FRAME * channels * 16) {
        packets.extend(enc.push(block)?);
    }
    let (rest, end) = enc.finish()?;
    packets.extend(rest);
    Ok((head, packets, end))
}

// ── The journal's metadata file ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JournalState {
    /// Being recorded (a journal found in this state at start-up was torn by a crash).
    Recording,
    Stopped,
    Recovered,
    /// The audio is in the class (or kept privately); reported until `lecture.json` exists.
    Published,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JournalKind {
    Recording,
    Import,
}

/// `data/recordings/<id>.json` (private, never synced).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub format: String,
    pub version: u32,
    pub kind: JournalKind,
    pub recording_id: String,
    pub class_id: String,
    pub title: String,
    pub mode: RecordMode,
    pub language: String,
    pub started_at: String,
    pub started_at_ms: u64,
    pub channels: u8,
    pub bitrate: u32,
    pub preskip: u16,
    pub marker_offset_ms: u64,
    pub speakers: Vec<SpeakerTrack>,
    pub pauses: Vec<Pause>,
    pub markers: Vec<Marker>,
    pub state: JournalState,
    /// Audio time written so far (updated about every 10 s while recording).
    pub ms: u64,
    pub duration_ms: Option<u64>,
    pub recovered_lost_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lecture_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<PublishedAudio>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import: Option<ImportInfo>,
}

pub const JOURNAL_FORMAT: &str = "tramado.recording-journal";

impl Journal {
    pub fn finished(&self) -> FinishedRecording {
        FinishedRecording {
            recording_id: self.recording_id.clone(),
            class_id: self.class_id.clone(),
            title: self.title.clone(),
            mode: self.mode,
            language: self.language.clone(),
            started_at: self.started_at.clone(),
            duration_ms: self.duration_ms.unwrap_or(self.ms),
            channels: self.channels,
            bitrate: self.bitrate,
            speakers: self.speakers.clone(),
            pauses: self.pauses.clone(),
            markers: self.markers.clone(),
            state: if self.state == JournalState::Recovered {
                FinishedState::Recovered
            } else {
                FinishedState::Stopped
            },
            recovered_lost_ms: self.recovered_lost_ms,
            audio: self.audio.clone(),
            import: self.import.clone(),
        }
    }
}

/// Where a recording's private files live.
#[derive(Debug, Clone)]
pub struct JournalPaths {
    pub dir: PathBuf,
}

impl JournalPaths {
    pub fn new(dir: PathBuf) -> Self {
        JournalPaths { dir }
    }

    fn checked(id: &str) -> AppResult<&str> {
        if tramado_base::ids::is_ulid(id) {
            Ok(id)
        } else {
            Err(AppError::invalid("not a recording ID"))
        }
    }

    pub fn ogg(&self, id: &str) -> AppResult<PathBuf> {
        Ok(self.dir.join(format!("{}.ogg", Self::checked(id)?)))
    }

    pub fn json(&self, id: &str) -> AppResult<PathBuf> {
        Ok(self.dir.join(format!("{}.json", Self::checked(id)?)))
    }

    /// The WebM kept on this computer ("transcript only", or before a share mode is chosen).
    pub fn webm(&self, id: &str) -> AppResult<PathBuf> {
        Ok(self.dir.join(format!("{}.webm", Self::checked(id)?)))
    }

    pub fn read(&self, id: &str) -> AppResult<Option<Journal>> {
        match files::read_optional(&self.json(id)?)? {
            Some(b) => Ok(Some(serde_json::from_slice(&b)?)),
            None => Ok(None),
        }
    }

    pub fn write(&self, j: &Journal) -> AppResult<()> {
        files::write_atomic(&self.json(&j.recording_id)?, &serde_json::to_vec_pretty(j)?)
    }

    /// Every journal in the folder (unreadable ones are skipped and logged).
    pub fn all(&self) -> Vec<Journal> {
        let Ok(rd) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            if !tramado_base::ids::is_ulid(id) {
                continue;
            }
            match self.read(id) {
                Ok(Some(j)) => out.push(j),
                Ok(None) => {}
                Err(e) => log::warn!("recording journal {id} unreadable: {e}"),
            }
        }
        out.sort_by(|a, b| a.started_at_ms.cmp(&b.started_at_ms));
        out
    }

    /// Removes the journal, its Ogg file and its private WebM.
    pub fn remove(&self, id: &str) -> AppResult<()> {
        files::remove_file_if_exists(&self.ogg(id)?)?;
        files::remove_file_if_exists(&self.webm(id)?)?;
        files::remove_file_if_exists(&self.json(id)?)?;
        Ok(())
    }
}

/// Reads a whole file (journals are about 11 MB per hour).
pub fn read_all(path: &Path) -> AppResult<Vec<u8>> {
    let mut f = File::open(path)?;
    let mut b = Vec::new();
    f.read_to_end(&mut b)?;
    Ok(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32) -> Vec<f32> {
        (0..(secs * 16_000.0) as usize)
            .map(|i| (i as f32 * 0.05).sin() * 0.3)
            .collect()
    }

    fn write_journal(path: &Path, secs: f32) -> u64 {
        let (head, packets, end) = encode_to_packets(&tone(secs), 1, 24_000).unwrap();
        let mut w = OggWriter::create(path, head, encode::opus_tags(&[])).unwrap();
        let n = packets.len();
        let mut last = Vec::new();
        for (i, (p, g)) in packets.into_iter().enumerate() {
            if i + 2 >= n {
                last.push((p, g));
            } else {
                w.write(p, g).unwrap();
            }
        }
        w.finish(last).unwrap();
        end
    }

    #[test]
    fn crc_matches_the_bitwise_definition() {
        fn slow(data: &[u8]) -> u32 {
            let mut crc = 0u32;
            for &b in data {
                crc ^= (b as u32) << 24;
                for _ in 0..8 {
                    crc = if crc & 0x8000_0000 != 0 {
                        (crc << 1) ^ 0x04c1_1db7
                    } else {
                        crc << 1
                    };
                }
            }
            crc
        }
        let data: Vec<u8> = (0..1000u32).map(|i| (i * 31 % 251) as u8).collect();
        assert_eq!(ogg_crc(&data), slow(&data));
    }

    #[test]
    fn writes_and_reads_back_an_ogg_opus_stream() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("r.ogg");
        let end = write_journal(&p, 3.0);
        let b = fs::read(&p).unwrap();
        let o = read_ogg_opus(&b).unwrap();
        assert_eq!(o.end_granule, end);
        assert_eq!(o.samples16().unwrap(), 48_000);
        // 50 frames of 60 ms + the padded silence frame.
        assert_eq!(o.packets.len(), 51);
        let pages = whole_pages(&b);
        // Two header pages, then a page about every second.
        assert_eq!(pages.len(), 2 + 51usize.div_ceil(PAGE_PACKETS));
        assert_eq!(b[pages.last().unwrap().offset + 5] & 0x04, 0x04);
    }

    #[test]
    fn journal_recovers_torn_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("torn.ogg");
        write_journal(&p, 20.0);
        let full = fs::read(&p).unwrap();
        // Tear at an arbitrary byte inside the audio, as a crash would.
        let tear = full.len() * 5 / 9 + 17;
        fs::write(&p, &full[..tear]).unwrap();
        let r = recover(&p).unwrap();
        assert!(r.bytes_after < tear as u64 && r.bytes_after > 0);
        let b = fs::read(&p).unwrap();
        let pages = whole_pages(&b);
        // Every page survives with a valid CRC, and the last one ends the stream.
        assert_eq!(pages.len(), r.pages);
        assert_eq!(pages.iter().map(|p| p.len).sum::<usize>(), b.len());
        let last = pages.last().unwrap();
        assert_eq!(b[last.offset + 5] & 0x04, 0x04);
        let o = read_ogg_opus(&b).unwrap();
        // About 5/9 of 20 s, cut on a page (about a second).
        let secs = o.samples16().unwrap() as f64 / 16_000.0;
        assert!(secs > 9.0 && secs < 12.0, "{secs}");
        assert_eq!(o.packets.len() as u64 * 960, o.samples16().unwrap() + 104);
        // Recovering again changes nothing.
        let again = recover(&p).unwrap();
        assert_eq!(again.bytes_after, r.bytes_after);
        // A file torn inside its headers cannot be recovered into a recording.
        fs::write(&p, &full[..30]).unwrap();
        assert_eq!(
            recover(&p).unwrap_err().code(),
            Code::SpeechUnsupportedAudio
        );
    }
}
