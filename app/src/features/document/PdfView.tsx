// The PDF view of a document (UX §3.7.2): pdf.js's PDFViewer (text layer for selection, lazy page rendering, the
// PDFFindController for Ctrl/⌘+F), bytes read through the platform with range requests for large files, the cited
// passage drawn as `mark.cite` with a 4 px `--mark-edge` bar in the page margin, and my private highlights drawn
// over their quotes. Each page container is `doc-pdf-page` (data-index = page − 1).
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ClassId } from '../../core/model/ids';
import type { Annotation } from '../../services/types/notes';
import type { AppServices } from '../../services/types/common';
import { documentOptions, loadPdfjs } from './pdfjs';
import { rangeOf, rectsIn } from './locate';

/** Files up to this size are read at once; larger ones through range requests (C10). */
const WHOLE_MAX = 6 * 1024 * 1024;
const RANGE_CHUNK = 256 * 1024;

export interface PdfSelection { text: string; page: number; rect: { top: number; left: number; width: number; height: number }; pageText: string }
export interface PdfOutlineItem { title: string; page: number | null; depth: number; dest: unknown }
export interface PdfHandle {
  goTo(page: number): void;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  actualSize(): void;
  find(query: string, opts: { again?: boolean; previous?: boolean }): void;
  closeFind(): void;
  goToDest(dest: unknown): void;
  /** Shows a quote on a page (a highlight clicked in the side panel). */
  reveal(page: number, quote: string): void;
}

interface Props {
  services: AppServices;
  classId: ClassId;
  path: string;
  initialPage: number | null;
  /** The cited passage: drawn on `citePage` once it is known (null = none; undefined = still looking). */
  cite: { page: number; quote: string } | null;
  highlights: readonly Annotation[];
  onReady(info: { pages: number; labels: Array<string | null> | null; outline: PdfOutlineItem[] }): void;
  onPage(page: number): void;
  onScale(scale: number): void;
  onFind(r: { current: number; total: number; state: 'found' | 'notFound' | 'pending' | 'wrapped' }): void;
  onSelection(s: PdfSelection | null): void;
  onError(reason: 'damaged' | 'password' | 'other', message: string): void;
}

type ViewerT = InstanceType<typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs').PDFViewer>;
type BusT = InstanceType<typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs').EventBus>;
type LinkT = InstanceType<typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs').PDFLinkService>;

const NO_L10N = {
  getLanguage: () => 'en', getDirection: () => 'ltr', get: async () => '', translate: async () => undefined, translateOnce: async () => undefined,
  pause: () => undefined, resume: () => undefined, destroy: async () => undefined,
};

