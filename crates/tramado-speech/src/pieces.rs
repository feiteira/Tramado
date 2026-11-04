// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/speech/transcribe.rs and remote.rs), MPL-2.0, same
// author.

//! Joined audio and its mapping back onto the recording, shared by local and cloud
//! transcription. A voice-activity model finds the stretches with speech; only those are
//! passed on, joined with a short pause between them, so silences cost no time and do not come
//! back as invented sentences. The model's times are then placed back on the recording, and a
//! segment is cut wherever its words cross a real pause.

use crate::types::{Segment, Word as OutWord};
use crate::SAMPLE_RATE;

pub const MS: usize = SAMPLE_RATE as usize / 1000;
pub const SECOND: usize = SAMPLE_RATE as usize;
/// Each stretch runs on a little into the next pause, so a last syllable is not cut.
pub const OVERLAP: usize = 100 * MS;
/// The pause put between stretches: enough for the model to hear a break.
pub const GAP: usize = 100 * MS;
/// Each stretch starts a little before the detected speech, and the joined audio with a moment
/// of silence: a short first word said right at the start is easily lost.
pub const LEAD: usize = 200 * MS;
pub const START: usize = 500 * MS;
/// A pause at least this long on the recording, between two stretches, ends a segment.
const SPLIT: usize = 1000 * MS;

/// Where a stretch of speech sits in the joined audio and in the recording (samples).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Piece {
    pub joined: usize,
    pub original: usize,
    pub len: usize,
}

/// Joins the stretches of `speech` (sample ranges of `samples`, which starts at sample
/// `offset` of the recording) into one buffer with a pause between them. The pieces are in
/// recording samples.
pub fn join_at(samples: &[f32], offset: usize, speech: &[(usize, usize)]) -> (Vec<f32>, Vec<Piece>) {
    let end = offset + samples.len();
    let mut out = vec![0.0; START];
    let mut pieces: Vec<Piece> = Vec::with_capacity(speech.len());
    for (i, &(a, b)) in speech.iter().enumerate() {
        let after = pieces.last().map_or(offset, |p| p.original + p.len);
        let a = a.saturating_sub(LEAD).max(after).clamp(offset, end);
        let b = if i + 1 < speech.len() { b + OVERLAP } else { b }.min(end);
        if b <= a {
            continue;
        }
        if !pieces.is_empty() {
            out.extend(std::iter::repeat_n(0.0, GAP));
        }
        pieces.push(Piece {
            joined: out.len(),
            original: a,
            len: b - a,
        });
        out.extend_from_slice(&samples[a - offset..b - offset]);
    }
    (out, pieces)
}

/// [`join_at`] for a whole track.
pub fn join(samples: &[f32], speech: &[(usize, usize)]) -> (Vec<f32>, Vec<Piece>) {
    join_at(samples, 0, speech)
}

/// A time in the joined audio (samples) back on the recording. In a pause between stretches a
/// start belongs to the stretch after it and an end to the one before.
pub fn place(t: usize, pieces: &[Piece], is_start: bool) -> usize {
    let Some(first) = pieces.first() else {
        return t;
    };
    let mut prev = first;
    for p in pieces {
        if t < p.joined {
            return if is_start {
                p.original
            } else {
                prev.original + prev.len
            };
        }
        if t < p.joined + p.len {
            return p.original + (t - p.joined);
        }
        prev = p;
    }
    prev.original + prev.len
}

/// A piece of text the model wrote, with its times in the joined audio (samples).
#[derive(Debug, Clone)]
pub struct Token {
    pub t0: usize,
    pub t1: usize,
    pub text: String,
    /// The model's probability for it (0..1).
    pub p: f32,
}

/// The stretch a token was said in: the one it starts in, or the next after a pause.
fn piece_of(w: &Token, pieces: &[Piece]) -> usize {
    pieces
        .iter()
        .position(|p| w.t0 < p.joined + p.len)
        .unwrap_or(pieces.len().saturating_sub(1))
}

fn ms(samples: usize) -> u64 {
    (samples / MS) as u64
}

