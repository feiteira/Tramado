//! Throwaway lab: 16 kHz WAV -> Opus-in-Ogg (RFC 7845) -> 16 kHz WAV, with several Opus
//! implementations behind cargo features, plus a crash-recovery demo for a torn Ogg file.
//!
//!   opuslab gen OUT.wav SECS
//!   opuslab enc BACKEND IN.wav OUT.opus BPS [force-stereo]
//!   opuslab dec BACKEND IN.opus OUT.wav
//!   opuslab cmp REF.wav TEST.wav
//!   opuslab recover IN.opus OUT.opus      (cut to the last whole page, mark it end-of-stream)

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::time::Instant;

use ogg::reading::PacketReader;
use ogg::writing::{PacketWriteEndInfo, PacketWriter};

const RATE: u32 = 16_000;
/// 20 ms at 16 kHz.
const FRAME: usize = 320;
/// The longest Opus packet decodes to 120 ms.
const MAX_FRAME: usize = 1920;
/// One Ogg page a second: a crash loses at most about a second.
const PAGE_PACKETS: usize = 50;

type Res<T> = Result<T, String>;

trait Enc {
    /// Interleaved f32 in, one packet out.
    fn encode(&mut self, pcm: &[f32], out: &mut [u8]) -> Res<usize>;
    /// RFC 7845 pre-skip, in 48 kHz samples.
    fn preskip48(&mut self) -> u16;
}

trait Dec {
    /// One packet in, interleaved f32 out; returns samples per channel.
    fn decode(&mut self, pkt: &[u8], out: &mut [f32]) -> Res<usize>;
}

// ── libopus 1.6.1 (opusic-c / opusic-sys, built with cmake) ──────────────────────────────
#[cfg(feature = "libopus")]
mod libopus {
    use super::*;
    use opusic_c::{Application, Bitrate, Channels, Decoder, Encoder, SampleRate, Signal};
    pub struct E(Encoder);
    pub struct D(Decoder);
    fn ch(n: usize) -> Channels {
        if n == 2 { Channels::Stereo } else { Channels::Mono }
    }
    pub fn enc(channels: usize, bps: u32, force_stereo: bool) -> Res<E> {
        let mut e = Encoder::new(ch(channels), SampleRate::Hz16000, Application::Voip)
            .map_err(|e| format!("{e:?}"))?;
        e.set_bitrate(Bitrate::Value(bps)).map_err(|e| format!("{e:?}"))?;
        e.set_vbr(true).map_err(|e| format!("{e:?}"))?;
        e.set_signal(Signal::Voice).map_err(|e| format!("{e:?}"))?;
        e.set_complexity(10).map_err(|e| format!("{e:?}"))?;
        if force_stereo && channels == 2 {
            // Below ~30 kbps libopus may fold stereo to mono: that would merge the two sides
            // of an online class.
            e.set_force_channels(Some(Channels::Stereo)).map_err(|e| format!("{e:?}"))?;
        }
        Ok(E(e))
    }
    impl Enc for E {
        fn encode(&mut self, pcm: &[f32], out: &mut [u8]) -> Res<usize> {
            self.0.encode_float_to_slice(pcm, out).map_err(|e| format!("{e:?}"))
        }
        fn preskip48(&mut self) -> u16 {
            // Reported at the encoder's rate (16 kHz); RFC 7845 counts at 48 kHz.
            (self.0.get_look_ahead().unwrap_or(104) * 3) as u16
        }
    }
    pub fn dec(channels: usize) -> Res<D> {
        Ok(D(Decoder::new(ch(channels), SampleRate::Hz16000).map_err(|e| format!("{e:?}"))?))
    }
    impl Dec for D {
        fn decode(&mut self, pkt: &[u8], out: &mut [f32]) -> Res<usize> {
            self.0.decode_float_to_slice(pkt, out, false).map_err(|e| format!("{e:?}"))
        }
    }
    pub fn version() -> &'static str {
        opusic_c::version()
    }
}

