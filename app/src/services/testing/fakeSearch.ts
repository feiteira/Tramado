// STUB (M0) → T-AI: a SearchService test double that returns scripted passages (architecture §11.2).
import { notImplemented } from '../../core/errors';
import { constant } from '../store';
import type { Passage, SearchService } from '../types/search';

export function createFakeSearch(passages: Passage[] = []): SearchService & { passagesGiven: Passage[] } {
  return {
    passagesGiven: passages,
    status: (classId) => constant({ classId, state: 'ready', docs: 0, pending: 0, chars: 0 }),
    ensure: async () => undefined,
    passages: async (_scope, _q, opts) => passages.slice(0, opts?.limit ?? passages.length),
    passage: async (_c, id) => {
      const p = passages.find((x) => x.id === id);
      return p ? { ...p, hasMore: false } : null;
    },
    find: () => Promise.reject(notImplemented('fakeSearch.find')),
    resolve: () => Promise.reject(notImplemented('fakeSearch.resolve')),
  };
}
