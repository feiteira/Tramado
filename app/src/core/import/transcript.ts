import type { SyncPoint } from '../model/legacy';
import { canonicalize } from './text';
import type { ImportedSpeaker } from './types';

// Transcripts → one paragraph per speaker turn ("Speaker: text") with a sync point (media
// time) at the start of each turn, and the speakers' spans for auto-coding.
//
// Two sources: timed cues (WebVTT/SRT, see vtt.ts and srt.ts) and transcripts typed or
// exported as text (Word, Otter, Teams, Zoom, a transcriptionist's .txt) in the layouts
// below. Text detection is deliberately conservative: a field note with "Date: …" lines must
// stay a plain document.

/** A timed piece of a transcript (milliseconds). */
export interface Cue {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
}

export interface SpeakerOptions {
  /** Treat names that differ only in letter case ("INÊS", "Inês") as one speaker. Default true. */
  mergeCase?: boolean;
  /** Renames applied after trimming, matched case-insensitively: { "Speaker 1": "Entrevistadora" }. */
  rename?: Record<string, string>;
}

export interface TranscriptResult {
  text: string;
  sync: SyncPoint[];
  speakers: ImportedSpeaker[];
}

// ---------------------------------------------------------------------------------------------
// Timestamps

const TS = String.raw`(?:\d{1,2}:)?\d{1,3}:\d{2}(?:[.,]\d{1,3})?(?::\d{2}(?![.,\d]))?`;

/**
 * Reads "1:02:03", "01:02:03.500", "00:01:23,456", "02:03" (minutes:seconds) and
 * "00:01:23:12" (with frames, which are dropped) into milliseconds. Null when invalid.
 */
export function parseTimestamp(raw: string): number | null {
  const s = raw.trim().replace(/^[[(]|[\])]$/g, '');
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = m[3] === undefined ? null : Number(m[3]);
  const frac = m[4] === undefined ? 0 : Number(m[4].padEnd(3, '0'));
  if (m[5] !== undefined && c === null) return null;
  let h = 0;
  let min: number;
  let sec: number;
  if (c === null) {
    min = a;
    sec = b;
  } else {
    h = a;
    min = b;
    sec = c;
    if (min > 59) return null;
  }
  if (sec > 59) return null;
  return ((h * 60 + min) * 60 + sec) * 1000 + frac;
}

// ---------------------------------------------------------------------------------------------
// Speaker names

