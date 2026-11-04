// The effective transcript (folder spec §8.9): transcript.json plus every trusted, not yet folded edit line
// of its round, replayed in HLC order. Computed identically by the owner when folding and by every reader
// for display. Pure.
import type { DeviceId, Hex64, Hlc, SegmentId } from '../model/ids';
import type { Segment, TranscriptEditLine, TranscriptFile } from '../model/files';
import { isSpeakerId, speakerLabel } from './labels';

/**
 * A speaker of transcript.json with the HLC of its last folded `label_speaker` line (folder spec §8.8, G2 lead
 * decision 2026-11-04). `labelHlc` is absent until a label was folded (`TranscriptFile.speakers[].labelHlc?`, G2).
 */
export type Speaker = TranscriptFile['speakers'][number];
import { validEditLine } from './edits';
import { sha1Hex } from './sha1';

/** The trusted lines of one device's edit log, in file order. */
export interface EditLog { deviceId: DeviceId; lines: readonly TranscriptEditLine[] }

/** What readers display (architecture §11.2 `EffectiveTranscript`). */
export type EffectiveTranscript = TranscriptFile & {
  /** Segments where a `set_text` did not name the text it replaced: "Two corrections met here". */
  concurrent: SegmentId[];
  /** Edit lines of this round not folded into transcript.json yet. */
  unfolded: number;
  /** The transcript was made from other audio than the lecture's (folder spec §8.8). */
  stale: boolean;
  /** transcript.json has a newer version than this app reads (read-only, §7.3). */
  newer: boolean;
};

export interface ReplayInfo {
  /** Edit lines replayed (or dropped) beyond `folded`: what a fold would fold. */
  ops: number;
  /** Per segment of the result: the devices whose unfolded edits touched it ("Corrected by …"). */
  touched: Record<SegmentId, DeviceId[]>;
  /** Lines that could not apply (their segment is gone, an invalid split, …), for diagnostics. */
  dropped: Array<{ deviceId: DeviceId; id: string; op: TranscriptEditLine['op']; reason: string }>;
  /** Per device: the greatest HLC replayed, what a fold writes into `folded`. */
  foldedTo: Record<DeviceId, Hlc>;
  /** Per speaker: the HLC of the label now in effect (an unfolded `label_speaker`, else the folded `labelHlc`). */
  speakerHlc: Record<string, Hlc>;
  /** Merged-away ids → the segment that absorbed them (folder spec §8.8 `merged`). */
  redirects: Record<SegmentId, SegmentId>;
  /** Segment ids split off in this replay → the segment they came from (old anchors may point there). */
  splitFrom: Record<SegmentId, SegmentId>;
}

export interface ReplayOptions {
  /** The lecture's current `audio.sha256`; a transcript made from other audio is `stale`. Omit = unknown. */
  audioSha256?: Hex64 | null;
  /** transcript.json was of a newer version (NEWER_FORMAT): shown read-only, never replayed. */
  newer?: boolean;
}

interface Op { line: TranscriptEditLine; deviceId: DeviceId; index: number }

const cmpOps = (a: Op, b: Op) =>
  a.line.hlc < b.line.hlc ? -1 : a.line.hlc > b.line.hlc ? 1 : a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.index - b.index;

const copySeg = (s: Segment): Segment => ({
  ...s,
  ...(s.words ? { words: s.words.map((w) => ({ ...w })) } : {}),
  ...(s.merged ? { merged: [...s.merged] } : {}),
  ...(s.editHlc ? { editHlc: { ...s.editHlc } } : {}),
});

