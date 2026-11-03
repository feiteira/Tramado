import { cuesToTranscript, type Cue, type TranscriptResult } from '../import/transcript';
import { fold } from '../text/normalize';
import type { SpeechSegment, Transcription } from './types';

// A transcription → Trama's transcript layout: one paragraph per speaker turn ("Name: text"),
// a sync point at every segment so the recording follows along, and speaker spans for
// auto-coding. A call recorded by Trama has two tracks, the researcher's microphone and what
// the computer played; their segments interleave by time into turns. One track (an imported
// recording) has no speakers: paragraphs follow the pauses.

const words = (s: string): string[] => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** How much of a microphone segment must also be heard on the computer's track to be its echo. */
const ECHO_SHARE = 0.6;
/** Echo arrives a little late, and the two tracks' segments are cut differently. */
const ECHO_SLACK_MS = 1500;

/**
 * Leaves out microphone segments that are the call's own sound picked up again: without
 * headphones the microphone hears the other side through the speakers, and their words would
 * otherwise appear twice, once under the researcher's name.
 */
export function dropEcho(mic: readonly SpeechSegment[], system: readonly SpeechSegment[]): SpeechSegment[] {
  return mic.filter((m) => {
    const own = words(m.text);
    if (!own.length) return false;
    const heard = new Set<string>();
    for (const s of system) {
      if (s.end + ECHO_SLACK_MS < m.start || s.start > m.end + ECHO_SLACK_MS) continue;
      for (const w of words(s.text)) heard.add(w);
    }
    if (!heard.size) return true;
    const shared = own.filter((w) => heard.has(w)).length;
    return shared / own.length < ECHO_SHARE;
  });
}

/**
 * `speakers` names each track (the researcher, the other side); a null name, or a single
 * track without a name, gives paragraphs without speaker labels.
 */
export function transcriptFromSpeech(t: Transcription, speakers: readonly (string | null)[]): TranscriptResult {
  const name = (i: number) => {
    const n = speakers[i]?.trim();
    return n ? n : null;
  };
  let cues: Cue[];
  if (t.tracks.length >= 2) {
    const [mic, system] = [t.tracks[0]!.segments, t.tracks[1]!.segments];
    cues = [
      ...dropEcho(mic, system).map((s) => ({ ...s, speaker: name(0) })),
      ...system.map((s) => ({ ...s, speaker: name(1) })),
    ];
    // By when each was said; at the same moment, the one that ends first.
    cues.sort((a, b) => a.start - b.start || a.end - b.end);
  } else {
    cues = (t.tracks[0]?.segments ?? []).map((s) => ({ ...s, speaker: name(0) }));
  }
  return cuesToTranscript(cues);
}

/** The language most of the text was heard in, if the model told. */
export function spokenLanguage(t: Transcription): string | null {
  const counts = new Map<string, number>();
  for (const track of t.tracks) {
    if (!track.language) continue;
    const n = track.segments.reduce((sum, s) => sum + s.text.length, 0);
    counts.set(track.language, (counts.get(track.language) ?? 0) + n);
  }
  let best: string | null = null;
  for (const [lang, n] of counts) if (best === null || n > counts.get(best)!) best = lang;
  return best;
}
