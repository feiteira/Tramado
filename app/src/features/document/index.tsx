// The document view (route `document`, UX §3.7.2, `screen-document`): a PDF through pdf.js with the article index
// (or the PDF outline), the toolbar (page, prev/next, zoom, fit width, find, side panel), the cited passage
// (`mark.cite` + margin bar, ±1 page, then the whole document; `doc-quote-missing` otherwise), private highlights
// and comments through the selection toolbar (highlight, comment, explain, ask, copy with source); DOCX/PPTX/MD/TXT/
// HTML/ODT/RTF as text, images, unsupported files; the scan banner with AI reading; states loading, arriving,
// error, moved, changed since cited.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Ellipsis, ExternalLink, FileQuestion, FolderOpen, PanelRight, ScanText, Search,
  Sparkles, TableOfContents, Trash2, X, ZoomIn, ZoomOut, Lock, MoveHorizontal,
} from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import type { AskTurn } from '../../services/types/ask';
import type { AppServices } from '../../services/types/common';
import type { DocSummary, TextCache } from '../../services/types/documents';
import type { Annotation } from '../../services/types/notes';
import type { ViewCitation } from '../../services/types/viewModels';
import { Missing } from '../../shell/Placeholder';
import { useRouter } from '../../shell/router';
import type { Route } from '../../shell/routes';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useKeyLabel } from '../../shell/keys';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { EmptyState, Notice, ProgressBar, Spinner } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { MenuButton } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { CostLine } from '../../ui/tramado/CostLine';
import { SelectionToolbar, type SelectionAction } from '../../ui/tramado/SelectionToolbar';
import { useNavigatorRegistration } from '../search/navigate';
import { ImageView } from './ImageView';
import { contextOf, findQuote, pageOfQuote, rangesOf } from './locate';
import { PdfView, type PdfHandle, type PdfOutlineItem, type PdfSelection } from './PdfView';
import { SidePanel, type SideTab } from './SidePanel';
import { TextView, type TextViewHandle } from './TextView';
import './document.css';

type DocRoute = Extract<Route, { name: 'document' }>;
const NO_LIST: Annotation[] = [];
const NO_ANNOTATIONS = { get: () => NO_LIST, subscribe: () => () => undefined };
const TEXT_VIEW = new Set<DocSummary['kind']>(['docx', 'pptx', 'md', 'txt', 'html', 'odt', 'rtf']);
const SIDE_KEY = 'tramado.doc.side';
const ARTICLES_KEY = 'tramado.doc.articles';
const MAX_OCR = 20;

const readFlag = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const writeFlag = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    // per-device convenience
  }
};

interface Sel { text: string; page: number | null; slide: number | null; rect: { top: number; left: number; width: number; height: number }; context: string }

export default function DocumentScreen({ route, services }: { route: DocRoute; services: AppServices }) {
  useNavigatorRegistration();
  const cls = services.forClass(route.classId);
  const docs = useStore(cls.documents.list);
  const storeState = useStore(cls.store.state);
  const classes = useStore(services.library.classes);
  const view = classes.find((c) => c.id === route.classId);
  const [arriving, setArriving] = useState<{ name: string } | null | undefined>(undefined);

  let doc = docs.find((d) => d.path === route.relPath);
  let moved: string | null = null;
  if (!doc && route.sha256) {
    const m = docs.find((d) => d.sha256 === route.sha256);
    if (m) {
      doc = m;
      moved = m.path;
    }
  }
  const loading = storeState.status === 'loading' || (!doc && route.sha256 !== undefined && docs.some((d) => d.sha256 === null));

  // Not here: still arriving from a classmate (shared class, in the global index), or gone.
  useEffect(() => {
    if (doc || loading) return;
    let live = true;
    if (!view?.shared) {
      setArriving(null);
      return;
    }
    void services.ctx.platform.sync.fileInfo(route.classId, [route.relPath]).then((infos) => {
      const i = infos[0];
      if (!live) return;
      if (!i || i.globalDeleted || !i.globalModifiedBy) {
        setArriving(null);
        return;
      }
      const by = cls.info.detail.get().people.find((p) => p.devices.some((d) => d.deviceId.startsWith(i.globalModifiedBy!)));
      setArriving({ name: by?.name ?? '' });
    }, () => live && setArriving(null));
    return () => {
      live = false;
    };
  }, [doc, loading, view?.shared, route.classId, route.relPath, services, cls]);

  if (!doc) {
    if (loading || arriving === undefined) return <DocLoading name={route.relPath.slice(route.relPath.lastIndexOf('/') + 1)} />;
    if (arriving) return <DocArriving name={route.relPath.slice(route.relPath.lastIndexOf('/') + 1)} from={arriving.name} />;
    return <Missing what="document" />;
  }
  return <DocumentView key={doc.path} route={route} services={services} doc={doc} moved={moved} />;
}