// ── opus-rs (pure Rust, port of libopus 1.6) ─────────────────────────────────────────────
#[cfg(feature = "opusrs")]
mod opusrs {
    use super::*;
    use opus_rs::{Application, OpusDecoder, OpusEncoder};
    pub struct E(OpusEncoder, usize);
    pub struct D(OpusDecoder, usize);
    pub fn enc(channels: usize, bps: u32) -> Res<E> {
        let mut e = OpusEncoder::new(RATE as i32, channels, Application::Voip)?;
        e.bitrate_bps = bps as i32;
        e.complexity = 10;
        e.use_cbr = false;
        Ok(E(e, channels))
    }
    impl Enc for E {
        fn encode(&mut self, pcm: &[f32], out: &mut [u8]) -> Res<usize> {
            self.0.encode(pcm, pcm.len() / self.1, out).map_err(str::to_string)
        }
        fn preskip48(&mut self) -> u16 {
            312
        }
    }
    pub fn dec(channels: usize) -> Res<D> {
        Ok(D(OpusDecoder::new(RATE as i32, channels)?, channels))
    }
    impl Dec for D {
        fn decode(&mut self, pkt: &[u8], out: &mut [f32]) -> Res<usize> {
            let n = out.len() / self.1;
            self.0.decode(pkt, n, out).map_err(str::to_string)
        }
    }
}

// ── rusty-opus (pure Rust) ───────────────────────────────────────────────────────────────
#[cfg(feature = "rusty")]
mod rusty {
    use super::*;
    use rusty_opus::{Application, OpusDecoder, OpusEncoder};
    pub struct E(OpusEncoder, usize);
    pub struct D(OpusDecoder, usize);
    pub fn enc(channels: usize, bps: u32) -> Res<E> {
        let mut e = OpusEncoder::new(RATE as i32, channels, Application::Voip).map_err(|e| format!("{e:?}"))?;
        e.bitrate_bps = bps as i32;
        e.complexity = 10;
        e.use_cbr = false;
        Ok(E(e, channels))
    }
    impl Enc for E {
        fn encode(&mut self, pcm: &[f32], out: &mut [u8]) -> Res<usize> {
            self.0.encode(pcm, pcm.len() / self.1, out).map_err(|e| format!("{e:?}"))
        }
        fn preskip48(&mut self) -> u16 {
            312
        }
    }
    pub fn dec(channels: usize) -> Res<D> {
        Ok(D(OpusDecoder::new(RATE as i32, channels).map_err(|e| format!("{e:?}"))?, channels))
    }
    impl Dec for D {
        fn decode(&mut self, pkt: &[u8], out: &mut [f32]) -> Res<usize> {
            let n = out.len() / self.1;
            self.0.decode(pkt, n, out).map_err(|e| format!("{e:?}"))
        }
    }
}

// ── opus-decoder (pure Rust, decode only, forbid(unsafe)) ────────────────────────────────
#[cfg(feature = "opusdec")]
mod opusdec {
    use super::*;
    pub struct D(opus_decoder::OpusDecoder);
    pub fn dec(channels: usize) -> Res<D> {
        Ok(D(opus_decoder::OpusDecoder::new(RATE, channels).map_err(|e| format!("{e:?}"))?))
    }
    impl Dec for D {
        fn decode(&mut self, pkt: &[u8], out: &mut [f32]) -> Res<usize> {
            self.0.decode_float(pkt, out, false).map_err(|e| format!("{e:?}"))
        }
    }
}

// ── mousiki (pure Rust port of libopus) ──────────────────────────────────────────────────
#[cfg(feature = "mousiki")]
mod mousiki_impl {
    use super::*;
    use mousiki::{Application, Bitrate, Channels, Decoder, Encoder};
    pub struct E(Encoder, Vec<i16>);
    pub struct D(Decoder, Vec<i16>, usize);
    fn ch(n: usize) -> Channels {
        if n == 2 { Channels::Stereo } else { Channels::Mono }
    }
    pub fn enc(channels: usize, bps: u32) -> Res<E> {
        let e = Encoder::builder(RATE, ch(channels), Application::Voip)
            .bitrate(Bitrate::Bits(bps as i32))
            .build()
            .map_err(|e| format!("{e:?}"))?;
        Ok(E(e, Vec::new()))
    }
    impl Enc for E {
        fn encode(&mut self, pcm: &[f32], out: &mut [u8]) -> Res<usize> {
            self.1.clear();
            self.1.extend(pcm.iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16));
            self.0.encode(&self.1, out).map_err(|e| format!("{e:?}"))
        }
        fn preskip48(&mut self) -> u16 {
            312
        }
    }
    pub fn dec(channels: usize) -> Res<D> {
        Ok(D(Decoder::new(RATE, ch(channels)).map_err(|e| format!("{e:?}"))?, Vec::new(), channels))
    }
    impl Dec for D {
        fn decode(&mut self, pkt: &[u8], out: &mut [f32]) -> Res<usize> {
            self.1.resize(out.len(), 0);
            let n = self.0.decode(pkt, &mut self.1, false).map_err(|e| format!("{e:?}"))?;
            for (o, s) in out.iter_mut().zip(&self.1[..n * self.2]) {
                *o = *s as f32 / 32768.0;
            }
            Ok(n)
        }
    }
}

