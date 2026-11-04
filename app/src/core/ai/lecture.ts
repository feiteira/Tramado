// Lecture transcripts as AI sources (summary, key terms, "Annotate with AI", study notes; UX §3.5.4): windows of
// 60–90 s aligned to segments become `S#` passages with segment locators, split into parts of ≤ 40 000 characters
// (critique G11: ⌈chars / 40k⌉ parts + 1 merge).
import type { LectureFile, Segment, SourceRef, TranscriptFile } from '../model/files';
import type { Ulid } from '../model/ids';
import { LECTURE_CHUNK_CHARS } from './cost';
import { citeRegex } from './citations';
import type { PassageLike } from './tools';

export const WINDOW_MIN_MS = 60_000;
export const WINDOW_MAX_MS = 90_000;

/** "41:12" or "1:02:03". */
export function clockOf(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function lectureSource(t: Pick<TranscriptFile, 'lectureId' | 'audioSha256' | 'revision'>): SourceRef {
  return { kind: 'lecture', lectureId: t.lectureId, audioSha256: t.audioSha256, transcriptRevision: t.revision };
}

/** Transcript windows as passages (id `<lectureId>@<startMs>`), in time order. */
export function transcriptWindows(t: TranscriptFile, title: string): PassageLike[] {
  const out: PassageLike[] = [];
  const segs = [...t.segments].filter((s) => s.text.trim()).sort((a, b) => a.startMs - b.startMs);
  let cur: Segment[] = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur[0]!;
    const last = cur.at(-1)!;
    out.push({
      id: `${t.lectureId}@${first.startMs}`, label: `${title} · ${clockOf(first.startMs)}`,
      text: cur.map((s) => s.text.trim()).join(' '), source: lectureSource(t),
      locator: { type: 'segment', segmentId: first.id, startMs: first.startMs, endMs: last.endMs },
    });
    cur = [];
  };
  for (const s of segs) {
    if (cur.length) {
      const span = s.endMs - cur[0]!.startMs;
      if (span > WINDOW_MAX_MS || (s.startMs - cur[0]!.startMs >= WINDOW_MIN_MS && s.speaker !== cur.at(-1)!.speaker)) flush();
    }
    cur.push(s);
  }
  flush();
  return out;
}

/** Splits windows into parts of at most `max` characters (one request each). */
export function lectureParts(windows: readonly PassageLike[], max = LECTURE_CHUNK_CHARS): PassageLike[][] {
  const parts: PassageLike[][] = [];
  let cur: PassageLike[] = [];
  let n = 0;
  for (const w of windows) {
    if (cur.length && n + w.text.length > max) {
      parts.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(w);
    n += w.text.length;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** `[S3]` markers → `[41:12](tramado:lecture/<id>?t=<ms>)` time links (study notes, UX §3.8 link format). */
export function timeLinks(markdown: string, lectureId: Ulid, startOf: (ref: string) => number | null): string {
  return markdown.replace(citeRegex(), (_m, refs: string) =>
    refs.split(/\s*,\s*/).map((r) => {
      const ms = startOf(r.trim());
      return ms === null ? '' : `[${clockOf(ms)}](tramado:lecture/${lectureId}?t=${ms})`;
    }).filter(Boolean).join(' '));
}

export const lectureTitle = (l: Pick<LectureFile, 'title'> | null, fallback: string): string => (l?.title?.trim() ? l.title.trim() : fallback);
