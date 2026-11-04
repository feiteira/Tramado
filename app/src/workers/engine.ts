// The search engine behind IndexHost (architecture §11.2, §11.7; critique C19): one PassageIndex per
// class (BM25 over caller-supplied units with citation locators), boolean search with context for the
// "search my class" box, and passage reads for the AI's read_passage tool. The same object answers
// in search.worker.ts (desktop, demo) and inline in Vitest (createInlineHost).
//
// Document keys are chosen by SearchService: `document:<path>`, `note:<path>`, `private:<path>`
// (a private note), `lecture:<lectureId>`, `exam:<examId>` — or the JSON of a SourceRef. A Passage's
// `source` is derived from the key (a document's sha256 is unknown here: the service fills it in, with
// the label). `hits` are offsets inside the passage text.
import type { ClassId } from '../core/model/ids';
import type { Locator, SourceRef } from '../core/model/files';
import { EXTRACTOR } from '../core/import/extract';
import { passageLocator, unitContaining } from '../core/search/locators';
import { PassageIndex } from '../core/search/passageIndex';
import { SearchError, searchTexts } from '../core/search/search';
import { stopwordsFor } from '../core/search/stopwords';
import type { IndexHost } from '../services/context';
import type { TextCache } from '../services/types/documents';
import type { Passage } from '../services/types/search';

/** Stop words of the three app languages together (research trama-ts §4.1: the caller's union). */
export const STOP: ReadonlySet<string> = new Set([...stopwordsFor('pt'), ...stopwordsFor('es'), ...stopwordsFor('en')]);

export type KeyKind = SourceRef['kind'];

/** The SourceRef a key stands for (best effort: a document's sha256 is left empty). */
export function sourceOfKey(key: string): SourceRef {
  const i = key.indexOf(':');
  const kind = i > 0 ? key.slice(0, i) : '';
  const rest = key.slice(i + 1);
  switch (kind) {
    case 'document': return { kind: 'document', path: rest, sha256: '' };
    case 'note': case 'private': return { kind: 'note', path: rest, sha256: '' };
    case 'lecture': return { kind: 'lecture', lectureId: rest, audioSha256: null, transcriptRevision: 0 };
    case 'exam': return { kind: 'exam', examId: rest };
  }
  try {
    const s = JSON.parse(key) as SourceRef;
    if (s && typeof s === 'object' && 'kind' in s) return s;
  } catch {
    // not JSON
  }
  return { kind: 'document', path: key, sha256: '' };
}

interface Doc { text: string; units: TextCache['units'] }
interface ClassIndexState { index: PassageIndex; docs: Map<string, Doc> }

export const passageId = (key: string, start: number, end: number) => `${key}#${start}-${end}`;

export function parsePassageId(id: string): { key: string; start: number; end: number } | null {
  const m = /^(.*)#(\d+)-(\d+)$/s.exec(id);
  return m ? { key: m[1]!, start: Number(m[2]), end: Number(m[3]) } : null;
}

export function createIndexEngine(): IndexHost {
  const classes = new Map<ClassId, ClassIndexState>();
  const cls = (classId: ClassId) => {
    let c = classes.get(classId);
    if (!c) {
      c = { index: new PassageIndex(STOP), docs: new Map() };
      classes.set(classId, c);
    }
    return c;
  };
  const add = (classId: ClassId, key: string, text: string, units: TextCache['units']) => {
    const c = cls(classId);
    const sorted = [...units].sort((a, b) => a.start - b.start);
    c.docs.set(key, { text, units: sorted });
    // No units: Trama's paragraph units (each with a text locator, filled in at query time).
    c.index.add(key, text, sorted.length ? sorted.map((u) => ({ start: u.start, end: u.end, locator: u.locator })) : undefined);
  };
  const toPassage = (classId: ClassId, key: string, doc: Doc, p: { start: number; end: number; text: string; score: number; hits: Array<{ start: number; end: number }> }): Passage => ({
    id: passageId(key, p.start, p.end), classId, source: sourceOfKey(key),
    locator: passageLocator(unitContaining(doc.units, p.start), p.start, p.end, p.hits, EXTRACTOR) as Locator,
    label: key, text: p.text, score: p.score,
    hits: p.hits.map((h) => [h.start - p.start, h.end - p.start] as [number, number]),
  });
  const scopes = (scope: ClassId | 'all') => (scope === 'all' ? [...classes.keys()] : [scope]);
  const kindOk = (key: string, kinds: KeyKind[] | undefined) => !kinds || kinds.includes(sourceOfKey(key).kind);
  /** `exclude` entries match a key, or the path / lecture id / exam id it names. */
  const excluded = (key: string, ex: ReadonlySet<string>) => {
    if (!ex.size) return false;
    if (ex.has(key)) return true;
    const s = sourceOfKey(key);
    return ex.has(s.kind === 'lecture' ? s.lectureId : s.kind === 'exam' ? s.examId : s.path);
  };

  return {
    async load(classId, docs) {
      classes.delete(classId);
      cls(classId);
      for (const d of docs) add(classId, d.key, d.text, d.units);
    },
    async upsert(classId, key, text, units) {
      add(classId, key, text, units);
    },
    async remove(classId, key) {
      const c = classes.get(classId);
      if (!c) return;
      c.docs.delete(key);
      c.index.remove(key);
    },
    async query(scope, q, opts = {}) {
      const limit = opts.limit ?? 30;
      const ex = new Set(opts.exclude ?? []);
      const out: Passage[] = [];
      for (const classId of scopes(scope)) {
        const c = classes.get(classId);
        if (!c) continue;
        for (const p of c.index.search(q, { limit, exclude: (doc) => excluded(doc, ex) || !kindOk(doc, opts.kinds) })) {
          out.push(toPassage(classId, p.documentId, c.docs.get(p.documentId)!, p));
        }
      }
      return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
    },
    async passage(classId, id, opts = {}) {
      const ref = parsePassageId(id);
      const c = classes.get(classId);
      if (!ref || !c) return null;
      const doc = c.docs.get(ref.key);
      if (!doc) return null;
      const start = Math.min(doc.text.length, ref.start + Math.max(0, opts.offset ?? 0));
      const end = Math.min(doc.text.length, opts.max !== undefined ? start + Math.max(0, opts.max) : Math.max(start, ref.end));
      return { ...toPassage(classId, ref.key, doc, { start, end, text: doc.text.slice(start, end), score: 0, hits: [] }), hasMore: end < doc.text.length };
    },
    async find(scope, q, opts = {}) {
      const limit = opts.limit ?? 200;
      const out: Array<{ classId: ClassId; key: string; before: string; match: string; after: string; start: number }> = [];
      for (const classId of scopes(scope)) {
        const c = classes.get(classId);
        if (!c || out.length >= limit) continue;
        let r;
        try {
          r = searchTexts([...c.docs].map(([id, d]) => ({ id, text: d.text })), { query: q, mode: 'words' }, { limit: limit - out.length, context: 60 });
        } catch (e) {
          if (e instanceof SearchError) return [];   // an empty or unfinished query finds nothing
          throw e;
        }
        for (const h of r.hits) out.push({ classId, key: h.documentId, before: h.before, match: h.match, after: h.after, start: h.start });
      }
      return out.slice(0, limit);
    },
    async stats(classId) {
      const c = classes.get(classId);
      return { docs: c?.docs.size ?? 0, chars: [...(c?.docs.values() ?? [])].reduce((n, d) => n + d.text.length, 0) };
    },
  };
}
