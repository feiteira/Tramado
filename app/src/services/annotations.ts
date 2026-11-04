// AnnotationService (architecture §11.2, §13.2, Q5; folder spec §8.17; research audio-pipeline §5.5):
// my comments and highlights, kept privately in `private/<classId>/annotations.jsonl` as
// AnnotationLine lines (add / edit / delete; greatest HLC wins; delete is final). Shared annotations
// (`.tramado/annotations/<me>/<YYYY-MM>.jsonl`) are v1.1: 0.1 neither writes nor displays them
// (folder spec §8.17, architecture §1.1), so `visibility: 'class'` is refused.
//
// Every annotation is re-anchored when shown: documents and notes by SHA-256 (same file → exact; the
// same content at another path → moved) and else by quote search in the current text (moved, or
// approximate for a fuzzy match, else lost); lecture transcripts per audio-pipeline §5.5 (segment,
// merged redirects, overlapping segments, then the time: approximate).
import { PlatformError } from '../core/errors';
import { newUlid } from '../core/ids';
import { EXTRACTOR, TEXT_KINDS, docKindOf, extractText } from '../core/import/extract';
import { jsonlLine } from '../core/json';
import type { AnnotationLine, Locator, SourceRef, TranscriptFile } from '../core/model/files';
import type { ClassId, Hlc, Ulid } from '../core/model/ids';
import { parseJsonl, parserFor } from '../core/model/parse';
import { findQuote, reanchorSegment } from '../core/search/anchor';
import { compareHlc } from '../core/hlc';
import type { AppContext } from './context';
import { hashMemo } from './extraction';
import { Store, type ReadableStore } from './store';
import type { AppServices, ClassStore } from './types/common';
import type { Annotation, AnnotationService } from './types/notes';

const FILE = 'annotations.jsonl';
const BODY_MAX = 8000;
const enc = new TextEncoder();
const NO_PDF = async () => {
  throw new PlatformError('UNSUPPORTED_FILE', 'not a PDF');
};

interface Folded {
  add: AnnotationLine;
  body: string | undefined;
  bodyHlc: Hlc;
  deleted: boolean;
}

/** Folds annotation lines (folder spec §8.17: edit/delete rules as chat; greatest HLC wins; delete is final). */
export function foldAnnotations(lines: readonly AnnotationLine[]): Map<Ulid, Folded> {
  const out = new Map<Ulid, Folded>();
  for (const l of lines) if (l.type === 'add' && l.annotationId === l.id && l.target && l.kind && !out.has(l.id)) {
    out.set(l.id, { add: l, body: l.body, bodyHlc: l.hlc, deleted: false });
  }
  for (const l of lines) {
    const f = out.get(l.annotationId);
    if (!f || l.memberId !== f.add.memberId) continue;
    if (l.type === 'delete') f.deleted = true;
    else if (l.type === 'edit' && compareHlc(l.hlc, f.bodyHlc) > 0) {
      f.body = l.body;
      f.bodyHlc = l.hlc;
    }
  }
  return out;
}

const sameSource = (a: SourceRef, b: SourceRef): boolean => {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'document': case 'note': return a.path === (b as typeof a).path || (!!a.sha256 && a.sha256 === (b as typeof a).sha256);
    case 'lecture': return a.lectureId === (b as typeof a).lectureId;
    case 'exam': return a.examId === (b as typeof a).examId && (!a.questionId || !(b as typeof a).questionId || a.questionId === (b as typeof a).questionId);
  }
};
const sourceKey = (s: SourceRef) => JSON.stringify(s.kind === 'document' || s.kind === 'note' ? [s.kind, s.path, s.sha256] : s.kind === 'lecture' ? [s.kind, s.lectureId] : [s.kind, s.examId, s.questionId ?? null]);

export interface AnnotationServiceImpl extends AnnotationService {
  /** Every annotation as folded (tests, AskService.annotate de-duplication). */
  all(): Promise<Annotation[]>;
  /** Resolves when the views are up to date (tests). */
  idle(): Promise<void>;
}