export const PdfView = forwardRef<PdfHandle, Props>(function PdfView(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerT | null>(null);
  const bus = useRef<BusT | null>(null);
  const link = useRef<LinkT | null>(null);
  const live = useRef(props);
  live.current = props;
  const revealQuote = useRef<{ page: number; quote: string } | null>(null);

  /** Draws the cited passage and the highlights of one page over its text layer. */
  const decorate = (pageNumber: number, scrollToCite: boolean) => {
    const pv = viewer.current?.getPageView(pageNumber - 1) as { div?: HTMLDivElement; textLayer?: { div?: HTMLDivElement } } | undefined;
    const pageDiv = pv?.div;
    const layer = pv?.textLayer?.div;
    if (!pageDiv || !layer) return;
    pageDiv.querySelector(':scope > .doc-overlays')?.remove();
    const overlays = document.createElement('div');
    overlays.className = 'doc-overlays';
    overlays.setAttribute('aria-hidden', 'true');
    const p = live.current;
    for (const h of p.highlights) {
      const target = h.target;
      if (!target) continue;
      const loc = target.locator;
      const page = loc.type === 'page' ? loc.page : loc.type === 'article' ? loc.pages?.[0] ?? null : null;
      if (page !== pageNumber || !target.quote.exact) continue;
      const r = rangeOf(layer, target.quote.exact);
      if (!r) continue;
      for (const rect of rectsIn(r, pageDiv)) {
        const el = document.createElement('div');
        el.className = 'hl doc-hl';
        el.dataset.mk = h.colour ?? 'other';
        el.dataset.annotationId = h.id;
        Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        overlays.appendChild(el);
      }
    }
    const marks: HTMLElement[] = [];
    const cites = [p.cite, revealQuote.current].filter((c): c is { page: number; quote: string } => !!c && c.page === pageNumber);
    for (const c of cites) {
      const r = rangeOf(layer, c.quote);
      if (!r) continue;
      const rects = rectsIn(r, pageDiv);
      for (const rect of rects) {
        const m = document.createElement('mark');
        m.className = 'cite doc-cite';
        Object.assign(m.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        overlays.appendChild(m);
        marks.push(m);
      }
      if (rects.length) {
        const top = Math.min(...rects.map((x) => x.top));
        const bottom = Math.max(...rects.map((x) => x.top + x.height));
        const bar = document.createElement('div');
        bar.className = 'doc-cite-bar';
        Object.assign(bar.style, { top: `${top}px`, height: `${bottom - top}px` });
        overlays.appendChild(bar);
      }
    }
    pageDiv.appendChild(overlays);
    if (scrollToCite && marks[0]) marks[0].scrollIntoView({ block: 'center', inline: 'nearest' });
  };
  const decorateRef = useRef(decorate);
  decorateRef.current = decorate;

  useImperativeHandle(ref, () => ({
    goTo(page) {
      if (viewer.current && page >= 1 && page <= viewer.current.pagesCount) viewer.current.currentPageNumber = page;
    },
    zoomIn: () => viewer.current?.increaseScale(),
    zoomOut: () => viewer.current?.decreaseScale(),
    fit() {
      if (viewer.current) viewer.current.currentScaleValue = 'page-width';
    },
    actualSize() {
      if (viewer.current) viewer.current.currentScaleValue = '1';
    },
    find(query, { again = false, previous = false }) {
      bus.current?.dispatch('find', { source: null, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
    },
    closeFind() {
      bus.current?.dispatch('findbarclose', { source: null });
    },
    goToDest(dest) {
      void link.current?.goToDestination(dest as string);
    },
    reveal(page, quote) {
      revealQuote.current = { page, quote };
      if (viewer.current) viewer.current.currentPageNumber = page;
      const pv = viewer.current?.getPageView(page - 1) as { textLayer?: { div?: HTMLDivElement } } | undefined;
      if (pv?.textLayer?.div?.childElementCount) decorateRef.current(page, true);
    },
  }), []);

  // Load pdf.js and the document once per file.
  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    let resize: ResizeObserver | null = null;
    const { services, classId, path } = props;
    const platform = services.ctx.platform;
    void (async () => {
      try {
        const { lib, viewer: V } = await loadPdfjs();
        if (cancelled || !box.current || !inner.current) return;
        const eventBus = new V.EventBus();
        const linkService = new V.PDFLinkService({ eventBus });
        const findController = new V.PDFFindController({ eventBus, linkService });
        const pdfViewer = new V.PDFViewer({
          container: box.current, viewer: inner.current, eventBus, linkService, findController,
          textLayerMode: 1, removePageBorders: false, l10n: NO_L10N as never,
        } as never);
        linkService.setViewer(pdfViewer);
        viewer.current = pdfViewer;
        bus.current = eventBus;
        link.current = linkService;

        const tagPages = () => {
          inner.current?.querySelectorAll<HTMLElement>('.page').forEach((el) => {
            const n = Number(el.dataset.pageNumber);
            el.dataset.testid = 'doc-pdf-page';
            el.setAttribute('data-testid', 'doc-pdf-page');
            el.dataset.index = String(n - 1);
          });
        };
        eventBus.on('pagesinit', () => {
          tagPages();
          pdfViewer.currentScaleValue = 'auto';
          const first = live.current.cite?.page ?? live.current.initialPage;
          if (first && first >= 1 && first <= pdfViewer.pagesCount) {
            pdfViewer.currentPageNumber = first;
            // Once the scale has laid the pages out, put the page at the top again.
            requestAnimationFrame(() => {
              if (viewer.current === pdfViewer && !live.current.cite) pdfViewer.scrollPageIntoView({ pageNumber: first });
            });
          }
        });
        // The container changed size (side panel, window): a preset scale (auto, fit width) is applied again.
        resize = new ResizeObserver(() => {
          const v = viewer.current;
          if (!v || !v.pagesCount) return;
          const preset = v.currentScaleValue;
          if (preset === 'auto' || preset === 'page-width' || preset === 'page-fit') v.currentScaleValue = preset;
        });
        resize.observe(box.current);
        eventBus.on('pagerendered', tagPages);
        eventBus.on('pagechanging', (e: { pageNumber: number }) => live.current.onPage(e.pageNumber));
        eventBus.on('scalechanging', (e: { scale: number }) => live.current.onScale(e.scale));
        eventBus.on('textlayerrendered', (e: { pageNumber: number }) => {
          const p = live.current;
          const isCite = (!!p.cite && p.cite.page === e.pageNumber) || revealQuote.current?.page === e.pageNumber;
          decorateRef.current(e.pageNumber, isCite && !scrolled.has(e.pageNumber));
          if (isCite) scrolled.add(e.pageNumber);
        });
        const scrolled = new Set<number>();
        eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => {
          live.current.onFind({ current: e.matchesCount.current, total: e.matchesCount.total, state: e.matchesCount.total ? 'found' : 'notFound' });
        });
        eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount: { current: number; total: number } }) => {
          const state = e.state === 0 ? 'found' : e.state === 1 ? 'notFound' : e.state === 2 ? 'wrapped' : 'pending';
          live.current.onFind({ current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0, state });
        });

        const st = await platform.fs.stat(classId, path);
        if (!st) throw Object.assign(new Error('missing'), { name: 'MissingPDFException' });
        let src: Record<string, unknown>;
        if (st.size <= WHOLE_MAX) {
          src = { data: await platform.fs.read(classId, path) };
        } else {
          const initial = await platform.fs.readRange(classId, path, 0, RANGE_CHUNK);
          class Transport extends lib.PDFDataRangeTransport {
            override requestDataRange(begin: number, end: number) {
              void platform.fs.readRange(classId, path, begin, end - begin).then((chunk) => this.onDataRange(begin, chunk), () => undefined);
            }
          }
          src = { range: new Transport(st.size, initial), length: st.size, rangeChunkSize: RANGE_CHUNK, disableAutoFetch: true, disableStream: true };
        }
        if (cancelled) return;
        const loadingTask = lib.getDocument({ ...documentOptions(), ...src } as never);
        task = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        pdfViewer.setDocument(doc as never);
        linkService.setDocument(doc as never);
        const labels = await doc.getPageLabels().catch(() => null);
        if (labels) pdfViewer.setPageLabels(labels);
        const outline: PdfOutlineItem[] = [];
        const raw = await doc.getOutline().catch(() => null);
        const walk = async (items: Array<{ title: string; dest: unknown; items: unknown[] }>, depth: number) => {
          for (const it of items.slice(0, 200)) {
            let page: number | null = null;
            try {
              const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
              if (Array.isArray(dest) && dest[0]) page = (await doc.getPageIndex(dest[0] as never)) + 1;
            } catch {
              page = null;
            }
            outline.push({ title: it.title, page, depth, dest: it.dest });
            if (it.items?.length && depth < 2) await walk(it.items as never, depth + 1);
          }
        };
        if (raw) await walk(raw as never, 0);
        if (!cancelled) live.current.onReady({ pages: doc.numPages, labels, outline });
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string }).name ?? '';
        live.current.onError(name === 'PasswordException' ? 'password' : name === 'InvalidPDFException' ? 'damaged' : 'other', String((e as Error).message ?? e));
      }
    })();
    return () => {
      cancelled = true;
      resize?.disconnect();
      void task?.destroy().catch(() => undefined);
      viewer.current?.cleanup?.();
      viewer.current = null;
      bus.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.classId, props.path]);

  // Highlights or the cited passage changed: draw the rendered pages again.
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    for (let i = 0; i < v.pagesCount; i++) {
      const pv = v.getPageView(i) as { textLayer?: { div?: HTMLDivElement } } | undefined;
      if (pv?.textLayer?.div?.childElementCount) decorateRef.current(i + 1, false);
    }
  }, [props.highlights, props.cite]);

  // The cited page became known after the document opened (the text cache answered later).
  useEffect(() => {
    const v = viewer.current;
    if (v && props.cite && v.pagesCount && props.cite.page <= v.pagesCount) v.currentPageNumber = props.cite.page;
  }, [props.cite]);

  const onPointerUp = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !box.current) {
        live.current.onSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null;
      const pageEl = startEl?.closest<HTMLElement>('.page');
      if (!pageEl || !box.current.contains(pageEl) || !startEl?.closest('.textLayer')) {
        live.current.onSelection(null);
        return;
      }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 2) {
        live.current.onSelection(null);
        return;
      }
      const r = range.getBoundingClientRect();
      const layer = pageEl.querySelector('.textLayer');
      live.current.onSelection({ text: text.slice(0, 300), page: Number(pageEl.dataset.pageNumber), rect: { top: r.top, left: r.left, width: r.width, height: r.height }, pageText: layer?.textContent ?? '' });
    }, 0);
  };

  return (
    <div className="pdfv-host">
      <div ref={box} className="pdfv" tabIndex={0} onPointerUp={onPointerUp} onKeyUp={(e) => e.shiftKey && onPointerUp()} data-testid="doc-pdf">
        <div ref={inner} className="pdfViewer" />
      </div>
    </div>
  );
});