/// One of the model's segments back on the recording, cut wherever its tokens cross a real
/// pause; tokens are gathered into words (a token that starts with a space starts a word).
pub fn place_words(tokens: &[Token], pieces: &[Piece]) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    let mut current: Option<(usize, Segment)> = None;
    for w in tokens {
        let i = piece_of(w, pieces);
        // Punctuation ends what it follows; the model dates a closing full stop late.
        let word_like = w.text.chars().any(char::is_alphanumeric);
        let new_turn = match &current {
            None => true,
            Some((j, _)) => {
                word_like
                    && i != *j
                    && pieces
                        .get(i)
                        .zip(pieces.get(i.wrapping_sub(1)))
                        .is_some_and(|(p, before)| {
                            p.original.saturating_sub(before.original + before.len) + OVERLAP
                                >= SPLIT
                        })
            }
        };
        if new_turn {
            if let Some((_, seg)) = current.take() {
                out.push(seg);
            }
            // Never before the stretch the token belongs to: the model's first time is often
            // the end of the word before it.
            let start = place(w.t0, pieces, true).max(pieces.get(i).map_or(0, |p| p.original));
            current = Some((
                i,
                Segment {
                    start_ms: ms(start),
                    end_ms: ms(start),
                    text: String::new(),
                    words: Some(Vec::new()),
                },
            ));
        }
        if let Some((j, seg)) = current.as_mut() {
            seg.text.push_str(&w.text);
            let t0 = ms(place(w.t0, pieces, true));
            let t1 = ms(place(w.t1.max(w.t0), pieces, false)).max(t0);
            if word_like {
                *j = i;
                seg.end_ms = seg.end_ms.max(t1);
            }
            let words = seg.words.get_or_insert_with(Vec::new);
            let starts_word = w.text.starts_with(' ') || words.is_empty();
            if starts_word && word_like {
                words.push(OutWord {
                    start_ms: t0.max(seg.start_ms),
                    end_ms: t1.max(seg.start_ms),
                    text: w.text.trim().to_string(),
                    p: w.p,
                });
            } else if let Some(last) = words.last_mut() {
                last.text.push_str(w.text.trim_end());
                if word_like {
                    last.end_ms = last.end_ms.max(t1);
                }
                last.p = last.p.min(w.p);
            } else if word_like {
                words.push(OutWord {
                    start_ms: t0.max(seg.start_ms),
                    end_ms: t1.max(seg.start_ms),
                    text: w.text.trim().to_string(),
                    p: w.p,
                });
            }
        }
    }
    out.extend(current.map(|(_, s)| s));
    for s in &mut out {
        s.text = s.text.trim().to_string();
        if s.words.as_ref().is_some_and(Vec::is_empty) {
            s.words = None;
        }
    }
    out.retain(|s| !s.text.is_empty());
    out
}