export function createAnnotationService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): AnnotationServiceImpl {
  const { platform } = ctx;
  const { store, classId } = cls;
  const memo = hashMemo(ctx);
  const views = new Map<string, { source: SourceRef; store: Store<Annotation[]>; listeners: number }>();
  let folded: Map<Ulid, Folded> | null = null;
  let work: Promise<void> = Promise.resolve();
  let offStore: (() => void) | null = null;

  async function load(): Promise<Map<Ulid, Folded>> {
    if (folded) return folded;
    const bytes = (await platform.privateFiles.read(classId, FILE).catch(() => null)) ?? new Uint8Array();
    const parse = parserFor('tramado.annotation');
    const lines: AnnotationLine[] = [];
    for (const l of parseJsonl(bytes).lines) {
      if (l.error) continue;
      const p = parse(l.value);
      if (p.ok && p.value && !p.newer) lines.push(p.value);
    }
    folded = foldAnnotations(lines);
    return folded;
  }

  async function append(line: AnnotationLine): Promise<void> {
    await platform.privateFiles.append(classId, FILE, enc.encode(jsonlLine(line)));
    folded = null;
    await refreshAll();
  }

  const me = () => {
    const id = ctx.identity.get();
    if (!id) throw new PlatformError('INVALID', 'no identity yet');
    return id;
  };

  // ── Re-anchoring ────────────────────────────────────────────────────────────────────────────
  async function textAt(kind: 'document' | 'note', path: string): Promise<string | null> {
    if (kind === 'note') {
      const bytes = await store.readBytes(path).catch(() => null);
      return bytes ? (await extractText(bytes, 'md', path, { pdfjs: NO_PDF })).text : null;
    }
    if (!TEXT_KINDS.has(docKindOf(path))) return null;
    return (await app().extraction.ensure(classId, path).catch(() => null))?.text ?? null;
  }

  async function transcriptOf(lectureId: Ulid): Promise<TranscriptFile | null> {
    // The lecture service's effective transcript when it has one (edits applied), else the file.
    try {
      const detail = app().forClass(classId).lectures.open(lectureId).get();
      if (detail?.transcript) return detail.transcript;
    } catch {
      // no lecture service yet
    }
    const item = store.state.get().index.lectures.get(lectureId);
    if (!item) return null;
    const t = await store.readJson<TranscriptFile>(item.dir ? `${item.dir}/transcript.json` : 'transcript.json', parserFor('tramado.transcript')).catch(() => null);
    return t && t.value.lectureId === lectureId ? t.value : null;
  }

  async function anchor(f: Folded): Promise<Pick<Annotation, 'target' | 'anchor'>> {
    const target = f.add.target!;
    const s = target.source;
    if (s.kind === 'exam') return { target, anchor: store.state.get().index.exams.has(s.examId) ? 'exact' : 'lost' };
    if (s.kind === 'lecture') {
      if (!store.state.get().index.lectures.has(s.lectureId)) return { target, anchor: 'lost' };
      if (target.locator.type !== 'segment') return { target, anchor: 'exact' };
      const t = await transcriptOf(s.lectureId);
      if (!t) return { target, anchor: 'approximate' };
      const r = reanchorSegment(t.segments, target.locator, target.quote);
      return { target: { ...target, locator: r.locator }, anchor: r.status };
    }
    // Documents and notes.
    const files = s.kind === 'note' ? store.state.get().index.notes : store.state.get().index.documents;
    const here = files.find((x) => x.path === s.path);
    const hereSha = here ? await memo.hash(classId, here.path).catch(() => null) : null;
    if (hereSha && hereSha === s.sha256) return { target, anchor: 'exact' };
    for (const x of files) {
      if (x.path === s.path) continue;
      const h = await memo.hash(classId, x.path).catch(() => null);
      if (h && h === s.sha256) return { target: { ...target, source: { ...s, path: x.path } }, anchor: 'moved' };
    }
    if (!here || !target.quote?.exact) return { target, anchor: 'lost' };
    const text = await textAt(s.kind, s.path);
    if (text === null) return { target, anchor: 'lost' };
    const hint = target.locator.type === 'text' ? target.locator.start : undefined;
    const hit = findQuote(text, target.quote, hint !== undefined ? { hint } : {});
    if (!hit) return { target, anchor: 'lost' };
    const locator: Locator = target.locator.type === 'text' ? { type: 'text', start: hit.start, end: hit.end, extractor: EXTRACTOR } : target.locator;
    return { target: { ...target, source: { ...s, sha256: hereSha ?? s.sha256 }, locator }, anchor: hit.how === 'fuzzy' ? 'approximate' : 'moved' };
  }

  async function viewOf(source: SourceRef): Promise<Annotation[]> {
    const all = await load();
    const id = ctx.identity.get();
    const out: Annotation[] = [];
    for (const f of all.values()) {
      if (f.deleted || !sameSource(f.add.target!.source, source)) continue;
      const a = await anchor(f);
      out.push({
        id: f.add.id, visibility: 'private', author: { memberId: f.add.memberId, name: id && id.memberId === f.add.memberId ? id.name : '' },
        kind: f.add.kind!, target: a.target, ...(f.add.colour ? { colour: f.add.colour } : {}), ...(f.body !== undefined ? { body: f.body } : {}),
        ...(f.add.ai ? { ai: f.add.ai } : {}), ms: f.add.ms, anchor: a.anchor,
      });
    }
    return out.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : 1));
  }

  function refreshAll(): Promise<void> {
    work = work.then(async () => {
      for (const v of views.values()) {
        const next = await viewOf(v.source).catch(() => v.store.get());
        if (JSON.stringify(next) !== JSON.stringify(v.store.get())) v.store.set(next);
      }
    });
    return work;
  }

  function watchStore() {
    if (offStore) return;
    offStore = store.onChange(['document', 'note', 'transcript', 'lecture', 'exam', 'edits'], () => void refreshAll());
  }

  const service: AnnotationServiceImpl = {
    forSource(source): ReadableStore<Annotation[]> {
      const k = sourceKey(source);
      let v = views.get(k);
      if (!v) {
        v = { source, store: new Store<Annotation[]>([]), listeners: 0 };
        views.set(k, v);
        watchStore();
        void refreshAll();
      }
      return v.store;
    },
    async add(a) {
      if (a.visibility === 'class') throw new PlatformError('NOT_IMPLEMENTED', 'shared annotations are v1.1 (folder spec §8.17)');
      if (!a.target?.source || !a.target.locator || !a.target.quote) throw new PlatformError('INVALID', 'an annotation needs a target with a quote');
      if ((a.body?.length ?? 0) > BODY_MAX) throw new PlatformError('INVALID', 'comment longer than 8 000 characters');
      const now = ctx.clock.now();
      const id = newUlid(now, ctx.rand);
      const quote = { exact: a.target.quote.exact.slice(0, 300), prefix: a.target.quote.prefix.slice(-32), suffix: a.target.quote.suffix.slice(0, 32) };
      await append({
        format: 'tramado.annotation', version: 1, type: 'add', id, annotationId: id, hlc: ctx.hlc.tick(), ms: now, memberId: me().memberId,
        kind: a.kind, target: { ...a.target, quote }, ...(a.colour ? { colour: a.colour } : {}), ...(a.body !== undefined ? { body: a.body } : {}),
        ...(a.ai ? { ai: a.ai } : {}),
      });
      return id;
    },
    async edit(id, body) {
      if (body.length > BODY_MAX) throw new PlatformError('INVALID', 'comment longer than 8 000 characters');
      const f = (await load()).get(id);
      if (!f || f.deleted) throw new PlatformError('NOT_FOUND', `no annotation ${id}`);
      const now = ctx.clock.now();
      await append({ format: 'tramado.annotation', version: 1, type: 'edit', id: newUlid(now, ctx.rand), annotationId: id, hlc: ctx.hlc.tick(), ms: now, memberId: me().memberId, body });
    },
    async remove(id) {
      const f = (await load()).get(id);
      if (!f || f.deleted) return;
      const now = ctx.clock.now();
      await append({ format: 'tramado.annotation', version: 1, type: 'delete', id: newUlid(now, ctx.rand), annotationId: id, hlc: ctx.hlc.tick(), ms: now, memberId: me().memberId });
    },
    async all() {
      const out: Annotation[] = [];
      for (const f of (await load()).values()) {
        if (f.deleted) continue;
        const a = await anchor(f);
        out.push({ id: f.add.id, visibility: 'private', author: { memberId: f.add.memberId, name: ctx.identity.get()?.name ?? '' }, kind: f.add.kind!, target: a.target,
          ...(f.add.colour ? { colour: f.add.colour } : {}), ...(f.body !== undefined ? { body: f.body } : {}), ...(f.add.ai ? { ai: f.add.ai } : {}), ms: f.add.ms, anchor: a.anchor });
      }
      return out;
    },
    async idle() {
      await work;
    },
  };
  return service;
}
