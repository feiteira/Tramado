// The note editor's Markdown commands (UX §3.8 toolbar): bold, italic, heading, bulleted list, checklist, link,
// timestamp and document links. Pure: each takes the text and the selection and returns the new text and selection.

export interface Edit { text: string; start: number; end: number }

/** Wraps the selection in `mark` (or removes it when already wrapped); an empty selection gets a placeholder. */
export function wrap(text: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const sel = text.slice(start, end);
  const before = text.slice(Math.max(0, start - mark.length), start);
  const after = text.slice(end, end + mark.length);
  if (before === mark && after === mark) {
    return { text: text.slice(0, start - mark.length) + sel + text.slice(end + mark.length), start: start - mark.length, end: end - mark.length };
  }
  if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
    const inner = sel.slice(mark.length, sel.length - mark.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  const body = sel || placeholder;
  // Markdown emphasis does not take surrounding spaces: keep them outside the marks.
  const lead = /^\s*/.exec(body)![0];
  const trail = /\s*$/.exec(body)![0];
  const core = body.slice(lead.length, body.length - trail.length) || placeholder;
  const next = `${lead}${mark}${core}${mark}${trail}`;
  const s = start + lead.length + mark.length;
  return { text: text.slice(0, start) + next + text.slice(end), start: s, end: s + core.length };
}

const lineStart = (text: string, i: number) => text.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (text: string, i: number) => {
  const n = text.indexOf('\n', i);
  return n < 0 ? text.length : n;
};

/**
 * Toggles a line prefix on every line of the selection: '## ' (heading), '- ' (bullets), '- [ ] ' (checklist).
 * Other list or heading prefixes on those lines are replaced.
 */
export function toggleLines(text: string, start: number, end: number, prefix: string): Edit {
  const a = lineStart(text, start);
  const b = lineEnd(text, Math.max(start, end - (end > start && text[end - 1] === '\n' ? 1 : 0)));
  const lines = text.slice(a, b).split('\n');
  const PREFIX = /^(\s*)(#{1,6}\s+|- \[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;
  const all = lines.every((l) => !l.trim() || l.trimStart().startsWith(prefix));
  const out = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const m = PREFIX.exec(l)!;
    const indent = m[1] ?? '';
    const rest = l.slice(m[0].length);
    return all ? `${indent}${rest}` : `${indent}${prefix}${rest}`;
  });
  const next = out.join('\n');
  const delta = next.length - (b - a);
  return { text: text.slice(0, a) + next + text.slice(b), start: lines.length === 1 ? Math.max(a, start + (out[0]!.length - lines[0]!.length)) : a, end: lines.length === 1 ? Math.max(a, end + delta) : a + next.length };
}

/** `[label](href)`, the label being the selection (or `fallback`), selected after insertion. */
export function link(text: string, start: number, end: number, href: string, fallback: string): Edit {
  const label = (text.slice(start, end) || fallback).replace(/[[\]]/g, '');
  const md = `[${label}](${href})`;
  return { text: text.slice(0, start) + md + text.slice(end), start: start + 1, end: start + 1 + label.length };
}

/** Inserts `snippet` at the caret (replacing the selection), with a space before it when the caret follows a word. */
export function insert(text: string, start: number, end: number, snippet: string): Edit {
  const pad = start > 0 && /\S/.test(text[start - 1]!) ? ' ' : '';
  const next = text.slice(0, start) + pad + snippet + text.slice(end);
  const caret = start + pad.length + snippet.length;
  return { text: next, start: caret, end: caret };
}

/** "41:12" or "1:05:00" from milliseconds (timestamp links, UX §3.8). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Milliseconds from "41:12", "1:05:00" or "90" (seconds); null when not a time. */
export function parseClock(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs * 1000;
}

/** `[41:12](tramado:lecture/<id>?t=2472000)` (UX §3.8). */
export const timeLink = (lectureId: string, ms: number) => `[${clock(ms)}](tramado:lecture/${lectureId}?t=${Math.round(ms)})`;

/** `[Lei Fundamental, p. 9](tramado:doc/<urlencoded relPath>?page=9)` (UX §3.8). */
export function docLink(relPath: string, title: string, page: number | null, pageWord: (n: number) => string): string {
  const label = page ? `${title}, ${pageWord(page)}` : title;
  return `[${label.replace(/[[\]]/g, '')}](tramado:doc/${encodeURIComponent(relPath)}${page ? `?page=${page}` : ''})`;
}

/** A `tramado:` link of a note as a route target. */
export function parseTramadoLink(href: string): { kind: 'lecture'; id: string; ms: number | null } | { kind: 'doc'; path: string; page: number | null } | null {
  const m = /^tramado:(lecture|doc)\/([^?#]+)(?:\?([^#]*))?$/i.exec(href.trim());
  if (!m) return null;
  const params = new URLSearchParams(m[3] ?? '');
  let id: string;
  try {
    id = decodeURIComponent(m[2]!);
  } catch {
    return null;
  }
  if (m[1]!.toLowerCase() === 'lecture') {
    const tt = Number(params.get('t'));
    return { kind: 'lecture', id, ms: params.has('t') && Number.isFinite(tt) && tt >= 0 ? tt : null };
  }
  const p = Number(params.get('page'));
  return { kind: 'doc', path: id, page: params.has('page') && Number.isInteger(p) && p > 0 ? p : null };
}