/// The loudness (RMS) of some samples.
pub fn energy(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Splits stretches longer than `max` at their quietest 50 ms in the last `window` before the
/// limit. `samples` starts at recording sample `offset`.
pub fn split_long(
    samples: &[f32],
    offset: usize,
    stretches: &[(usize, usize)],
    max: usize,
    window: usize,
) -> Vec<(usize, usize)> {
    let frame = SECOND / 20;
    let mut out = Vec::with_capacity(stretches.len());
    for &(a, b) in stretches {
        let mut a = a;
        while b - a > max {
            let from = a + max - window.min(max);
            let mut best = (f32::MAX, a + max);
            let mut f = from;
            while f + frame <= a + max {
                let lo = f.saturating_sub(offset).min(samples.len());
                let hi = (f + frame).saturating_sub(offset).min(samples.len());
                let e = energy(&samples[lo..hi]);
                if e < best.0 {
                    best = (e, f + frame / 2);
                }
                f += frame;
            }
            out.push((a, best.1));
            a = best.1;
        }
        out.push((a, b));
    }
    out
}

/// The joined audio a stretch takes up (at most: the lead and the overlap, and a gap).
pub fn cost(&(a, b): &(usize, usize)) -> usize {
    b - a + LEAD + OVERLAP + GAP
}

/// Groups consecutive stretches into pieces of at most `max` samples of joined audio. A piece
/// also ends where `other` (the other side of an online class) speaks between two of its
/// stretches, so turns keep their order.
pub fn pack(
    stretches: &[(usize, usize)],
    other: &[(usize, usize)],
    max: usize,
) -> Vec<Vec<(usize, usize)>> {
    let mut out: Vec<Vec<(usize, usize)>> = Vec::new();
    let mut current: Vec<(usize, usize)> = Vec::new();
    let mut size = START;
    for s in stretches {
        let interrupted = current
            .last()
            .is_some_and(|&(_, end)| other.iter().any(|&(oa, ob)| oa < s.0 && ob > end));
        if !current.is_empty() && (interrupted || size + cost(s) > max) {
            out.push(std::mem::take(&mut current));
            size = START;
        }
        size += cost(s);
        current.push(*s);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Without the voice-activity model: stretches of the track louder than `silent_rms`, in
/// 50 ms frames, with short pauses (under `bridge`) bridged.
pub fn loud_stretches(samples: &[f32], silent_rms: f32, bridge: usize) -> Vec<(usize, usize)> {
    let frame = SECOND / 20;
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < samples.len() {
        let j = (i + frame).min(samples.len());
        if energy(&samples[i..j]) >= silent_rms {
            match out.last_mut() {
                Some(last) if i <= last.1 + bridge => last.1 = j,
                _ => out.push((i, j)),
            }
        }
        i = j;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: usize = SECOND;

    #[test]
    fn joins_the_stretches_with_a_pause() {
        let samples: Vec<f32> = (0..30 * S).map(|i| i as f32).collect();
        let (joined, pieces) = join(&samples, &[(S / 2, 6 * S), (17 * S, 20 * S)]);
        assert_eq!(
            pieces,
            vec![
                Piece {
                    joined: START,
                    original: S / 2 - LEAD,
                    len: 6 * S - S / 2 + LEAD + OVERLAP,
                },
                Piece {
                    joined: START + 6 * S - S / 2 + LEAD + OVERLAP + GAP,
                    original: 17 * S - LEAD,
                    len: 3 * S + LEAD,
                },
            ]
        );
        assert_eq!(joined.len(), pieces[1].joined + 3 * S + LEAD);
        assert_eq!(joined[pieces[1].joined], (17 * S - LEAD) as f32);
        // A lead-in never reaches back into the stretch before.
        let (_, close) = join(&samples, &[(S, 2 * S), (2 * S + 50 * MS, 3 * S)]);
        assert_eq!(close[1].original, 2 * S + OVERLAP);
        // A window of the track: pieces stay in recording samples.
        let (w, p) = join_at(&samples[10 * S..25 * S], 10 * S, &[(17 * S, 20 * S)]);
        assert_eq!(p[0].original, 17 * S - LEAD);
        assert_eq!(w[p[0].joined], (17 * S - LEAD) as f32);
    }

    #[test]
    fn places_times_back_on_the_recording() {
        let pieces = [
            Piece {
                joined: 0,
                original: S / 2,
                len: 6 * S,
            },
            Piece {
                joined: 6 * S + GAP,
                original: 17 * S,
                len: 3 * S,
            },
        ];
        assert_eq!(place(S, &pieces, true), S + S / 2);
        assert_eq!(place(6 * S + GAP + S, &pieces, true), 18 * S);
        assert_eq!(place(6 * S + GAP / 2, &pieces, true), 17 * S);
        assert_eq!(place(6 * S + GAP / 2, &pieces, false), 6 * S + S / 2);
        assert_eq!(place(60 * S, &pieces, false), 20 * S);
    }

    fn tok(t0: usize, t1: usize, text: &str) -> Token {
        Token {
            t0,
            t1,
            text: text.into(),
            p: 0.9,
        }
    }

    #[test]
    fn cuts_a_segment_at_a_pause_and_dates_each_turn() {
        let pieces = [
            Piece {
                joined: 0,
                original: S / 2,
                len: 6 * S,
            },
            Piece {
                joined: 6 * S + GAP,
                original: 17 * S,
                len: 3 * S,
            },
        ];
        let tokens = [
            tok(0, S, " Thank"),
            tok(S, 5 * S, " you"),
            tok(6 * S + GAP + S / 20, 6 * S + GAP + S / 20, "."),
            tok(6 * S + GAP + S / 10, 6 * S + GAP + S, " What"),
            tok(6 * S + GAP + S, 6 * S + GAP + 2 * S, " made"),
            tok(6 * S + GAP + 2 * S, 6 * S + GAP + 2 * S + S / 2, " you"),
            tok(6 * S + GAP + 2 * S + S / 2, 6 * S + GAP + 2 * S + S / 2, " st"),
            tok(6 * S + GAP + 2 * S + S / 2, 6 * S + GAP + 3 * S, "ay?"),
        ];
        let out = place_words(&tokens, &pieces);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].start_ms, out[0].text.as_str()), (500, "Thank you."));
        assert_eq!(
            (out[1].start_ms, out[1].text.as_str()),
            (17_100, "What made you stay?")
        );
        assert_eq!(out[1].end_ms, 20_000);
        let words: Vec<_> = out[1]
            .words
            .as_ref()
            .unwrap()
            .iter()
            .map(|w| w.text.as_str())
            .collect();
        assert_eq!(words, vec!["What", "made", "you", "stay?"]);
        assert_eq!(out[0].words.as_ref().unwrap()[1].text, "you.");
    }

    #[test]
    fn keeps_a_segment_across_a_short_breath() {
        let pieces = [
            Piece {
                joined: 0,
                original: 0,
                len: 2 * S,
            },
            Piece {
                joined: 2 * S + GAP,
                original: 2 * S + S / 4,
                len: 2 * S,
            },
        ];
        let out = place_words(
            &[tok(0, S, " One"), tok(2 * S + GAP + S / 2, 3 * S, " two.")],
            &pieces,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "One two.");
    }

    #[test]
    fn packs_speech_into_half_minutes() {
        let speech: Vec<_> = (0..10).map(|i| (i * 6 * S, i * 6 * S + 5 * S)).collect();
        let groups = pack(&speech, &[], 30 * S);
        assert!(groups.len() >= 2);
        for g in &groups {
            assert!(START + g.iter().map(cost).sum::<usize>() <= 30 * S);
        }
        assert_eq!(groups.iter().map(Vec::len).sum::<usize>(), 10);
        // A piece ends where the other side speaks.
        let mine = [(0, 2 * S), (3 * S, 5 * S), (10 * S, 12 * S)];
        assert_eq!(
            pack(&mine, &[(6 * S, 9 * S)], 30 * S),
            vec![vec![(0, 2 * S), (3 * S, 5 * S)], vec![(10 * S, 12 * S)]]
        );
    }

    #[test]
    fn cuts_a_long_stretch_where_it_is_quiet() {
        let mut samples: Vec<f32> = (0..60 * S).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        for q in [25 * S, 50 * S] {
            for x in &mut samples[q..q + S / 10] {
                *x = 0.0;
            }
        }
        let parts = split_long(&samples, 0, &[(0, 60 * S)], 27 * S, 7 * S);
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|&(a, b)| b - a <= 27 * S));
        assert!((parts[0].1 as i64 - (25 * S) as i64).abs() < (S / 10) as i64);
        assert_eq!(parts.last().unwrap().1, 60 * S);
    }

    #[test]
    fn finds_loud_stretches_without_the_voice_model() {
        let mut x = vec![0.0f32; 10 * S];
        for v in &mut x[2 * S..4 * S] {
            *v = 0.2;
        }
        for v in &mut x[4 * S + S / 10..5 * S] {
            *v = 0.2;
        }
        let found = loud_stretches(&x, 0.004, S / 2);
        assert_eq!(found, vec![(2 * S, 5 * S)]);
    }
}
