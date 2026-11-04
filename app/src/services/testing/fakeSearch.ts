// A SearchService test double (architecture §11.2; T-AI): scripted passages ranked by how many query words they
// contain (accent- and case-folded), with the `kinds` and `exclude` filters of the real service, `find` over the
// passage texts and `resolve` by source identity. The real SearchService (BM25 in a worker) comes from T-DOCS.
import { fold } from '../../core/text/normalize';
import type { Citation, SourceRef } from '../../core/model/files';
import { constant } from '../store';
import type { Passage, SearchService } from '../types/search';

const words = (q: string) => [...new Set(fold(q).split(/[^\p{L}\p{N}º]+/u).filter((w) => w.length >= 3))];
const pathOf = (s: SourceRef) => (s.kind === 'document' || s.kind === 'note' ? s.path : s.kind === 'lecture' ? s.lectureId : s.examId);
const sameSource = (a: SourceRef, b: SourceRef) => a.kind === b.kind && pathOf(a) === pathOf(b);

export interface FakeSearch extends SearchService {
  passagesGiven: Passage[];
  /** The queries asked, in order (tests check retrieval per question). */
  queries: string[];
  /** Replaces the corpus. */
  setPassages(p: Passage[]): void;
}

export function createFakeSearch(passages: Passage[] = [], opts: { all?: boolean } = {}): FakeSearch {
  let corpus = [...passages];
  const queries: string[] = [];
  const rank = (q: string, p: Passage) => {
    const t = fold(`${p.label} ${p.text}`);
    return words(q).reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  };
  const self: FakeSearch = {
    get passagesGiven() {
      return corpus;
    },
    queries,
    setPassages(p) {
      corpus = [...p];
    },
    status: (classId) => constant({ classId, state: 'ready', docs: corpus.length, pending: 0, chars: corpus.reduce((n, p) => n + p.text.length, 0) }),
    ensure: async () => undefined,
    async passages(_scope, q, o) {
      queries.push(q);
      const pool = corpus.filter((p) => (!o?.kinds?.length || o.kinds.includes(p.source.kind)) && !(o?.exclude ?? []).some((x) => pathOf(p.source) === x || p.id === x));
      const scored = pool.map((p) => ({ p, s: rank(q, p) })).filter((x) => opts.all || x.s > 0).sort((a, b) => b.s - a.s);
      return scored.slice(0, o?.limit ?? 30).map(({ p, s }) => ({ ...p, score: s || p.score }));
    },
    async passage(_c, id, o) {
      const p = corpus.find((x) => x.id === id);
      if (!p) return null;
      const off = o?.offset ?? 0;
      const max = o?.max ?? p.text.length;
      return { ...p, text: p.text.slice(off, off + max), hasMore: off + max < p.text.length };
    },
    async find(_scope, q, o) {
      const needle = fold(q.trim());
      if (!needle) return [];
      const out: Awaited<ReturnType<SearchService['find']>> = [];
      for (const p of corpus) {
        const at = fold(p.text).indexOf(needle);
        if (at < 0) continue;
        out.push({ classId: p.classId, source: p.source, label: p.label, before: p.text.slice(Math.max(0, at - 40), at), match: p.text.slice(at, at + q.trim().length), after: p.text.slice(at + q.trim().length, at + q.trim().length + 40), locator: p.locator });
        if (out.length >= (o?.limit ?? 50)) break;
      }
      return out;
    },
    async resolve(_classId, c: Citation) {
      const hit = corpus.find((p) => sameSource(p.source, c.source));
      if (hit) return { status: 'exact', route: null, label: c.label };
      if (c.quote?.exact && corpus.some((p) => fold(p.text).includes(fold(c.quote!.exact)))) return { status: 'changed', route: null, label: c.label };
      return { status: 'missing', route: null, label: c.label };
    },
  };
  return self;
}

/** A passage for tests, with the `Passage` defaults filled in. */
export function testPassage(p: Partial<Passage> & Pick<Passage, 'id' | 'text' | 'source'>): Passage {
  return { classId: 'tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa', locator: { type: 'whole' }, label: p.id, score: 1, hits: [], ...p };
}
