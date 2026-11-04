// Citations in the UI (UX §4.1, §4.5): where a chip goes (the route of its locator), the re-resolution of statuses
// (`ok` / `moved` / `changed` / `missing`, critique G13) through SearchService.resolve, `tramado:` links inside
// answers and study notes, and opening the palette with a query ("Search for the passage", "Search instead").
import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { Citation as StorageCitation } from '../../core/model/files';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { ViewCitation } from '../../services/types/viewModels';
import { openPalette } from '../../shell/CommandPalette';
import type { Route } from '../../shell/routes';
import type { I18n } from '../../ui/i18n';

/** The route a citation opens (UX §4.5 table); null for hallucinated or missing sources. */
export function citationRoute(c: ViewCitation, play = false, classIdOverride?: ClassId): Route | null {
  const s = c.source;
  if (!s || c.status === 'hallucinated' || c.status === 'missing') return null;
  const classId = classIdOverride ?? s.classId;
  const exact = s.quote.exact || undefined;
  const l = s.locator;
  switch (s.type) {
    case 'document': {
      if (!s.relPath) return null;
      const page = l.kind === 'page' || l.kind === 'article' ? l.page : undefined;
      const slide = l.kind === 'slide' ? l.slide : undefined;
      return {
        name: 'document', classId, relPath: s.relPath, ...(s.sha256 ? { sha256: s.sha256 } : {}),
        ...(page !== undefined ? { page } : {}), ...(slide !== undefined ? { slide } : {}), ...(exact ? { quote: exact } : {}),
        ...(s.private ? { private: true } : {}),
      };
    }
    case 'lecture':
      if (!s.lectureId) return null;
      return {
        name: 'lecture', classId, lectureId: s.lectureId,
        ...(l.kind === 'time' ? { at: l.ms, ...(l.segmentId ? { segmentId: l.segmentId } : {}) } : {}),
        ...(exact ? { quote: exact } : {}), ...(play ? { play: true } : {}),
      };
    case 'exam':
      if (!s.examId) return null;
      return { name: 'exam', classId, examId: s.examId, ...(l.kind === 'question' ? { questionId: l.questionId } : {}) };
    case 'note':
      if (!s.relPath) return null;
      return { name: 'note', classId, relPath: s.relPath, private: !!s.private, ...(exact ? { quote: exact } : {}) };
  }
}

/** A view citation back in the storage shape SearchService.resolve reads (source, quote; the locator is not used). */
function storageOf(c: ViewCitation): StorageCitation | null {
  const s = c.source;
  if (!s) return null;
  const quote = s.quote.exact ? s.quote : null;
  const base = { ref: c.ref, label: s.title, locator: { type: 'whole' } as const, quote };
  if ((s.type === 'document' || s.type === 'note') && s.relPath && s.sha256) return { ...base, source: { kind: s.type, path: s.relPath, sha256: s.sha256 } };
  if (s.type === 'lecture' && s.lectureId) return { ...base, source: { kind: 'lecture', lectureId: s.lectureId, audioSha256: null, transcriptRevision: 0 } };
  if (s.type === 'exam' && s.examId) return { ...base, source: { kind: 'exam', examId: s.examId } };
  return null;
}

const cache = new Map<string, { status: ViewCitation['status']; relPath?: string }>();
const keyOf = (classId: string, rev: number, c: ViewCitation) => {
  const s = c.source!;
  return [classId, rev, s.type, s.relPath ?? '', s.sha256 ?? '', s.lectureId ?? '', s.examId ?? '', s.quote.exact].join('|');
};

/**
 * Citations with their statuses re-checked against the class as it is now (UX §4.1 "Resolving"): a file at its path
 * with its hash is `ok`, the same hash elsewhere is `moved` (the route uses the new path), the passage found again in
 * a changed file is `changed`, otherwise `missing`. Private notes and hallucinated refs are kept as they are.
 */
