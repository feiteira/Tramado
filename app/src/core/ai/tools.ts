// The tools of "Deep answer" (openrouter-lab §4, exact schemas) and the ref table that maps `S#` ↔ passages for the
// whole conversation, so citations become clickable (page / article / transcript time).
import type { Citation, Locator, SourceRef, TextQuote } from '../model/files';
import type { ToolDef } from './types';

export const SEARCH_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'search_materials',
    description: "Search this class's documents and lecture transcripts. Returns passages with a ref (S1, S2…) to cite, an id, source and location (page/article or timestamp).",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords or a question, in the language of the materials.' },
        limit: { type: 'integer', description: 'Max results (1-6). Default 4.' },
      },
      required: ['query'],
    },
  },
};
export const READ_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'read_passage',
    description: 'Read the full text of one passage returned by search_materials, by its id or ref.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
};
export const TOOLS: ToolDef[] = [SEARCH_TOOL, READ_TOOL];

/** What a search hit carries (the SearchService `Passage` fits this shape). */
export interface PassageLike {
  id: string; label: string; text: string; source: SourceRef; locator: Locator; hits?: Array<[number, number]>;
}

const QUOTE_MAX = 300;
const AFFIX = 32;

/** A TextQuote around the first hit of a passage (≤ 300 / 32 / 32 chars, folder spec §8.15). */
export function quoteOf(p: { text: string; hits?: Array<[number, number]> }): TextQuote | null {
  const text = p.text;
  if (!text.trim()) return null;
  const hit = p.hits?.[0];
  let start = 0;
  let end = Math.min(text.length, QUOTE_MAX);
  if (hit && hit[0] >= 0 && hit[0] < text.length) {
    // The sentence that holds the first hit, trimmed to 300 characters.
    const before = text.lastIndexOf('. ', hit[0]);
    start = before >= 0 && hit[0] - before < 200 ? before + 2 : Math.max(0, hit[0] - 60);
    end = Math.min(text.length, start + QUOTE_MAX);
  }
  if (end < text.length) {
    const cut = text.lastIndexOf(' ', end);
    if (cut > start + 40) end = cut;
  }
  const exact = text.slice(start, end).trim();
  if (!exact) return null;
  const s = text.indexOf(exact, start);
  return { exact, prefix: text.slice(Math.max(0, s - AFFIX), s), suffix: text.slice(s + exact.length, s + exact.length + AFFIX) };
}

export class RefTable {
  private readonly byRef = new Map<string, PassageLike>();
  private readonly byId = new Map<string, string>();

  /** The ref of a passage, assigning the next `S#` the first time it is seen. */
  add(p: PassageLike): string {
    const hit = this.byId.get(p.id);
    if (hit) return hit;
    const ref = `S${this.byRef.size + 1}`;
    this.byRef.set(ref, p);
    this.byId.set(p.id, ref);
    return ref;
  }
  get(refOrId: string): PassageLike | null {
    const r = /^S\d{1,3}$/.test(refOrId) ? refOrId : this.byId.get(refOrId);
    return (r && this.byRef.get(r)) || null;
  }
  refOf(id: string): string | null {
    return this.byId.get(id) ?? null;
  }
  refs(): Set<string> {
    return new Set(this.byRef.keys());
  }
  get size(): number {
    return this.byRef.size;
  }
  entries(): Array<[string, PassageLike]> {
    return [...this.byRef.entries()];
  }
  /** The stored citation of each ref (without `ref`/`pin`, which come from the answer's markers). */
  table(): Map<string, Omit<Citation, 'ref' | 'pin'>> {
    return new Map(this.entries().map(([ref, p]) => [ref, { source: p.source, locator: p.locator, quote: quoteOf(p), label: p.label }]));
  }
}