function DocLoading({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <>
      <ScreenHeader title={name} />
      <div className="docview" data-testid="screen-document" aria-busy>
        <div className="docview__loading">
          <div className="doc-page-skeleton" aria-hidden><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
          <span className="visually-hidden" role="status">{t('documents.view.loading')}</span>
        </div>
      </div>
    </>
  );
}

function DocArriving({ name, from }: { name: string; from: string }) {
  const { t } = useI18n();
  return (
    <>
      <ScreenHeader title={name} />
      <div className="docview" data-testid="screen-document">
        <EmptyState icon={FileQuestion} title={t('documents.view.arriving', { name: from || t('documents.view.unknownAuthor'), percent: 0 })} data-testid="doc-arriving">
          <ProgressBar value={null} label={t('common.arriving')} />
        </EmptyState>
      </div>
    </>
  );
}

function DocumentView({ route, services, doc, moved }: { route: DocRoute; services: AppServices; doc: DocSummary; moved: string | null }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const key = useKeyLabel();
  const toast = useToast();
  const confirm = useConfirm();
  const { go, back, canGoBack } = useRouter();
  const cls = services.forClass(route.classId);
  const classes = useStore(services.library.classes);
  const view = classes.find((c) => c.id === route.classId);
  const ai = useStore(services.ai.settings);
  const aiOn = ai.enabled && ai.key.set;
  const pdf = useRef<PdfHandle>(null);
  const textView = useRef<TextViewHandle>(null);
  const pageInput = useRef<HTMLInputElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLDivElement>(null);

  const isPdf = doc.kind === 'pdf';
  const isText = TEXT_VIEW.has(doc.kind);
  const source = useMemo(() => (doc.sha256 ? { kind: 'document' as const, path: doc.path, sha256: doc.sha256 } : null), [doc.path, doc.sha256]);
  const annotations = useStore(source ? cls.annotations.forSource(source) : NO_ANNOTATIONS);
  const highlights = useMemo(() => annotations.filter((a) => a.visibility === 'private'), [annotations]);

  const [cache, setCache] = useState<TextCache | null>(null);
  const [pages, setPages] = useState<number | null>(doc.pages);
  const [labels, setLabels] = useState<Array<string | null> | null>(null);
  const [page, setPage] = useState<number>(route.page ?? 1);
  const [pageText, setPageText] = useState(String(route.page ?? 1));
  const [scale, setScale] = useState(1);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [error, setError] = useState<{ reason: string } | null>(null);
  const [side, setSide] = useState(() => readFlag(SIDE_KEY, false));
  const [sideTab, setSideTab] = useState<SideTab>('highlights');
  const [articlesOpen, setArticlesOpen] = useState(() => readFlag(ARTICLES_KEY, true));
  const [find, setFind] = useState<{ open: boolean; q: string; current: number; total: number; state: string }>({ open: false, q: '', current: 0, total: 0, state: '' });
  const [sel, setSel] = useState<Sel | null>(null);
  const [comment, setComment] = useState<{ sel: Sel; body: string } | null>(null);
  const [explain, setExplain] = useState<AskTurn | 'loading' | null>(null);
  const [askSeed, setAskSeed] = useState<{ text: string; n: number } | null>(null);
  const [ocr, setOcr] = useState<{ done: number; total: number } | null>(null);
  const [ocrConfirm, setOcrConfirm] = useState(false);
  const [quoteMissing, setQuoteMissing] = useState(false);
  const [cite, setCite] = useState<{ page: number; quote: string } | null>(null);
  const [citeFound, setCiteFound] = useState<boolean | null>(null);

  // The text cache (articles, the page of a cited quote, copy with source). The view never waits for it.
  useEffect(() => {
    let live = true;
    if (doc.extraction === 'unsupported') return;
    void cls.documents.text(doc.path).then((c) => live && setCache(c), () => undefined);
    return () => {
      live = false;
    };
  }, [cls, doc.path, doc.sha256, doc.extraction]);

  // The cited passage of a PDF: its page from the text (asked page, ±1, then anywhere), drawn when rendered.
  useEffect(() => {
    if (!isPdf || !route.quote) return;
    if (!cache?.pageStarts?.length) {
      if (doc.extraction === 'scan' || doc.extraction === 'failed') {
        setQuoteMissing(true);
        setCiteFound(false);
      }
      return;
    }
    const p = pageOfQuote(cache.text, cache.pageStarts, route.quote, route.page ?? null);
    if (p) {
      setCite({ page: p, quote: route.quote });
      setQuoteMissing(false);
      setCiteFound(true);
    } else {
      setCite(null);
      setQuoteMissing(true);
      setCiteFound(false);
    }
  }, [isPdf, route.quote, route.page, cache, doc.extraction]);

  // Articles (law texts: at least 2 article headings), else the PDF outline.
  const articles = useMemo(() => {
    if (!cache) return [];
    const seen = new Set<string>();
    const out: Array<{ label: string; page: number | null }> = [];
    for (const u of cache.units) {
      if (u.locator.type !== 'article' || seen.has(u.locator.article)) continue;
      seen.add(u.locator.article);
      const line = cache.text.slice(u.start, Math.min(u.end, u.start + 200)).split('\n')[0]!.trim();
      out.push({ label: line.length > 3 ? line : `art. ${u.locator.article}`, page: u.locator.pages?.[0] ?? null });
    }
    return out.length >= 2 ? out : [];
  }, [cache]);
  const navItems: Array<{ label: string; page: number | null; depth: number; dest?: unknown }> = articles.length
    ? articles.map((a) => ({ ...a, depth: 0 }))
    : outline.map((o) => ({ label: o.title, page: o.page, depth: o.depth, dest: o.dest }));
  const showNav = isPdf && navItems.length > 0;

  const labelOf = (p: number) => labels?.[p - 1] ?? String(p);
  const goPage = (p: number) => {
    if (!pages) return;
    const n = Math.max(1, Math.min(pages, p));
    pdf.current?.goTo(n);
    setPageText(labelOf(n));
  };

  // Keys of the view (UX §3.7.2): Ctrl/⌘+G page, Ctrl/⌘+F find, Ctrl/⌘+−/=/0 zoom, PageUp/PageDown pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (mod && e.key.toLowerCase() === 'g' && isPdf) {
        e.preventDefault();
        pageInput.current?.focus();
        pageInput.current?.select();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFind((f) => ({ ...f, open: true }));
        setTimeout(() => findInput.current?.select(), 0);
      } else if (mod && (e.key === '-' || e.key === '_') && isPdf) {
        e.preventDefault();
        pdf.current?.zoomOut();
      } else if (mod && (e.key === '=' || e.key === '+') && isPdf) {
        e.preventDefault();
        pdf.current?.zoomIn();
      } else if (mod && e.key === '0' && isPdf) {
        e.preventDefault();
        pdf.current?.fit();
      } else if (!mod && !inField && isPdf && (e.key === 'PageDown' || e.key === 'PageUp') && !main.current?.contains(document.activeElement)) {
        e.preventDefault();
        goPage(page + (e.key === 'PageDown' ? 1 : -1));
      } else if (e.key === 'Escape' && sel) {
        setSel(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Find in a text document: CSS highlights over every match, the current one scrolled to.
  useEffect(() => {
    if (isPdf) return;
    const root = main.current?.querySelector('.doc-reading');
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!root || !find.open || find.q.trim().length < 2) {
      reg?.delete('doc-find');
      reg?.delete('doc-find-current');
      if (find.total) setFind((f) => ({ ...f, current: 0, total: 0, state: '' }));
      return;
    }
    const ranges = rangesOf(root, find.q);
    const cur = ranges.length ? Math.min(Math.max(1, find.current || 1), ranges.length) : 0;
    if (reg && H) {
      reg.set('doc-find', new H(...ranges));
      if (cur) reg.set('doc-find-current', new H(ranges[cur - 1]!));
    }
    if (cur) ranges[cur - 1]!.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    if (ranges.length !== find.total || cur !== find.current) setFind((f) => ({ ...f, total: ranges.length, current: cur, state: ranges.length ? 'found' : 'notFound' }));
    return () => {
      reg?.delete('doc-find');
      reg?.delete('doc-find-current');
    };
  }, [find.open, find.q, find.current, isPdf, find.total]);

  const runFind = (q: string, opts: { again?: boolean; previous?: boolean } = {}) => {
    if (isPdf) pdf.current?.find(q, opts);
    else if (opts.again) setFind((f) => ({ ...f, current: f.total ? ((f.current - 1 + (opts.previous ? -1 : 1) + f.total) % f.total) + 1 : 0 }));
  };

  // ── Selection actions ──
  const locatorOf = (s: Sel) => (s.page ? { type: 'page' as const, page: s.page } : s.slide ? { type: 'slide' as const, slide: s.slide } : { type: 'whole' as const });
  const articleAt = (s: Sel): string | null => {
    if (!cache || !s.page || !cache.pageStarts?.length) return null;
    const start = cache.pageStarts[s.page - 1] ?? 0;
    const end = cache.pageStarts[s.page] ?? cache.text.length;
    const hit = findQuote(cache.text.slice(start, end), s.text);
    if (!hit) return null;
    const pos = start + hit.start;
    const u = cache.units.find((x) => x.start <= pos && pos < x.end && x.locator.type === 'article');
    return u && u.locator.type === 'article' ? u.locator.article : null;
  };
  const onSelectionAction = async (a: SelectionAction, kind?: string) => {
    const s = sel;
    if (!s) return;
    const quote = { exact: s.text, ...contextOf(s.context, s.text) };
    try {
      if (a === 'highlight') {
        if (!source) return;
        await cls.annotations.add({ visibility: 'private', kind: 'highlight', target: { source, locator: locatorOf(s), quote }, colour: (kind ?? 'important') as Annotation['colour'] });
        setSel(null);
        window.getSelection()?.removeAllRanges();
      } else if (a === 'comment') {
        setComment({ sel: s, body: '' });
      } else if (a === 'copy') {
        const file = doc.name;
        const article = articleAt(s);
        const text = s.page
          ? (article ? t('documents.view.copySourceArticle', { text: s.text, file, article, page: labelOf(s.page) }) : t('documents.view.copySource', { text: s.text, file, page: labelOf(s.page) }))
          : s.slide ? t('documents.view.copySourceSlide', { text: s.text, file, n: s.slide }) : t('documents.view.copySourcePlain', { text: s.text, file });
        await navigator.clipboard.writeText(text);
        toast.show(t('lectures.selection.copied'));
        setSel(null);
      } else if (a === 'explain') {
        if (!source) return;
        openSide('ask');
        setExplain('loading');
        setSel(null);
        const turn = await cls.ask.explain({ text: s.text, source, locator: locatorOf(s) }, 'simpler');
        setExplain(turn);
      } else if (a === 'ask') {
        openSide('ask');
        setAskSeed((x) => ({ text: s.text, n: (x?.n ?? 0) + 1 }));
        setSel(null);
      }
    } catch (e) {
      if (a === 'explain') setExplain(null);
      toast.error(e);
    }
  };

  const openSide = (tab: SideTab) => {
    setSide(true);
    writeFlag(SIDE_KEY, true);
    setSideTab(tab);
  };
  const toggleSide = () => {
    setSide((v) => {
      writeFlag(SIDE_KEY, !v);
      return !v;
    });
  };

  const jump = (h: Annotation) => {
    const l = h.target?.locator;
    const q = h.target?.quote.exact ?? '';
    if (isPdf && l?.type === 'page') pdf.current?.reveal(l.page, q);
    else if (isPdf && l?.type === 'article' && l.pages) pdf.current?.reveal(l.pages[0], q);
    else textView.current?.reveal(q);
  };

  const openCitation = async (c: ViewCitation) => {
    if (!c.source) return;
    const s = c.source;
    if (s.type === 'document' && s.relPath === doc.path) {
      const p = c.source.locator.kind === 'page' || c.source.locator.kind === 'article' ? c.source.locator.page : null;
      if (p && isPdf) pdf.current?.reveal(p, s.quote.exact);
      else textView.current?.reveal(s.quote.exact);
      return;
    }
    if (s.type === 'document' && s.relPath) {
      const p = s.locator.kind === 'page' || s.locator.kind === 'article' ? s.locator.page : undefined;
      go({ name: 'document', classId: s.classId, relPath: s.relPath, ...(s.sha256 ? { sha256: s.sha256 } : {}), ...(p ? { page: p } : {}), quote: s.quote.exact });
    } else if (s.type === 'lecture' && s.lectureId) {
      go({ name: 'lecture', classId: s.classId, lectureId: s.lectureId, ...(s.locator.kind === 'time' ? { at: s.locator.ms } : {}), quote: s.quote.exact });
    } else if (s.type === 'note' && s.relPath) {
      go({ name: 'note', classId: s.classId, relPath: s.relPath, private: !!s.private, quote: s.quote.exact });
    } else if (s.type === 'exam' && s.examId) {
      go({ name: 'exam', classId: s.classId, examId: s.examId });
    }
  };

  const onLink = (href: string) => {
    const m = /^tramado:(lecture|doc)\/([^?]+)(?:\?(.*))?$/i.exec(href);
    if (m) {
      const params = new URLSearchParams(m[3] ?? '');
      if (m[1] === 'lecture') go({ name: 'lecture', classId: route.classId, lectureId: decodeURIComponent(m[2]!), ...(params.get('t') ? { at: Number(params.get('t')) } : {}) });
      else go({ name: 'document', classId: route.classId, relPath: decodeURIComponent(m[2]!), ...(params.get('page') ? { page: Number(params.get('page')) } : {}) });
      return;
    }
    void services.ctx.platform.system.openExternal(href, { title: t('documents.view.openWith'), message: href, confirm: t('common.open'), cancel: t('common.cancel') }).catch(() => undefined);
  };

  // ── OCR (scans of ≤ 20 pages) ──
  const scanPages = doc.pages ?? pages ?? cache?.pageStarts?.length ?? null;
  const isScan = doc.extraction === 'scan';
  const ocrRequests = scanPages ?? 0;
  const ocrOffer = isScan && aiOn && scanPages !== null && scanPages <= MAX_OCR ? tp('documents.view.ocr', ocrRequests) : null;
  const runOcr = async () => {
    setOcrConfirm(false);
    setOcr({ done: 0, total: ocrRequests });
    try {
      await services.extraction.ocr!(route.classId, doc.path, { onProgress: (done, total) => setOcr({ done, total }) });
      toast.show({ tone: 'success', message: t('documents.view.ocrDone', { file: doc.name }) });
      setCache(await cls.documents.text(doc.path));
    } catch (e) {
      toast.error(e);
    } finally {
      setOcr(null);
    }
  };

  // ── Header ──
  const kindLabel = t(`documents.view.kinds.${doc.kind}`);
  const count = (pages ?? doc.pages) !== null ? (doc.kind === 'pptx' ? tp('common.count.slides', (pages ?? doc.pages)!) : tp('common.count.pages', (pages ?? doc.pages)!)) : null;
  const addedBy = doc.localOnly || doc.addedBy?.self ? t('common.you') : doc.addedBy?.name ?? null;
  const when = i18n.date(DateTime.fromMillis(doc.mtimeMs), 'medium');
  const subtitle = (
    <span className="docview__subtitle" data-testid="doc-subtitle">
      {doc.localOnly ? <span className="docview__private"><Lock size={13} aria-hidden /> {t('common.onlyThisComputer')} · </span> : null}
      {addedBy && count
        ? t('documents.view.subtitle', { type: kindLabel, count, name: addedBy, date: when })
        : addedBy ? t('documents.view.subtitleNoCount', { type: kindLabel, name: addedBy, date: when })
          : [kindLabel, count, when].filter(Boolean).join(' · ')}
    </span>
  );
  const textLabel = doc.extraction === 'ready' ? (doc.imagePages ? tp('documents.text.somePages', doc.imagePages) : t('documents.text.searchable'))
    : doc.extraction === 'scan' ? t('documents.text.scan') : doc.extraction === 'failed' ? t('documents.text.failed')
      : doc.extraction === 'unsupported' ? '—' : t('documents.text.reading', { percent: 0 });

  const remove = async () => {
    const shared = !!view?.shared && !doc.localOnly;
    const ok = await confirm({
      title: shared ? t('documents.deleteConfirm.title', { file: doc.name, class: view?.name ?? '' }) : t('documents.deleteConfirm.titleLocal', { file: doc.name }),
      body: shared ? t('documents.deleteConfirm.body') : t('documents.deleteConfirm.bodyLocal'),
      confirmLabel: shared ? t('documents.deleteConfirm.confirm') : t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const removed = await cls.documents.removeForUndo(doc.path);
      if (canGoBack) back();
      else go({ name: 'class', classId: route.classId, tab: 'documents' });
      toast.show({ message: t('documents.deleteConfirm.done', { file: doc.name }), action: { label: t('common.undo'), testId: 'toast-undo', run: () => cls.documents.restore(removed).catch((e: unknown) => toast.error(e)) } });
    } catch (e) {
      toast.error(e);
    }
  };

  const changed = !!route.sha256 && !moved && !!doc.sha256 && route.sha256 !== doc.sha256 && !!route.quote;

  return (
    <>
      <ScreenHeader
        title={doc.name}
        subtitle={subtitle}
        backTo={t('classes.tabs.documents')}
        actions={
          <>
            <Button icon={Sparkles} className="docview__ask-btn" onClick={() => openSide('ask')} data-testid="doc-ask">{t('documents.view.ask')}</Button>
            <Button icon={ExternalLink} onClick={() => void cls.documents.open(doc.path).catch((e: unknown) => toast.error(e))} data-testid="doc-open-external">{t('documents.view.openWith')}</Button>
          </>
        }
        more={
          <MenuButton
            iconOnly
            icon={Ellipsis}
            label={t('documents.view.more')}
            variant="ghost"
            align="end"
            items={[
              { id: 'reveal', label: t('common.showInFolder'), icon: FolderOpen, onSelect: () => void cls.documents.reveal(doc.path).catch((e: unknown) => toast.error(e)), testId: 'doc-more-reveal' },
              { id: 'folder', label: t('classes.tabs.documents'), icon: TableOfContents, onSelect: () => go({ name: 'class', classId: route.classId, tab: 'documents', ...(doc.dir !== cls.store.dir('documents') ? { folder: doc.dir.slice(cls.store.dir('documents').length + 1) } : {}) }), testId: 'doc-more-folder' },
              ...(ocrOffer ? [{ id: 'ocr', label: t('documents.menu.ocr'), icon: ScanText, onSelect: () => setOcrConfirm(true), testId: 'doc-more-ocr' }] : []),
              { kind: 'separator' as const },
              { id: 'delete', label: view?.shared && !doc.localOnly ? t('documents.menu.delete') : t('documents.menu.deleteLocal'), icon: Trash2, danger: true, onSelect: () => void remove(), testId: 'doc-more-delete' },
            ]}
            data-testid="doc-more"
          />
        }
      />
      <div className="docview" data-testid="screen-document" data-doc-path={doc.path} data-kind={doc.kind}>
        <div className="docview__notices">
          {moved ? <Notice tone="info" data-testid="doc-moved">{t('documents.view.moved', { path: moved })}</Notice> : null}
          {changed && citeFound !== null ? <Notice tone="warning" data-testid="doc-changed">{citeFound ? t('documents.view.changed') : t('documents.view.changedLost')}</Notice> : null}
          {quoteMissing && !changed ? <Notice tone="warning" data-testid="doc-quote-missing">{t('documents.view.quoteMissing')}</Notice> : null}
          {isScan ? (
            <Notice
              tone="warning"
              icon={ScanText}
              data-testid="doc-scan-banner"
              actions={
                ocr ? null
                  : !aiOn ? <Button size="sm" onClick={() => go({ name: 'settings', section: 'ai' })} data-testid="doc-ocr-setup">{t('documents.view.setUpAi')}</Button>
                    : ocrOffer ? <Button size="sm" icon={Sparkles} onClick={() => setOcrConfirm(true)} data-testid="doc-ocr">{ocrOffer}</Button>
                      : null
              }
            >
              <span>{t('documents.view.scan')}</span>
              {scanPages !== null && scanPages > MAX_OCR ? <span className="docview__scan-note"> {t('documents.view.ocrTooLong')}</span> : null}
              {ocr ? (
                <span className="docview__ocr" data-testid="doc-ocr-progress">
                  <span>{t('documents.view.ocrProgress', { i: Math.min(ocr.done + 1, ocr.total), n: ocr.total })}</span>
                  <ProgressBar value={ocr.total ? ocr.done / ocr.total : null} label={t('documents.view.ocrProgress', { i: Math.min(ocr.done + 1, ocr.total), n: ocr.total })} />
                </span>
              ) : null}
            </Notice>
          ) : null}
        </div>

        {(isPdf || isText) && !error ? (
          <div className={cx('docview__toolbar', !isPdf && 'docview__toolbar--text')} role="toolbar" aria-label={t('documents.view.find')} data-testid="doc-toolbar">
            {isPdf ? (
              <>
                {navItems.length ? (
                  <IconButton icon={TableOfContents} label={t('documents.view.articlesToggle')} pressed={articlesOpen} onClick={() => setArticlesOpen((v) => { writeFlag(ARTICLES_KEY, !v); return !v; })} data-testid="doc-articles-toggle" />
                ) : null}
                <div className="docview__pager">
                  <IconButton icon={ChevronLeft} label={t('documents.view.prev')} shortcut="PageUp" disabled={page <= 1} onClick={() => goPage(page - 1)} data-testid="doc-prev" />
                  <label className="docview__page">
                    <span className="visually-hidden">{t('documents.view.pageInput')}</span>
                    <input
                      ref={pageInput}
                      className="docview__page-input"
                      value={pageText}
                      inputMode="numeric"
                      size={3}
                      onChange={(e) => setPageText(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => setPageText(labelOf(page))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const v = pageText.trim();
                        const byLabel = labels?.findIndex((l) => l === v) ?? -1;
                        goPage(byLabel >= 0 ? byLabel + 1 : Number(v) || page);
                      }}
                      aria-label={t('documents.view.pageInput')}
                      title={`${t('documents.view.page')} (${key('G')})`}
                      data-testid="doc-page"
                    />
                    <span className="docview__page-total t-tabular">/ {pages ?? '…'}</span>
                    {labels && labels[page - 1] && labels[page - 1] !== String(page) ? <span className="t-small t-muted">({page})</span> : null}
                  </label>
                  <IconButton icon={ChevronRight} label={t('documents.view.next')} shortcut="PageDown" disabled={!pages || page >= pages} onClick={() => goPage(page + 1)} data-testid="doc-next" />
                </div>
                <span className="docview__sep" aria-hidden />
                <IconButton icon={ZoomOut} label={t('documents.view.zoomOut')} shortcut={key('-')} onClick={() => pdf.current?.zoomOut()} data-testid="doc-zoom-out" />
                <span className="docview__zoom t-tabular" aria-live="polite">{Math.round(scale * 100)} %</span>
                <IconButton icon={ZoomIn} label={t('documents.view.zoomIn')} shortcut={key('=')} onClick={() => pdf.current?.zoomIn()} data-testid="doc-zoom-in" />
                <Button size="sm" variant="ghost" icon={MoveHorizontal} onClick={() => pdf.current?.fit()} title={key('0')} data-testid="doc-fit">{t('documents.view.fit')}</Button>
              </>
            ) : null}
            <span className="docview__spacer" />
            <IconButton
              icon={Search}
              label={t('documents.view.find')}
              shortcut={key('F')}
              pressed={find.open}
              onClick={() => {
                setFind((f) => ({ ...f, open: !f.open }));
                setTimeout(() => findInput.current?.focus(), 0);
              }}
              data-testid="doc-find"
            />
            <IconButton icon={PanelRight} label={t('documents.view.sideToggle')} pressed={side} onClick={toggleSide} data-testid="doc-side-toggle" />
          </div>
        ) : null}

        {find.open ? (
          <div className="docview__find" role="search" data-testid="doc-findbar">
            <Search size={15} aria-hidden className="t-muted" />
            <input
              ref={findInput}
              className="docview__find-input"
              value={find.q}
              placeholder={t('documents.view.find')}
              aria-label={t('documents.view.find')}
              onChange={(e) => {
                const q = e.target.value;
                setFind((f) => ({ ...f, q, current: 0 }));
                if (isPdf) runFind(q);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runFind(find.q, { again: true, previous: e.shiftKey });
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setFind((f) => ({ ...f, open: false }));
                  pdf.current?.closeFind();
                }
              }}
              data-testid="doc-find-input"
            />
            <span className="docview__find-count t-small t-muted t-tabular" aria-live="polite" data-testid="doc-find-count">
              {find.q.trim().length >= 2 ? (find.total ? t('documents.view.findCount', { i: find.current || 1, n: find.total }) : find.state === 'notFound' ? t('documents.view.findNone') : '') : ''}
            </span>
            <IconButton icon={ChevronUp} size="sm" label={t('documents.view.findPrev')} onClick={() => runFind(find.q, { again: true, previous: true })} data-testid="doc-find-prev" />
            <IconButton icon={ChevronDown} size="sm" label={t('documents.view.findNext')} onClick={() => runFind(find.q, { again: true })} data-testid="doc-find-next" />
            <IconButton icon={X} size="sm" label={t('documents.view.findClose')} onClick={() => { setFind((f) => ({ ...f, open: false })); pdf.current?.closeFind(); }} data-testid="doc-find-close" />
          </div>
        ) : null}

        <div className={cx('docview__body', side && 'docview__body--side', showNav && articlesOpen && 'docview__body--nav', !isPdf && 'docview__body--text')}>
          {showNav && articlesOpen ? (
            <nav className="docnav" aria-label={articles.length ? t('documents.view.articles') : t('documents.view.outline')} data-testid="doc-articles">
              <h2 className="docnav__title">{articles.length ? t('documents.view.articles') : t('documents.view.outline')}</h2>
              <ol className="docnav__list">
                {navItems.map((a, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={cx('docnav__item', a.page === page && 'docnav__item--here')}
                      style={{ paddingInlineStart: `calc(var(--s-2) + ${a.depth * 12}px)` }}
                      onClick={() => (a.dest !== undefined && !a.page ? pdf.current?.goToDest(a.dest) : a.page ? goPage(a.page) : undefined)}
                      data-testid="doc-article"
                      data-index={i}
                    >
                      <span className="docnav__label">{a.label}</span>
                      {a.page ? <span className="docnav__page t-tabular">{t('documents.view.pageShort', { n: labelOf(a.page) })}</span> : null}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <div className="docview__main" ref={main}>
            {error ? (
              <EmptyState
                icon={FileQuestion}
                title={t('documents.view.error', { reason: error.reason })}
                actions={<Button icon={ExternalLink} onClick={() => void cls.documents.open(doc.path).catch((e: unknown) => toast.error(e))} data-testid="doc-error-open">{t('common.openWithSystem')}</Button>}
                data-testid="doc-error"
              />
            ) : isPdf ? (
              <PdfView
                ref={pdf}
                services={services}
                classId={route.classId}
                path={doc.path}
                initialPage={route.page ?? null}
                cite={cite}
                highlights={highlights}
                onReady={(info) => {
                  setPages(info.pages);
                  setLabels(info.labels);
                  setOutline(info.outline);
                }}
                onPage={(p) => {
                  setPage(p);
                  if (document.activeElement !== pageInput.current) setPageText(labels?.[p - 1] ?? String(p));
                }}
                onScale={setScale}
                onFind={(r) => setFind((f) => ({ ...f, current: r.current, total: r.total, state: r.state }))}
                onSelection={(s: PdfSelection | null) => setSel(s ? { text: s.text, page: s.page, slide: null, rect: s.rect, context: s.pageText } : null)}
                onError={(reason, message) => setError({ reason: reason === 'password' ? t('documents.view.errorPassword') : reason === 'damaged' ? t('documents.view.errorDamaged') : message })}
              />
            ) : isText ? (
              <TextView
                ref={textView}
                services={services}
                classId={route.classId}
                doc={doc}
                slide={route.slide ?? null}
                cite={route.quote ?? null}
                highlights={highlights}
                onReady={(info) => {
                  if (info.slides) setPages(info.slides);
                  if (route.quote && info.found !== undefined) {
                    setQuoteMissing(!info.found);
                    setCiteFound(info.found);
                  }
                }}
                onError={(message) => setError({ reason: message })}
                onSelection={(s) => setSel(s ? { text: s.text, page: null, slide: s.slide, rect: s.rect, context: s.blockText } : null)}
                onLink={onLink}
              />
            ) : doc.kind === 'image' ? (
              <ImageView services={services} classId={route.classId} doc={doc} />
            ) : (
              <EmptyState
                icon={FileQuestion}
                title={t('documents.view.unsupported')}
                actions={<Button icon={ExternalLink} onClick={() => void cls.documents.open(doc.path).catch((e: unknown) => toast.error(e))} data-testid="doc-unsupported-open">{t('common.openWithSystem')}</Button>}
                data-testid="doc-unsupported"
              />
            )}
          </div>

          {side ? (
            <SidePanel
              services={services}
              classId={route.classId}
              doc={doc}
              tab={sideTab}
              onTab={setSideTab}
              highlights={highlights}
              onJump={jump}
              explain={explain}
              askSeed={askSeed}
              onOcr={ocrOffer ? () => setOcrConfirm(true) : null}
              ocrOffer={ocrOffer}
              textLabel={textLabel}
              onOpenCitation={(c) => void openCitation(c)}
            />
          ) : null}
        </div>
      </div>

      {sel && !comment ? (
        <SelectionToolbar
          anchor={sel.rect}
          actions={aiOn && source ? ['highlight', 'comment', 'explain', 'ask', 'copy'] : source ? ['highlight', 'comment', 'copy'] : ['copy']}
          onAction={(a, k) => void onSelectionAction(a, k)}
          data-testid="doc-selection"
        />
      ) : null}

      {comment ? (
        <Dialog
          open
          onClose={() => setComment(null)}
          title={t('documents.view.commentLabel')}
          description={`“${comment.sel.text.slice(0, 160)}${comment.sel.text.length > 160 ? '…' : ''}”`}
          size="sm"
          onSubmit={() => undefined}
          data-testid="doc-comment-dialog"
          footer={
            <>
              <Button onClick={() => setComment(null)}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                disabled={!comment.body.trim() || !source}
                onClick={async () => {
                  if (!source) return;
                  const s = comment.sel;
                  try {
                    await cls.annotations.add({ visibility: 'private', kind: 'comment', target: { source, locator: locatorOf(s), quote: { exact: s.text, ...contextOf(s.context, s.text) } }, body: comment.body.trim() });
                    setComment(null);
                    setSel(null);
                    openSide('highlights');
                  } catch (e) {
                    toast.error(e);
                  }
                }}
                data-testid="doc-comment-save"
              >
                {t('documents.view.saveComment')}
              </Button>
            </>
          }
        >
          <TextArea
            label={t('documents.view.commentLabel')}
            hint={t('lectures.selection.commentHint')}
            value={comment.body}
            onChange={(v) => setComment((c) => (c ? { ...c, body: v } : c))}
            placeholder={t('documents.view.commentPlaceholder')}
            rows={4}
            data-autofocus
            data-testid="doc-comment-input"
          />
        </Dialog>
      ) : null}

      {ocrConfirm ? (
        <Dialog
          open
          onClose={() => setOcrConfirm(false)}
          title={t('documents.view.ocrConfirm')}
          size="sm"
          data-testid="doc-ocr-confirm"
          footer={
            <>
              <Button onClick={() => setOcrConfirm(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" icon={Sparkles} onClick={() => void runOcr()} data-testid="doc-ocr-run">{ocrOffer ?? t('documents.menu.ocr')}</Button>
            </>
          }
        >
          <p>{t('documents.view.ocrConfirmBody')}</p>
          <CostLine requests={ocrRequests} quota={ai.quota} model={services.ai.label(ai.model)} />
        </Dialog>
      ) : null}
      {ocr ? <span className="visually-hidden" role="status"><Spinner /> {tp('documents.view.ocrRunning', ocr.total)}</span> : null}
    </>
  );
}