fn make_enc(backend: &str, channels: usize, bps: u32, force_stereo: bool) -> Res<Box<dyn Enc>> {
    let _ = (channels, bps, force_stereo);
    match backend {
        #[cfg(feature = "libopus")]
        "libopus" => Ok(Box::new(libopus::enc(channels, bps, force_stereo)?)),
        #[cfg(feature = "opusrs")]
        "opusrs" => Ok(Box::new(opusrs::enc(channels, bps)?)),
        #[cfg(feature = "rusty")]
        "rusty" => Ok(Box::new(rusty::enc(channels, bps)?)),
        #[cfg(feature = "mousiki")]
        "mousiki" => Ok(Box::new(mousiki_impl::enc(channels, bps)?)),
        other => Err(format!("encoder {other} not built in")),
    }
}

fn make_dec(backend: &str, channels: usize) -> Res<Box<dyn Dec>> {
    let _ = channels;
    match backend {
        #[cfg(feature = "libopus")]
        "libopus" => Ok(Box::new(libopus::dec(channels)?)),
        #[cfg(feature = "opusrs")]
        "opusrs" => Ok(Box::new(opusrs::dec(channels)?)),
        #[cfg(feature = "rusty")]
        "rusty" => Ok(Box::new(rusty::dec(channels)?)),
        #[cfg(feature = "opusdec")]
        "opusdec" => Ok(Box::new(opusdec::dec(channels)?)),
        #[cfg(feature = "mousiki")]
        "mousiki" => Ok(Box::new(mousiki_impl::dec(channels)?)),
        other => Err(format!("decoder {other} not built in")),
    }
}

// ── Ogg Opus (RFC 7845) ──────────────────────────────────────────────────────────────────

fn opus_head(channels: u8, preskip: u16, input_rate: u32) -> Vec<u8> {
    let mut h = Vec::with_capacity(19);
    h.extend_from_slice(b"OpusHead");
    h.push(1); // version
    h.push(channels);
    h.extend_from_slice(&preskip.to_le_bytes());
    h.extend_from_slice(&input_rate.to_le_bytes()); // informational only
    h.extend_from_slice(&0i16.to_le_bytes()); // output gain
    h.push(0); // channel mapping family 0: mono or stereo (L, R)
    h
}