export function useResolvedCitations(services: AppServices, citations: readonly ViewCitation[], classOf?: (c: ViewCitation) => ClassId): ViewCitation[] {
  const [resolved, setResolved] = useState<Map<string, { status: ViewCitation['status']; relPath?: string }>>(new Map());
  const classIds = useMemo(() => [...new Set(citations.map((c) => classOf?.(c) ?? c.source?.classId).filter((x): x is string => !!x))], [citations, classOf]);
  const revs = classIds.map((id) => {
    try {
      return services.forClass(id).store.state.get().revision;
    } catch {
      return 0;
    }
  });
  const revKey = revs.join(',');
  useEffect(() => {
    let live = true;
    const out = new Map<string, { status: ViewCitation['status']; relPath?: string }>();
    void (async () => {
      for (const c of citations) {
        if (!c.source || c.status === 'hallucinated' || c.source.private) continue;
        const classId = classOf?.(c) ?? c.source.classId;
        const st = storageOf(c);
        if (!st) continue;
        let rev = 0;
        try {
          rev = services.forClass(classId).store.state.get().revision;
        } catch {
          continue;
        }
        const k = keyOf(classId, rev, c);
        let hit = cache.get(k);
        if (!hit) {
          try {
            const r = await services.search.resolve(classId, st);
            hit = r.status === 'exact' ? { status: 'ok' } : r.status === 'missing' ? { status: 'missing' } : { status: r.status, ...(r.path ? { relPath: r.path } : {}) };
            if (cache.size > 500) cache.clear();
            cache.set(k, hit);
          } catch {
            continue;
          }
        }
        out.set(`${c.ref}:${c.n}`, hit);
      }
      if (live) setResolved(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citations, revKey, services]);
  // Lectures and exams are titled as they are now (a renamed lecture keeps its chips right).
  const titleOf = (c: ViewCitation): string | null => {
    const s = c.source;
    if (!s) return null;
    try {
      const cls = services.forClass(classOf?.(c) ?? s.classId);
      if (s.type === 'lecture' && s.lectureId) return cls.lectures.list.get().find((l) => l.id === s.lectureId)?.title ?? null;
      if (s.type === 'exam' && s.examId) return cls.exams.list.get().papers.find((p) => p.examId === s.examId)?.title ?? null;
    } catch {
      return null;
    }
    return null;
  };
  return useMemo(() => citations.map((c) => {
    const r = resolved.get(`${c.ref}:${c.n}`);
    const title = titleOf(c);
    const src = c.source && title && title !== c.source.title ? { ...c.source, title } : c.source;
    if (!r || !src || (r.status === c.status && !r.relPath)) return src === c.source ? c : { ...c, source: src };
    return { ...c, status: r.status, source: r.relPath ? { ...src, relPath: r.relPath } : src };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [citations, resolved, revKey]);
}

/** Opens the command palette with `query` typed in (the shell's `openPalette`, G2). */
export function openPaletteWith(query: string): void {
  openPalette(query);
}

/** A `tramado:` link of an answer or a note (UX §3.8): lecture time links and document links. */
export function routeOfLink(href: string, classId: ClassId): Route | null {
  const lec = /^tramado:lecture\/([0-9A-HJKMNP-TV-Z]{26})(?:\?t=(\d+))?$/i.exec(href);
  if (lec) return { name: 'lecture', classId, lectureId: lec[1]!, ...(lec[2] ? { at: Number(lec[2]) } : {}) };
  const doc = /^tramado:doc\/([^?#]+)(?:\?page=(\d+))?$/i.exec(href);
  if (doc) {
    try {
      return { name: 'document', classId, relPath: decodeURIComponent(doc[1]!), ...(doc[2] ? { page: Number(doc[2]) } : {}) };
    } catch {
      return null;
    }
  }
  return null;
}

/** "30 Oct" (this year) or "30 Oct 2025": the short date of an answer's header. */
export function shortDate(i18n: Pick<I18n, 'meta'>, iso: string, now: DateTime): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return '';
  const d = dt.setLocale(i18n.meta.bcp47);
  const opts: Intl.DateTimeFormatOptions = d.year === now.year ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  const s = d.toLocaleString(opts);
  // Some locales (pt-PT) write a short day-month as "30/10": spell the month out instead.
  return /\d\/\d/.test(s) ? d.toLocaleString({ ...opts, month: 'long' }) : s;
}