/** The edit lines a reader would replay on `t`: trusted, this lecture and round, newer than `folded`. */
export function pendingOps(t: Pick<TranscriptFile, 'lectureId' | 'round' | 'folded'>, logs: readonly EditLog[]): Op[] {
  const ops: Op[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    const floor = t.folded[log.deviceId] ?? '';
    log.lines.forEach((line, index) => {
      if (!validEditLine(line, t) || line.hlc <= floor) return;
      const key = `${log.deviceId}\u0000${line.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      ops.push({ line, deviceId: log.deviceId, index });
    });
  }
  return ops.sort(cmpOps);
}

/** Replays the pending edit lines of `t` (folder spec §8.9 `effective`) and says what happened. */
export function replay(t: TranscriptFile, logs: readonly EditLog[], opts: ReplayOptions = {}): { transcript: EffectiveTranscript; info: ReplayInfo } {
  const segments = [...t.segments].map(copySeg).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const speakers: Speaker[] = (t.speakers as Speaker[]).map((s) => ({ ...s }));
  // Every speaker a segment uses is listed, with its default label when nobody named it. Speakers are only
  // ever added (here, by set_speaker and by label_speaker), so folding part of the edits commutes with replay.
  const listSpeaker = (id: string) => {
    if (!speakers.some((x) => x.id === id) && isSpeakerId(id)) speakers.push({ id, label: speakerLabel(id, t.language) });
  };
  for (const s of segments) listSpeaker(s.speaker);
  const info: ReplayInfo = { ops: 0, touched: {}, dropped: [], foldedTo: {}, speakerHlc: {}, redirects: {}, splitFrom: {} };
  for (const s of speakers) if (s.labelHlc) info.speakerHlc[s.id] = s.labelHlc;
  const concurrent = new Set<SegmentId>();
  const used = new Set<SegmentId>();
  for (const s of segments) {
    used.add(s.id);
    for (const m of s.merged ?? []) {
      used.add(m);
      info.redirects[m] = s.id;
    }
  }
  const touched = new Map<SegmentId, Set<DeviceId>>();
  const touch = (id: SegmentId, d: DeviceId) => {
    if (!touched.has(id)) touched.set(id, new Set());
    touched.get(id)!.add(d);
  };

  const ops = opts.newer ? [] : pendingOps(t, logs);
  const indexOf = (id: SegmentId): number => {
    let cur = id;
    for (let hops = 0; hops < 64; hops++) {
      const i = segments.findIndex((s) => s.id === cur);
      if (i >= 0) return i;
      const next = info.redirects[cur];
      if (!next) return -1;
      cur = next;
    }
    return -1;
  };

  for (const { line: op, deviceId } of ops) {
    info.ops++;
    if (!info.foldedTo[deviceId] || op.hlc > info.foldedTo[deviceId]!) info.foldedTo[deviceId] = op.hlc;
    const drop = (reason: string) => info.dropped.push({ deviceId, id: op.id, op: op.op, reason });
    if (op.op === 'label_speaker') {
      // LWW per speaker against the folded label's HLC: a late line older than the folded label changes nothing.
      const id = op.speakerId!;
      const label = op.label!.replace(/\s+/g, ' ').trim();
      const existing = speakers.find((s) => s.id === id);
      if (existing) {
        if (op.hlc > (existing.labelHlc ?? '')) {
          existing.label = label;
          existing.labelHlc = op.hlc;
          info.speakerHlc[id] = op.hlc;
        }
      } else {
        speakers.push({ id, label, labelHlc: op.hlc });
        info.speakerHlc[id] = op.hlc;
      }
      continue;
    }
    const i = indexOf(op.segment!);
    if (i < 0) {
      drop('segment missing');
      continue;
    }
    const seg = segments[i]!;
    seg.editHlc ??= {};
    switch (op.op) {
      case 'set_text': {
        const old = seg.text;
        if (op.hlc > (seg.editHlc.text ?? '')) {
          seg.text = op.text!;
          seg.editHlc.text = op.hlc;
          delete seg.words;   // word times no longer match the corrected text
        }
        // The editor saw another text than the one this line replaces: two corrections met. A later line
        // that names the current text (someone reviewed it, "Keep this one") clears the flag.
        if (op.base !== undefined && op.base === sha1Hex(old)) concurrent.delete(seg.id);
        else concurrent.add(seg.id);
        touch(seg.id, deviceId);
        break;
      }
      case 'set_speaker':
        if (op.hlc > (seg.editHlc.speaker ?? '')) {
          seg.speaker = op.speaker!;
          seg.editHlc.speaker = op.hlc;
          listSpeaker(op.speaker!);
        }
        touch(seg.id, deviceId);
        break;
      case 'split': {
        const at = op.atChar!;
        const newId = op.newId!;
        if (!(at > 0 && at < seg.text.length) || used.has(newId)) {
          drop('invalid split');
          break;
        }
        const atMs = Math.min(Math.max(op.atMs!, seg.startMs), seg.endMs);
        const created: Segment = { id: newId, startMs: atMs, endMs: seg.endMs, speaker: seg.speaker, text: seg.text.slice(at).trim() };
        if (seg.words) {
          const before = seg.words.filter((w) => w.startMs < atMs);
          const after = seg.words.filter((w) => w.startMs >= atMs);
          if (before.length) seg.words = before;
          else delete seg.words;
          if (after.length) created.words = after;
        }
        created.editHlc = { text: op.hlc, ...(seg.editHlc.speaker ? { speaker: seg.editHlc.speaker } : {}) };
        seg.text = seg.text.slice(0, at).trim();
        seg.endMs = atMs;
        seg.editHlc.text = op.hlc > (seg.editHlc.text ?? '') ? op.hlc : seg.editHlc.text;
        segments.splice(i + 1, 0, created);
        used.add(newId);
        info.splitFrom[newId] = info.splitFrom[seg.id] ?? seg.id;
        touch(seg.id, deviceId);
        touch(newId, deviceId);
        break;
      }
      case 'merge': {
        const j = indexOf(op.with!);
        if (j < 0 || j === i) {
          drop('merge target missing');
          break;
        }
        const w = segments[j]!;
        seg.text = seg.text + ' ' + w.text;
        seg.endMs = Math.max(seg.endMs, w.endMs);
        seg.merged = [...(seg.merged ?? []), w.id, ...(w.merged ?? [])];
        if (seg.words && w.words) seg.words = [...seg.words, ...w.words];
        else delete seg.words;
        seg.editHlc.text = op.hlc > (seg.editHlc.text ?? '') ? op.hlc : seg.editHlc.text;
        for (const m of [w.id, ...(w.merged ?? [])]) info.redirects[m] = seg.id;
        for (const [k, v] of Object.entries(info.redirects)) if (v === w.id) info.redirects[k] = seg.id;
        if (concurrent.delete(w.id)) concurrent.add(seg.id);
        const wt = touched.get(w.id);
        if (wt) for (const d of wt) touch(seg.id, d);
        touched.delete(w.id);
        segments.splice(j, 1);
        touch(seg.id, deviceId);
        break;
      }
    }
  }

  for (const s of segments) if (s.editHlc && Object.keys(s.editHlc).length === 0) delete s.editHlc;
  segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (const [id, set] of touched) if (segments.some((s) => s.id === id)) info.touched[id] = [...set].sort();

  const audio = opts.audioSha256;
  const transcript: EffectiveTranscript = {
    ...t,
    speakers,
    segments,
    concurrent: segments.filter((s) => concurrent.has(s.id)).map((s) => s.id),
    unfolded: info.ops,
    stale: audio !== undefined && audio !== null && t.audioSha256 !== audio,
    newer: opts.newer ?? false,
  };
  return { transcript, info };
}

/** The effective transcript (folder spec §8.9). */
export function effective(t: TranscriptFile, logs: readonly EditLog[], opts: ReplayOptions = {}): EffectiveTranscript {
  return replay(t, logs, opts).transcript;
}

/** Finds a segment by id, following merged redirects (old anchors). */
export function findSegment(t: Pick<TranscriptFile, 'segments'>, id: SegmentId): Segment | null {
  const direct = t.segments.find((s) => s.id === id);
  if (direct) return direct;
  return t.segments.find((s) => s.merged?.includes(id)) ?? null;
}