fn opus_tags(vendor: &str, comments: &[String]) -> Vec<u8> {
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

fn read_wav(path: &str) -> Res<(Vec<f32>, usize)> {
    let mut r = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = r.spec();
    if spec.sample_rate != RATE {
        return Err(format!("expected 16 kHz, got {}", spec.sample_rate));
    }
    let s: Vec<f32> = r
        .samples::<i16>()
        .map(|s| s.map(|v| v as f32 / 32768.0))
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok((s, spec.channels as usize))
}

fn write_wav(path: &str, pcm: &[f32], channels: usize) -> Res<()> {
    let spec = hound::WavSpec {
        channels: channels as u16,
        sample_rate: RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for s in pcm {
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())
}

fn encode_file(backend: &str, input: &str, output: &str, bps: u32, force_stereo: bool) -> Res<()> {
    let (pcm, channels) = read_wav(input)?;
    let frames_total = pcm.len() / channels;
    let mut enc = make_enc(backend, channels, bps, force_stereo)?;
    let preskip = enc.preskip48();
    let file = BufWriter::new(File::create(output).map_err(|e| e.to_string())?);
    let mut w = PacketWriter::new(file);
    let serial = 0x7261_6d61; // any number; one logical stream
    w.write_packet(opus_head(channels as u8, preskip, RATE), serial, PacketWriteEndInfo::EndPage, 0)
        .map_err(|e| e.to_string())?;
    let tags = opus_tags(
        &format!("opuslab {backend}"),
        &["TRAMADO_KIND=lecture".to_string(), "DATE=2026-11-03".to_string()],
    );
    w.write_packet(tags, serial, PacketWriteEndInfo::EndPage, 0).map_err(|e| e.to_string())?;

    let started = Instant::now();
    // OPUSLAB_FRAME=960 -> 60 ms packets at 16 kHz (fewer packets, less container overhead).
    let frame_len: usize = std::env::var("OPUSLAB_FRAME").ok().and_then(|v| v.parse().ok()).unwrap_or(FRAME);
    let mut packet = vec![0u8; 4000];
    let mut frame = vec![0f32; frame_len * channels];
    // One extra frame of silence: the encoder runs `preskip` behind its input, so without it
    // the last ~6.5 ms would never come out. The end-trim granule cuts the padding again.
    let n_packets = frames_total.div_ceil(frame_len) + 1;
    let mut bytes = 0usize;
    for i in 0..n_packets {
        let a = (i * frame_len * channels).min(pcm.len());
        let b = ((i + 1) * frame_len * channels).min(pcm.len());
        frame.fill(0.0); // the last frames are padded with silence; the granule trims it
        frame[..b - a].copy_from_slice(&pcm[a..b]);
        let n = enc.encode(&frame, &mut packet)?;
        bytes += n;
        let last = i + 1 == n_packets;
        // Granule: 48 kHz samples decoded up to the end of this packet, pre-skip included.
        let granule = if last {
            preskip as u64 + frames_total as u64 * 3
        } else {
            preskip as u64 + ((i + 1) * frame_len) as u64 * 3
        };
        let end = if last {
            PacketWriteEndInfo::EndStream
        } else if (i + 1) % (PAGE_PACKETS * FRAME / frame_len).max(1) == 0 {
            PacketWriteEndInfo::EndPage
        } else {
            PacketWriteEndInfo::NormalPacket
        };
        w.write_packet(packet[..n].to_vec(), serial, end, granule).map_err(|e| e.to_string())?;
    }
    let mut f = w.into_inner();
    f.flush().map_err(|e| e.to_string())?;
    let el = started.elapsed().as_secs_f64();
    let secs = frames_total as f64 / RATE as f64;
    let size = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
    println!(
        "enc {backend}: {secs:.1} s audio, {ch} ch, preskip {preskip}, {n_packets} packets, {bytes} B payload, {size} B file ({:.1} kbps, {:.2} MB/h), {el:.2} s ({:.0}x real time)",
        size as f64 * 8.0 / secs / 1000.0,
        size as f64 / secs * 3600.0 / 1e6,
        secs / el,
        ch = channels
    );
    Ok(())
}

fn decode_file(backend: &str, input: &str, output: &str) -> Res<()> {
    let mut r = PacketReader::new(BufReader::new(File::open(input).map_err(|e| e.to_string())?));
    let head = r.read_packet().map_err(|e| e.to_string())?.ok_or("empty")?;
    if !head.data.starts_with(b"OpusHead") || head.data.len() < 19 {
        return Err("not Ogg Opus".into());
    }
    let channels = head.data[9] as usize;
    let preskip = u16::from_le_bytes([head.data[10], head.data[11]]) as usize;
    let _tags = r.read_packet().map_err(|e| e.to_string())?.ok_or("no tags")?;
    let mut dec = make_dec(backend, channels)?;
    let started = Instant::now();
    let mut out: Vec<f32> = Vec::new();
    let mut buf = vec![0f32; MAX_FRAME * channels];
    let mut last_granule = 0u64;
    let mut bad = 0;
    while let Some(p) = r.read_packet().map_err(|e| e.to_string())? {
        match dec.decode(&p.data, &mut buf) {
            Ok(n) => out.extend_from_slice(&buf[..n * channels]),
            Err(_) => bad += 1,
        }
        last_granule = p.absgp_page();
    }
    // Pre-skip off the front (48 kHz units -> 16 kHz), the padding off the end.
    let skip = preskip / 3 * channels;
    let keep = (last_granule.saturating_sub(preskip as u64) / 3) as usize * channels;
    let pcm: Vec<f32> = out.into_iter().skip(skip).take(keep).collect();
    let el = started.elapsed().as_secs_f64();
    let secs = pcm.len() as f64 / channels as f64 / RATE as f64;
    println!("dec {backend}: {secs:.2} s audio, {channels} ch, {bad} bad packets, {el:.2} s ({:.0}x real time)", secs / el);
    write_wav(output, &pcm, channels)
}

// ── Comparison ───────────────────────────────────────────────────────────────────────────

fn chan(x: &[f32], channels: usize, c: usize) -> Vec<f32> {
    x.iter().skip(c).step_by(channels).copied().collect()
}

fn corr(a: &[f32], b: &[f32]) -> f64 {
    let n = a.len().min(b.len());
    let (mut ab, mut aa, mut bb) = (0f64, 0f64, 0f64);
    for i in 0..n {
        ab += a[i] as f64 * b[i] as f64;
        aa += a[i] as f64 * a[i] as f64;
        bb += b[i] as f64 * b[i] as f64;
    }
    ab / (aa.sqrt() * bb.sqrt()).max(1e-12)
}

fn snr(a: &[f32], b: &[f32]) -> f64 {
    let n = a.len().min(b.len());
    let (mut s, mut e) = (0f64, 0f64);
    for i in 0..n {
        s += (a[i] as f64).powi(2);
        e += (a[i] as f64 - b[i] as f64).powi(2);
    }
    10.0 * (s / e.max(1e-12)).log10()
}

fn compare(reference: &str, test: &str) -> Res<()> {
    let (a, ca) = read_wav(reference)?;
    let (b, cb) = read_wav(test)?;
    println!("ref {} frames, test {} frames", a.len() / ca, b.len() / cb);
    for c in 0..ca.min(cb) {
        let x = chan(&a, ca, c);
        let y = chan(&b, cb, c);
        // Best lag in ±400 samples over the first 10 s.
        let win = (10 * RATE as usize).min(x.len()).min(y.len()).saturating_sub(800);
        let mut best = (0i64, -1.0f64);
        for lag in -400i64..=400 {
            let (xs, ys) = if lag >= 0 {
                (&x[400..400 + win], &y[(400 + lag) as usize..(400 + lag) as usize + win])
            } else {
                (&x[400..400 + win], &y[(400 + lag) as usize..(400 + lag) as usize + win])
            };
            let r = corr(xs, ys);
            if r > best.1 {
                best = (lag, r);
            }
        }
        let n = x.len().min(y.len());
        println!(
            "  ch{c}: best lag {} samples (corr {:.4}); at lag 0: corr {:.4}, SNR {:.1} dB",
            best.0,
            best.1,
            corr(&x[..n], &y[..n]),
            snr(&x[..n], &y[..n])
        );
    }
    if ca == 2 && cb == 2 {
        // Crosstalk: how much of the left source ends up in the right output and vice versa.
        let (l, r) = (chan(&a, 2, 0), chan(&a, 2, 1));
        let (lo, ro) = (chan(&b, 2, 0), chan(&b, 2, 1));
        println!(
            "  crosstalk: corr(L_in, R_out) {:.4}, corr(R_in, L_out) {:.4}, corr(L_in, L_out) {:.4}, corr(R_in, R_out) {:.4}",
            corr(&l, &ro),
            corr(&r, &lo),
            corr(&l, &lo),
            corr(&r, &ro)
        );
    }
    Ok(())
}

// ── Crash recovery: cut a torn Ogg file to its last whole page and mark it end-of-stream ──

fn ogg_crc(data: &[u8]) -> u32 {
    let mut crc = 0u32;
    for &b in data {
        crc ^= (b as u32) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 { (crc << 1) ^ 0x04c1_1db7 } else { crc << 1 };
        }
    }
    crc
}

/// Returns (offset, length) of every whole page with a valid CRC, from the start.
fn whole_pages(b: &[u8]) -> Vec<(usize, usize)> {
    let mut pages = Vec::new();
    let mut at = 0;
    while at + 27 <= b.len() && &b[at..at + 4] == b"OggS" {
        let nseg = b[at + 26] as usize;
        if at + 27 + nseg > b.len() {
            break;
        }
        let body: usize = b[at + 27..at + 27 + nseg].iter().map(|&x| x as usize).sum();
        let len = 27 + nseg + body;
        if at + len > b.len() {
            break;
        }
        let mut page = b[at..at + len].to_vec();
        let stored = u32::from_le_bytes([page[22], page[23], page[24], page[25]]);
        page[22..26].fill(0);
        if ogg_crc(&page) != stored {
            break;
        }
        pages.push((at, len));
        at += len;
    }
    pages
}

fn recover(input: &str, output: &str) -> Res<()> {
    let mut b = Vec::new();
    File::open(input).and_then(|mut f| f.read_to_end(&mut b)).map_err(|e| e.to_string())?;
    let pages = whole_pages(&b);
    let &(off, len) = pages.last().ok_or("no whole page")?;
    let mut out = b[..off + len].to_vec();
    let last = &mut out[off..off + len];
    // A page whose last packet continues on the next page (lacing value 255 at the end) is
    // dropped too; here pages always end on a packet, so set EOS and recompute the CRC.
    last[5] |= 0x04;
    last[22..26].fill(0);
    let crc = ogg_crc(last);
    last[22..26].copy_from_slice(&crc.to_le_bytes());
    let granule = i64::from_le_bytes(last[6..14].try_into().unwrap());
    std::fs::write(output, &out).map_err(|e| e.to_string())?;
    println!(
        "recover: {} B in, {} whole pages, kept {} B, last granule {} (~{:.2} s)",
        b.len(),
        pages.len(),
        out.len(),
        granule,
        granule as f64 / 48_000.0
    );
    Ok(())
}

// ── Opus packet TOC (RFC 6716 §3.1): how many 48 kHz samples a packet decodes to ──────────

fn opus_packet_samples48(p: &[u8]) -> Option<u32> {
    let toc = *p.first()?;
    let config = toc >> 3;
    // Frame size in 48 kHz samples: SILK 10/20/40/60 ms, Hybrid 10/20 ms, CELT 2.5/5/10/20 ms.
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

// ── WebM (Matroska) writer for one Opus track: the share/playback format ───────────────────
//
// Built in memory (an hour at 24 kbps is ~11 MB), so every size is known and the file is
// written once, complete: SeekHead -> Info (with Duration) -> Tracks -> Clusters -> Cues.

mod ebml {
    pub fn id(out: &mut Vec<u8>, id: u32) {
        let b = id.to_be_bytes();
        let skip = b.iter().position(|&x| x != 0).unwrap_or(3);
        out.extend_from_slice(&b[skip..]);
    }
    pub fn size(out: &mut Vec<u8>, n: u64) {
        // Smallest vint that holds n (all-ones is reserved for "unknown").
        for len in 1..=8u32 {
            if n < (1u64 << (7 * len)) - 1 {
                let v = n | (1u64 << (7 * len));
                out.extend_from_slice(&v.to_be_bytes()[(8 - len) as usize..]);
                return;
            }
        }
        panic!("too big");
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
    /// Fixed 8-byte unsigned: lets positions be filled in without changing any size.
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

/// (Ogg granule-free) packets + OpusHead in, a complete WebM file out.
fn webm_from_packets(head: &[u8], packets: &[Vec<u8>], end_granule: u64) -> Vec<u8> {
    use ebml::*;
    let channels = head[9] as u64;
    let preskip = u16::from_le_bytes([head[10], head[11]]) as u64;
    let ns = |samples48: u64| samples48 * 1_000_000_000 / 48_000;

    // Clusters of ~5 s. Block times count decoded samples from 0, pre-skip included: readers
    // subtract CodecDelay themselves (ffmpeg then reports the first packet at -7 ms).
    let mut clusters: Vec<(u64, Vec<u8>)> = Vec::new(); // (cluster time ms, bytes)
    let mut at48: u64 = 0;
    let mut cur: Option<(u64, Vec<u8>)> = None;
    let total48: u64 = packets.iter().map(|p| opus_packet_samples48(p).unwrap_or(960) as u64).sum();
    for (k, p) in packets.iter().enumerate() {
        let t_ms = (at48 as f64 / 48.0).round() as i64;
        if cur.as_ref().is_none_or(|(ct, _)| t_ms - *ct as i64 >= 5_000) {
            if let Some(c) = cur.take() {
                clusters.push(c);
            }
            let ct = t_ms.max(0) as u64;
            let mut body = Vec::new();
            uint(&mut body, 0xE7, ct); // Timestamp
            cur = Some((ct, body));
        }
        let (ct, body) = cur.as_mut().unwrap();
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
        at48 += opus_packet_samples48(p).unwrap_or(960) as u64;
    }
    if let Some(c) = cur.take() {
        clusters.push(c);
    }
    let duration_ms = (end_granule.saturating_sub(preskip)) as f64 / 48.0;

    let mut info = Vec::new();
    uint(&mut info, 0x2AD7B1, 1_000_000); // TimestampScale: 1 ms
    float(&mut info, 0x4489, duration_ms); // Duration (in TimestampScale units)
    string(&mut info, 0x4D80, "opuslab"); // MuxingApp
    string(&mut info, 0x5741, "opuslab"); // WritingApp
    let mut info_el = Vec::new();
    el(&mut info_el, 0x1549A966, &info);

    let mut audio = Vec::new();
    float(&mut audio, 0xB5, 48_000.0); // SamplingFrequency: Opus always decodes at 48 kHz
    uint(&mut audio, 0x9F, channels);
    let mut entry = Vec::new();
    uint(&mut entry, 0xD7, 1); // TrackNumber
    uint(&mut entry, 0x73C5, 1); // TrackUID
    uint(&mut entry, 0x83, 2); // TrackType: audio
    uint(&mut entry, 0x9C, 0); // FlagLacing
    string(&mut entry, 0x86, "A_OPUS");
    el(&mut entry, 0x63A2, head); // CodecPrivate: the OpusHead
    uint(&mut entry, 0x56AA, ns(preskip)); // CodecDelay (ns)
    uint(&mut entry, 0x56BB, 80_000_000); // SeekPreRoll: 80 ms
    el(&mut entry, 0xE1, &audio);
    let mut tracks = Vec::new();
    el(&mut tracks, 0xAE, &entry);
    let mut tracks_el = Vec::new();
    el(&mut tracks_el, 0x1654AE6B, &tracks);

    let seek = |target: u32, pos: u64| {
        let mut s = Vec::new();
        let mut idb = Vec::new();
        id(&mut idb, target);
        el(&mut s, 0x53AB, &idb);
        uint8(&mut s, 0x53AC, pos);
        let mut out = Vec::new();
        el(&mut out, 0x4DBB, &s);
        out
    };
    let seekhead = |info: u64, tracks: u64, cues: u64| {
        let mut b = Vec::new();
        b.extend(seek(0x1549A966, info));
        b.extend(seek(0x1654AE6B, tracks));
        b.extend(seek(0x1C53BB6B, cues));
        let mut out = Vec::new();
        el(&mut out, 0x114D9B74, &b);
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
        el(&mut cp, 0xB7, &tp);
        el(&mut cues, 0xBB, &cp);
        let mut c = Vec::new();
        el(&mut c, 0x1F43B675, body);
        pos += c.len() as u64;
        cluster_bytes.extend(c);
    }
    let cues_pos = pos;
    let mut cues_el = Vec::new();
    el(&mut cues_el, 0x1C53BB6B, &cues);

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
    let mut out = Vec::new();
    el(&mut out, 0x1A45DFA3, &header);
    el(&mut out, 0x18538067, &segment);
    out
}

fn ogg_to_webm(input: &str, output: &str) -> Res<()> {
    let started = Instant::now();
    let mut r = PacketReader::new(BufReader::new(File::open(input).map_err(|e| e.to_string())?));
    let head = r.read_packet().map_err(|e| e.to_string())?.ok_or("empty")?.data;
    if !head.starts_with(b"OpusHead") {
        return Err("not Ogg Opus".into());
    }
    let _tags = r.read_packet().map_err(|e| e.to_string())?;
    let mut packets = Vec::new();
    let mut end = 0;
    while let Some(p) = r.read_packet().map_err(|e| e.to_string())? {
        end = p.absgp_page();
        packets.push(p.data);
    }
    let bytes = webm_from_packets(&head, &packets, end);
    std::fs::write(output, &bytes).map_err(|e| e.to_string())?;
    println!(
        "remux: {} packets, {} B Ogg -> {} B WebM in {:.3} s",
        packets.len(),
        std::fs::metadata(input).map(|m| m.len()).unwrap_or(0),
        bytes.len(),
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

/// The transcription path for a shared file: symphonia demuxes (Ogg or WebM), libopus decodes
/// straight to 16 kHz, and symphonia's trim_start/trim_end (from pre-skip/CodecDelay and the
/// end granule/DiscardPadding) are honoured.
#[cfg(all(feature = "symph", feature = "libopus"))]
fn symph_decode(input: &str, output: &str) -> Res<()> {
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::{FormatOptions, TrackType};
    use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
    use symphonia::core::meta::MetadataOptions;
    let started = Instant::now();
    let file = File::open(input).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(input).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| e.to_string())?;
    let track = format.default_track(TrackType::Audio).ok_or("no audio track")?;
    let tid = track.id;
    let params = track.codec_params.as_ref().and_then(|p| p.audio()).ok_or("no audio params")?.clone();
    let extra = params.extra_data.clone().unwrap_or_default();
    let channels = if extra.len() >= 19 && extra.starts_with(b"OpusHead") { extra[9] as usize } else { 1 };
    println!(
        "symphonia: codec {:?}, extra_data {} B, channels {channels}, time_base {:?}, num_frames {:?}",
        params.codec,
        extra.len(),
        track.time_base,
        track.num_frames
    );
    // symphonia 0.6 does not apply Opus pre-skip (nor WebM DiscardPadding): read it from the
    // OpusHead (CodecPrivate / first Ogg packet) and drop it here.
    let preskip16 = if extra.len() >= 19 { u16::from_le_bytes([extra[10], extra[11]]) as usize / 3 } else { 0 };
    let mut dec = make_dec("libopus", channels)?;
    let mut buf = vec![0f32; MAX_FRAME * channels];
    let mut out = Vec::new();
    let (mut n, mut trim_s, mut trim_e) = (0u64, 0u64, 0u64);
    while let Some(p) = format.next_packet().map_err(|e| e.to_string())? {
        if p.track_id != tid {
            continue;
        }
        let got = dec.decode(&p.data, &mut buf)?;
        // Trims count in the track's time base (48 kHz for Opus); we decode at 16 kHz.
        let ts = (p.trim_start.get() / 3) as usize;
        let te = (p.trim_end.get() / 3) as usize;
        trim_s += p.trim_start.get();
        trim_e += p.trim_end.get();
        let a = ts.min(got);
        let b = got.saturating_sub(te).max(a);
        out.extend_from_slice(&buf[a * channels..b * channels]);
        n += 1;
    }
    out.drain(..(preskip16 * channels).min(out.len()));
    println!(
        "symphonia: {n} packets, trim_start {trim_s} trim_end {trim_e} (48 kHz samples), {:.2} s decoded in {:.2} s",
        out.len() as f64 / channels as f64 / RATE as f64,
        started.elapsed().as_secs_f64()
    );
    write_wav(output, &out, channels)
}

fn gen(output: &str, secs: f32) -> Res<()> {
    // A 440 Hz tone, a 200->4000 Hz sweep and some noise: not speech, just to prove the path.
    let n = (secs * RATE as f32) as usize;
    let mut seed = 0x1234_5678u32;
    let pcm: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f32 / RATE as f32;
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let noise = (seed as f32 / u32::MAX as f32 - 0.5) * 0.02;
            let f = 200.0 + 3800.0 * (t / secs);
            0.3 * (2.0 * std::f32::consts::PI * 440.0 * t).sin()
                + 0.2 * (2.0 * std::f32::consts::PI * f * t).sin()
                + noise
        })
        .collect();
    write_wav(output, &pcm, 1)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let r = match a.get(1).map(String::as_str) {
        Some("gen") => gen(&a[2], a[3].parse().unwrap()),
        Some("enc") => encode_file(&a[2], &a[3], &a[4], a[5].parse().unwrap(), a.get(6).is_some_and(|s| s == "force-stereo")),
        Some("dec") => decode_file(&a[2], &a[3], &a[4]),
        Some("cmp") => compare(&a[2], &a[3]),
        Some("recover") => recover(&a[2], &a[3]),
        Some("webm") => ogg_to_webm(&a[2], &a[3]),
        #[cfg(all(feature = "symph", feature = "libopus"))]
        Some("sdec") => symph_decode(&a[2], &a[3]),
        Some("version") => {
            #[cfg(feature = "libopus")]
            println!("libopus {}", libopus::version());
            Ok(())
        }
        _ => Err("usage: gen|enc|dec|cmp|recover|version".into()),
    };
    if let Err(e) = r {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
