// From the lab (research trama-ts §4.3, verified identical to rankPassages): Trama's rank.ts BM25 (same folding, stop words, 6-letter stems, 600-char
// windows, question down-weighting), but with the units tokenised ONCE into an inverted index so
// each query costs milliseconds, and with caller-supplied units (pages, articles, slides,
// transcript turns) carrying a locator for citations.
import { foldWithMap, originalSpan } from './text';

export type Locator =
  | { kind: 'page'; page: number; label?: string }
  | { kind: 'slide'; slide: number }
  | { kind: 'time'; ms: number }
  | { kind: 'article'; label: string; page?: number }
  | { kind: 'none' };

export interface UnitSpan { start: number; end: number; locator?: Locator }

export interface IndexedPassage {
  documentId: string;
  start: number;
  end: number;
  text: string;
  score: number;
  locator: Locator;
  hits: { start: number; end: number }[];
}

const WINDOW = 600;
const STEM = 6;
const K1 = 1.2;
const B = 0.75;
const ASKED = 0.5;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export function stems(text: string, stop: ReadonlySet<string>): { stem: string; start: number; end: number }[] {
  const f = foldWithMap(text, { caseSensitive: false, accentSensitive: false });
  const out: { stem: string; start: number; end: number }[] = [];
  for (const m of f.folded.matchAll(WORD)) {
    const w = m[0];
    if (w.length < 3 || stop.has(w) || /^\d+$/.test(w)) continue;
    const o = originalSpan(f, m.index, m.index + w.length);
    out.push({ stem: w.length > STEM ? w.slice(0, STEM) : w, start: o.start, end: o.end });
  }
  return out;
}

/** Trama's default units: paragraphs, long ones cut into ~600-char windows at sentence ends. */
export function paragraphUnits(text: string): UnitSpan[] {
  const out: UnitSpan[] = [];
  let at = 0;
  while (at <= text.length) {
    let nl = text.indexOf('\n', at);
    if (nl < 0) nl = text.length;
    let a = at;
    while (a < nl) {
      let b = nl;
      if (b - a > WINDOW) {
        const slice = text.slice(a, a + WINDOW);
        const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
        b = a + (stop > WINDOW / 3 ? stop + 1 : Math.max(slice.lastIndexOf(' '), WINDOW / 2));
      }
      if (text.slice(a, b).trim()) out.push({ start: a, end: b });
      a = b;
      while (a < nl && /\s/.test(text[a]!)) a++;
    }
    at = nl + 1;
  }
  return out;
}

interface Unit { doc: string; start: number; end: number; len: number; asks: boolean; locator: Locator; live: boolean }

export class PassageIndex {
  private units: Unit[] = [];
  private postings = new Map<string, number[]>(); // stem → [unitIndex, tf, unitIndex, tf, ...]
  private texts = new Map<string, string>();
  private liveCount = 0;
  private liveLen = 0;

  constructor(private readonly stop: ReadonlySet<string>) {}

  add(id: string, text: string, unitSpans: UnitSpan[] = paragraphUnits(text)): void {
    if (this.texts.has(id)) this.remove(id);
    this.texts.set(id, text);
    for (const s of unitSpans) {
      const ws = stems(text.slice(s.start, s.end), this.stop);
      if (!ws.length) continue;
      const tf = new Map<string, number>();
      for (const w of ws) tf.set(w.stem, (tf.get(w.stem) ?? 0) + 1);
      const u = this.units.length;
      this.units.push({ doc: id, start: s.start, end: s.end, len: ws.length, asks: /[?¿]\s*$/.test(text.slice(s.start, s.end)), locator: s.locator ?? { kind: 'none' }, live: true });
      for (const [t, n] of tf) {
        let p = this.postings.get(t);
        if (!p) this.postings.set(t, (p = []));
        p.push(u, n);
      }
      this.liveCount++;
      this.liveLen += ws.length;
    }
  }

  /** Lazy: units are marked dead (rebuild the index when many are). */
  remove(id: string): void {
    this.texts.delete(id);
    for (const u of this.units) if (u.doc === id && u.live) {
      u.live = false;
      this.liveCount--;
      this.liveLen -= u.len;
    }
  }

  search(query: string, opts: { limit?: number; exclude?: (doc: string) => boolean } = {}): IndexedPassage[] {
    const want = new Set(stems(query, this.stop).map((w) => w.stem));
    if (!want.size || !this.liveCount) return [];
    const n = this.liveCount;
    const avg = this.liveLen / n;
    const scores = new Map<number, number>();
    for (const t of want) {
      const p = this.postings.get(t);
      if (!p) continue;
      let df = 0;
      for (let i = 0; i < p.length; i += 2) if (this.units[p[i]!]!.live) df++;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < p.length; i += 2) {
        const u = this.units[p[i]!]!;
        if (!u.live || opts.exclude?.(u.doc)) continue;
        const tf = p[i + 1]!;
        scores.set(p[i]!, (scores.get(p[i]!) ?? 0) + (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * u.len) / avg)));
      }
    }
    return [...scores]
      .map(([i, s]) => ({ u: this.units[i]!, score: this.units[i]!.asks ? s * ASKED : s }))
      .sort((a, b) => b.score - a.score || (a.u.doc < b.u.doc ? -1 : a.u.doc > b.u.doc ? 1 : a.u.start - b.u.start))
      .slice(0, opts.limit ?? 30)
      .map(({ u, score }) => {
        const text = this.texts.get(u.doc)!.slice(u.start, u.end);
        const hits = stems(text, this.stop).filter((w) => want.has(w.stem)).map((w) => ({ start: u.start + w.start, end: u.start + w.end }));
        return { documentId: u.doc, start: u.start, end: u.end, text, score, locator: u.locator, hits };
      });
  }
}