/** Trims a speaker label: whitespace collapsed, Markdown bold and a trailing colon removed. */
export function cleanSpeakerName(raw: string): string {
  return canonicalize(raw)
    .replace(/^\s*(\*\*|__)(.*?)\1\s*$/su, '$2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*:$/, '');
}

const NAME_CHARS = String.raw`[\p{L}\p{M}][\p{L}\p{M}\p{N} .'\u{2019}_-]{0,39}?`;
const WORDS = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Plausible as a speaker label: short, starts with a letter, not a sentence. */
function plausibleName(name: string, maxWords: number): boolean {
  const n = name.trim();
  if (!n || n.length > 40 || WORDS(n) > maxWords) return false;
  if (!/^[\p{L}]/u.test(n)) return false;
  // Lower-case multi-word labels are usually sentence fragments ("e depois disse: …").
  if (WORDS(n) > 1 && !/[\p{Lu}\p{N}]/u.test(n)) return false;
  return true;
}

// Labels that look like speakers but introduce metadata in field notes and transcript headers.
const METADATA = new Set(
  [
    'data', 'date', 'fecha', 'hora', 'time', 'local', 'lugar', 'place', 'location', 'duração', 'duracao', 'duration', 'duración',
    'nota', 'notas', 'note', 'notes', 'tema', 'topic', 'assunto', 'subject', 'title', 'título', 'titulo', 'projeto', 'project',
    'proyecto', 'entrevista', 'interview', 'transcrição', 'transcricao', 'transcript', 'transcripción', 'transcripcion', 'ficheiro',
    'file', 'archivo', 'source', 'fonte', 'fuente', 'obs', 'observações', 'observaciones', 'resumo', 'summary', 'resumen',
    'keywords', 'palavras-chave', 'palabras clave', 'ps', 'nb', 'http', 'https', 'mailto', 'tel', 'email', 'e-mail',
  ].map((s) => s.normalize('NFC')),
);

interface Turn {
  speaker: string | null;
  text: string;
  ms: number | null;
  /** More sync points inside the turn (offset into `text`). */
  inner?: { at: number; ms: number }[];
}

/** Display names: case variants merged to the most frequent spelling, renames applied. */
function resolveNames(turns: Turn[], opts: SpeakerOptions): Map<string, string> {
  const mergeCase = opts.mergeCase ?? true;
  const rename = new Map(Object.entries(opts.rename ?? {}).map(([k, v]) => [cleanSpeakerName(k).toLocaleLowerCase(), cleanSpeakerName(v)]));
  const variants = new Map<string, Map<string, number>>(); // key → spelling → count
  const keyOf = (name: string) => (mergeCase ? name.toLocaleLowerCase() : name);
  for (const t of turns) {
    if (!t.speaker) continue;
    const renamed = rename.get(t.speaker.toLocaleLowerCase()) || t.speaker;
    const key = keyOf(renamed);
    const counts = variants.get(key) ?? new Map<string, number>();
    counts.set(renamed, (counts.get(renamed) ?? 0) + 1);
    variants.set(key, counts);
  }
  const display = new Map<string, string>();
  for (const [key, counts] of variants) {
    // Most frequent spelling; on a tie, one that is not all capitals; then the first seen.
    let best = '';
    let bestScore = -1;
    for (const [spelling, n] of counts) {
      const score = n * 2 + (spelling !== spelling.toLocaleUpperCase() ? 1 : 0);
      if (score > bestScore) {
        best = spelling;
        bestScore = score;
      }
    }
    display.set(key, best);
  }
  const out = new Map<string, string>();
  for (const t of turns) {
    if (!t.speaker || out.has(t.speaker)) continue;
    const renamed = rename.get(t.speaker.toLocaleLowerCase()) || t.speaker;
    out.set(t.speaker, display.get(keyOf(renamed)) ?? renamed);
  }
  return out;
}

/** Lays turns out as paragraphs and computes sync points and speaker spans on the final text. */
function build(turns: Turn[], opts: SpeakerOptions = {}): TranscriptResult {
  const names = resolveNames(turns, opts);
  const parts: string[] = [];
  const sync: SyncPoint[] = [];
  const spans = new Map<string, ImportedSpeaker>();
  let pos = 0;
  for (const t of turns) {
    const text = t.text.trim();
    const name = t.speaker ? (names.get(t.speaker) ?? t.speaker) : null;
    if (!text && !(name && t.ms !== null)) continue;
    const label = name ? `${name}: ` : '';
    const para = (label + text).trimEnd();
    if (parts.length) pos += 1; // the "\n" before this paragraph
    if (t.ms !== null) sync.push({ pos, ms: t.ms });
    for (const inner of t.inner ?? []) {
      // Offsets were taken on the untrimmed text; trimming only removes leading spaces.
      const lead = t.text.length - t.text.trimStart().length;
      const at = pos + label.length + inner.at - lead;
      if (at > pos && at < pos + para.length) sync.push({ pos: at, ms: inner.ms });
    }
    if (name && text) {
      const sp = spans.get(name) ?? { name, spans: [] };
      sp.spans.push({ start: pos + label.length, end: pos + para.length });
      spans.set(name, sp);
    }
    parts.push(para);
    pos += para.length;
  }
  return { text: parts.join('\n'), sync, speakers: [...spans.values()] };
}

// ---------------------------------------------------------------------------------------------
// Cues

const collapse = (s: string) => canonicalize(s).replace(/\s+/g, ' ').trim();

/**
 * Finds speakers in cues that have none: "Name: text" prefixes (Zoom, many SRT tools), or a
 * first line that is only a name (Teams-style "Name\ntext"). Prefixes are only believed when
 * enough cues use them, and a name seen once is not a speaker unless the file is tiny.
 */
export function refineCueSpeakers(cues: Cue[]): Cue[] {
  const PREFIX = new RegExp(String.raw`^\s*(?:-\s*)?(?:>>\s*)?(${NAME_CHARS})\s*:\s+(\S[\s\S]*)$`, 'u');
  const open = cues.filter((c) => !c.speaker);
  if (!open.length) return cues;
  const small = cues.length <= 3;

  const prefixed = new Map<Cue, { name: string; rest: string }>();
  const counts = new Map<string, number>();
  for (const c of open) {
    const m = PREFIX.exec(c.text);
    if (!m) continue;
    const name = cleanSpeakerName(m[1]!);
    if (!plausibleName(name, 4) || METADATA.has(name.toLocaleLowerCase())) continue;
    prefixed.set(c, { name, rest: m[2]! });
    counts.set(name.toLocaleLowerCase(), (counts.get(name.toLocaleLowerCase()) ?? 0) + 1);
  }
  let result = cues;
  if (prefixed.size >= Math.max(small ? 1 : 2, Math.ceil(open.length * 0.3))) {
    let last: string | null = null;
    result = cues.map((c) => {
      if (c.speaker) {
        last = c.speaker;
        return c;
      }
      const p = prefixed.get(c);
      if (p && (small || (counts.get(p.name.toLocaleLowerCase()) ?? 0) >= 2)) {
        last = p.name;
        return { ...c, speaker: p.name, text: p.rest };
      }
      // Tools that label only speaker changes: an unlabelled cue continues the last speaker.
      return last ? { ...c, speaker: last } : c;
    });
    return result;
  }

  // Teams-style: the first line names the speaker.
  const lined = new Map<Cue, { name: string; rest: string }>();
  const lineCounts = new Map<string, number>();
  for (const c of open) {
    const nl = c.text.indexOf('\n');
    if (nl < 0) continue;
    const first = cleanSpeakerName(c.text.slice(0, nl));
    const rest = c.text.slice(nl + 1);
    if (!rest.trim() || !plausibleName(first, 4) || /[.?!,;:]$/.test(first) || METADATA.has(first.toLocaleLowerCase())) continue;
    lined.set(c, { name: first, rest });
    lineCounts.set(first.toLocaleLowerCase(), (lineCounts.get(first.toLocaleLowerCase()) ?? 0) + 1);
  }
  const accepted = [...lineCounts].filter(([, n]) => small || n >= 2);
  if (lined.size >= Math.ceil(open.length * 0.5) && accepted.length && accepted.length <= Math.max(2, Math.ceil(lined.size / 3))) {
    const ok = new Set(accepted.map(([k]) => k));
    result = cues.map((c) => {
      const l = lined.get(c);
      return l && ok.has(l.name.toLocaleLowerCase()) ? { ...c, speaker: l.name, text: l.rest } : c;
    });
  }
  return result;
}

export interface CueOptions {
  speakers?: SpeakerOptions;
  /** A sync point for every cue, not only at the start of each turn. Default true. */
  syncEveryCue?: boolean;
}

/**
 * Cues → turns: consecutive cues of one speaker become one paragraph "Speaker: text" with a
 * sync point at its first cue. Cues without a speaker are grouped by pauses (2 s or more
 * starts a new paragraph) so subtitles read as prose.
 */
export function cuesToTranscript(cues: Cue[], opts: CueOptions = {}): TranscriptResult {
  const every = opts.syncEveryCue ?? true;
  const mergeCase = opts.speakers?.mergeCase ?? true;
  const key = (s: string | null) => (s === null ? null : mergeCase ? s.toLocaleLowerCase() : s);
  const turns: Turn[] = [];
  let prevText = '';
  let prevLastLine = '';
  let prevSpeaker: string | null | undefined;
  let prevEnd = -Infinity;
  for (const cue of cues) {
    const lines = cue.text.split('\n').map(collapse).filter(Boolean);
    const full = lines.join(' ');
    if (!full) continue;
    let text = full;
    // Only cues that follow on immediately can be a roll-up of the one before.
    if (cue.speaker === prevSpeaker && cue.start <= prevEnd + 500) {
      // Roll-up captions (YouTube, live captioning) repeat what was already shown: the same
      // cue again, or the previous cue's last line before the new words.
      if (full === prevText) continue;
      if (lines[0] === prevLastLine && lines.length > 1) text = lines.slice(1).join(' ');
      else if (text.startsWith(prevText + ' ')) text = text.slice(prevText.length + 1);
      else if (text.startsWith(prevLastLine + ' ')) text = text.slice(prevLastLine.length + 1);
    }
    prevText = full;
    prevLastLine = lines[lines.length - 1]!;
    prevSpeaker = cue.speaker;
    const speaker = cue.speaker ? cleanSpeakerName(cue.speaker) || null : null;
    const last = turns[turns.length - 1];
    const sameSpeaker = last && key(last.speaker) === key(speaker);
    const continues = sameSpeaker && (speaker !== null || (cue.start - prevEnd < 2000 && last.text.length < 1000));
    if (last && continues) {
      if (every) (last.inner ??= []).push({ at: last.text.length + 1, ms: cue.start });
      last.text += ' ' + text;
    } else turns.push({ speaker, text, ms: cue.start });
    prevEnd = cue.end;
  }
  return build(turns, opts.speakers);
}

// ---------------------------------------------------------------------------------------------
// Text transcripts

type LineKind = 'timed' | 'header' | 'label' | 'timeOnly' | 'timedText' | 'other' | 'blank';

interface Line {
  kind: LineKind;
  speaker: string | null;
  text: string;
  ms: number | null;
}

const DASH = String.raw`[-\u{2013}\u{2014}]`;
const N = `(${NAME_CHARS})`;
const T = `(${TS})`;
const RE = {
  // [00:01:23] Name: text   (00:01:23) - Name: text
  bracketTimed: new RegExp(String.raw`^[[(]${T}[\])]\s*(?:${DASH}\s*)?${N}\s*:(?:\s+(.*))?$`, 'u'),
  // Name (00:01:23): text   Name [00:01:23] text
  nameTimed: new RegExp(String.raw`^${N}\s*[[(]${T}[\])]\s*(?::\s*)?(.*)$`, 'u'),
  // 00:01:23 Name: text
  timedName: new RegExp(String.raw`^${T}\s+(?:${DASH}\s*)?${N}\s*:(?:\s+(.*))?$`, 'u'),
  // Name  0:01   (Otter, Teams; the text follows on the next lines)
  nameThenTime: new RegExp(String.raw`^${N}\s*(?:[|\u{2022}\u{2013}\u{2014}-]\s*)?\s${T}$`, 'u'),
  // 00:00:03 Name   (Word's transcribe; text on the next lines)
  timeThenName: new RegExp(String.raw`^${T}\s+(?:${DASH}\s*)?${N}$`, 'u'),
  // [00:01:23] text   00:01:23 text
  timedText: new RegExp(String.raw`^(?:[[(]${T}[\])]|${T}(?=\s))\s*(?:${DASH}\s*)?(.+)$`, 'u'),
  // Interviewer: text   I: text   P1: text   **R:** text
  label: new RegExp(String.raw`^(?:\*\*|__)?${N}(?:\*\*|__)?\s*:(?:\*\*|__)?(?:\s+(.*))?$`, 'u'),
  timeOnly: new RegExp(String.raw`^[[(]?${T}[\])]?$`, 'u'),
};

function classify(raw: string): Line {
  const line = raw.trim();
  if (!line) return { kind: 'blank', speaker: null, text: '', ms: null };
  let m: RegExpExecArray | null;
  const named = (kind: LineKind, name: string, ts: string | null, text: string | undefined, maxWords: number): Line | null => {
    const speaker = cleanSpeakerName(name);
    if (!plausibleName(speaker, maxWords) || METADATA.has(speaker.toLocaleLowerCase())) return null;
    const ms = ts === null ? null : parseTimestamp(ts);
    if (ts !== null && ms === null) return null;
    return { kind, speaker, text: (text ?? '').trim(), ms };
  };
  if ((m = RE.timeOnly.exec(line))) {
    const ms = parseTimestamp(m[1]!);
    if (ms !== null) return { kind: 'timeOnly', speaker: null, text: '', ms };
  }
  if ((m = RE.bracketTimed.exec(line))) {
    const l = named('timed', m[2]!, m[1]!, m[3], 5);
    if (l) return l;
  }
  if ((m = RE.nameTimed.exec(line))) {
    const l = named(m[3] ? 'timed' : 'header', m[1]!, m[2]!, m[3], 5);
    if (l) return l;
  }
  if ((m = RE.timedName.exec(line))) {
    const l = named('timed', m[2]!, m[1]!, m[3], 5);
    if (l) return l;
  }
  if ((m = RE.nameThenTime.exec(line))) {
    const l = named('header', m[1]!, m[2]!, '', 5);
    if (l && !/[.?!,;]$/.test(l.speaker!)) return l;
  }
  if ((m = RE.timeThenName.exec(line))) {
    const l = named('header', m[2]!, m[1]!, '', 4);
    if (l && !/[.?!,;]$/.test(l.speaker!)) return l;
  }
  if ((m = RE.timedText.exec(line))) {
    const ms = parseTimestamp(m[1] ?? m[2]!);
    if (ms !== null) return { kind: 'timedText', speaker: null, text: m[3]!.trim(), ms };
  }
  if ((m = RE.label.exec(line))) {
    const l = named('label', m[1]!, null, m[2], 4);
    if (l) return l;
  }
  return { kind: 'other', speaker: null, text: line, ms: null };
}

export interface TextTranscriptOptions {
  speakers?: SpeakerOptions;
  /** Parse as a transcript even when the layout is not convincing (the researcher said so). */
  force?: boolean;
}

/**
 * Parses a transcript written as text. Returns null when the text does not look like one
 * (unless `force`). Each labelled line starts a turn; lines without a label continue the
 * current turn; lines before the first turn stay as paragraphs of their own.
 */
export function parseTextTranscript(text: string, opts: TextTranscriptOptions = {}): TranscriptResult | null {
  const lines = canonicalize(text).split('\n').map(classify);
  const nonEmpty = lines.filter((l) => l.kind !== 'blank').length;
  if (!nonEmpty) return opts.force ? { text: '', sync: [], speakers: [] } : null;

  const timed = lines.filter((l) => l.kind === 'timed' || l.kind === 'header');
  const timedSpeakers = new Set(timed.map((l) => l.speaker!.toLocaleLowerCase()));
  const labelCounts = new Map<string, number>();
  for (const l of lines) if (l.kind === 'label') labelCounts.set(l.speaker!.toLocaleLowerCase(), (labelCounts.get(l.speaker!.toLocaleLowerCase()) ?? 0) + 1);

  let isTurn: (l: Line) => boolean;
  const timedOk = timed.length >= (nonEmpty <= 6 ? 2 : 3) && timed.length >= nonEmpty * 0.15;
  if (timedOk) {
    // Labels without a time still start turns when they name a known speaker.
    isTurn = (l) => l.kind === 'timed' || l.kind === 'header' || l.kind === 'timedText' || (l.kind === 'label' && timedSpeakers.has(l.speaker!.toLocaleLowerCase()));
  } else {
    const repeated = new Set([...labelCounts].filter(([, n]) => n >= 2).map(([k]) => k));
    const repeatedTurns = [...repeated].reduce((sum, k) => sum + (labelCounts.get(k) ?? 0), 0);
    const labelsOk = repeated.size >= 2 && repeated.size <= 15 && repeatedTurns >= 4 && repeatedTurns >= nonEmpty * 0.2;
    if (labelsOk) {
      // Someone who speaks once (a child, a passer-by) counts once the dialogue has begun.
      let begun = false;
      const accepted = new Set<Line>();
      for (const l of lines) {
        if (l.kind !== 'label') continue;
        const k = l.speaker!.toLocaleLowerCase();
        if (repeated.has(k)) begun = true;
        if (repeated.has(k) || (begun && WORDS(l.speaker!) <= 3 && !!l.text)) accepted.add(l);
      }
      isTurn = (l) => accepted.has(l) || l.kind === 'timedText';
    } else if (opts.force) {
      isTurn = (l) => l.kind !== 'other' && l.kind !== 'blank' && l.kind !== 'timeOnly';
    } else return null;
  }

  const turns: Turn[] = [];
  let current: Turn | null = null;
  let pendingMs: number | null = null;
  for (const l of lines) {
    if (l.kind === 'blank') continue;
    if (l.kind === 'timeOnly') {
      pendingMs = l.ms;
      continue;
    }
    if (isTurn(l)) {
      current = { speaker: l.speaker, text: l.text, ms: l.ms ?? pendingMs };
      turns.push(current);
      pendingMs = null;
      continue;
    }
    const raw = l.kind === 'other' ? l.text : (l.speaker ? `${l.speaker}: ` : '') + l.text;
    if (pendingMs !== null) {
      // "00:01:23" on its own line, then the words: a timed turn without a speaker.
      current = { speaker: null, text: raw, ms: pendingMs };
      turns.push(current);
      pendingMs = null;
    } else if (current) current.text = current.text ? `${current.text} ${raw}` : raw;
    else turns.push({ speaker: null, text: raw, ms: null }); // preface: title, date, place
  }
  return build(turns, opts.speakers);
}

/** True when the text reads as a transcript (see parseTextTranscript). */
export function looksLikeTranscript(text: string): boolean {
  return parseTextTranscript(text) !== null;
}
