// Documents that are not PDFs (UX §3.7.2 "Other formats"), as a `.reading` article: DOCX through mammoth → HTML →
// an allow-list rendered as React elements (no innerHTML: nothing outside the list survives, no attributes but
// colspan/rowspan), PPTX one section per slide (`route.slide` scrolls to it), Markdown through MarkdownView (no raw
// HTML), TXT with its line breaks, HTML pages through the same allow-list, ODT/RTF from the extracted text.
import React, { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { docxToHtml } from '../../core/import/docx';
import { decodeHtml } from '../../core/import/html';
import { pptxToText } from '../../core/import/pptx';
import { decodeText } from '../../core/import/text';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { DocSummary } from '../../services/types/documents';
import type { Annotation } from '../../services/types/notes';
import { MarkdownView } from '../../ui/tramado/MarkdownView';
import { useI18n } from '../../ui/i18n';
import { rangeOf, rectsIn } from './locate';

const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote', 'br', 'sub', 'sup']);
const RENAME: Record<string, string> = { b: 'strong', i: 'em' };
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'head', 'title', 'noscript', 'img', 'video', 'audio', 'canvas', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base']);

/** Sanitised HTML as React elements (the allow-list of UX §3.7.2). */
export function safeHtml(html: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let key = 0;
  const walk = (node: Node): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const raw = el.tagName.toLowerCase();
    if (DROP.has(raw)) return null;
    const tag = RENAME[raw] ?? raw;
    const children = Array.from(el.childNodes).map(walk).filter((c) => c !== null && c !== '');
    if (!ALLOWED.has(tag)) return children.length ? createElement(React.Fragment, { key: key++ }, ...children) : null;
    const props: Record<string, unknown> = { key: key++ };
    if (tag === 'td' || tag === 'th') {
      for (const [attr, prop] of [['colspan', 'colSpan'], ['rowspan', 'rowSpan']] as const) {
        const n = Number(el.getAttribute(attr));
        if (Number.isInteger(n) && n > 1 && n <= 100) props[prop] = n;
      }
    }
    if (tag === 'br') return createElement('br', props);
    // A table row outside a body is moved into one by React's DOM rules anyway; keep the structure.
    return createElement(tag, props, ...children);
  };
  return Array.from(doc.body.childNodes).map(walk).filter((c) => c !== null);
}

export interface TextViewHandle { scrollToSlide(n: number): void; reveal(quote: string): void }

interface Props {
  services: AppServices;
  classId: ClassId;
  doc: DocSummary;
  slide: number | null;
  cite: string | null;
  highlights: readonly Annotation[];
  onReady(info: { slides?: number; found?: boolean }): void;
  onError(message: string): void;
  onSelection(s: { text: string; rect: { top: number; left: number; width: number; height: number }; slide: number | null; blockText: string } | null): void;
  onLink(href: string): void;
}

type Content =
  | { kind: 'html'; nodes: ReactNode[] }
  | { kind: 'slides'; slides: Array<{ title: string; lines: string[]; notes: string[] }> }
  | { kind: 'md'; source: string }
  | { kind: 'plain'; text: string };

export const TextView = forwardRef<TextViewHandle, Props>(function TextView(props, ref) {
  const { t } = useI18n();
  const [content, setContent] = useState<Content | null>(null);
  const article = useRef<HTMLElement>(null);
  const live = useRef(props);
  live.current = props;
  const [reveal, setReveal] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    scrollToSlide(n) {
      article.current?.querySelector(`[data-slide="${n}"]`)?.scrollIntoView({ block: 'start' });
    },
    reveal(quote) {
      setReveal(quote);
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    const { services, classId, doc } = props;
    void (async () => {
      try {
        const platform = services.ctx.platform;
        let c: Content;
        if (doc.kind === 'docx') {
          const bytes = await platform.fs.read(classId, doc.path);
          c = { kind: 'html', nodes: safeHtml((await docxToHtml(bytes)).html) };
        } else if (doc.kind === 'html') {
          const bytes = await platform.fs.read(classId, doc.path);
          c = { kind: 'html', nodes: safeHtml(decodeHtml(bytes).text) };
        } else if (doc.kind === 'pptx') {
          const bytes = await platform.fs.read(classId, doc.path);
          const s = pptxToText(bytes);
          const slides = s.slideStarts.map((start, i) => {
            const end = i + 1 < s.slideStarts.length ? s.slideStarts[i + 1]! : s.text.length;
            const note = s.notes.find((n) => n.slide === i + 1);
            const body = s.text.slice(start, note ? note.start : end).split('\n').map((l) => l.trim()).filter(Boolean);
            const notes = note ? s.text.slice(note.start, note.end).split('\n').map((l) => l.trim()).filter(Boolean) : [];
            return { title: body[0] ?? '', lines: body.slice(1), notes };
          });
          c = { kind: 'slides', slides };
        } else if (doc.kind === 'md') {
          c = { kind: 'md', source: decodeText(await platform.fs.read(classId, doc.path)) };
        } else if (doc.kind === 'txt') {
          c = { kind: 'plain', text: decodeText(await platform.fs.read(classId, doc.path)) };
        } else {
          // ODT, RTF: the extracted text.
          c = { kind: 'plain', text: (await services.forClass(classId).documents.text(doc.path)).text };
        }
        if (cancelled) return;
        setContent(c);
      } catch (e) {
        if (!cancelled) live.current.onError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.classId, props.doc.path, props.doc.mtimeMs]);

  // After rendering: the slide asked for, the cited quote and my highlights.
  useEffect(() => {
    const el = article.current;
    if (!content || !el) return;
    const p = live.current;
    el.querySelector(':scope > .doc-overlays')?.remove();
    const overlays = document.createElement('div');
    overlays.className = 'doc-overlays';
    overlays.setAttribute('aria-hidden', 'true');
    for (const h of p.highlights) {
      const q = h.target?.quote.exact;
      const r = q ? rangeOf(el, q) : null;
      if (!r) continue;
      for (const rect of rectsIn(r, el)) {
        const d = document.createElement('div');
        d.className = 'hl doc-hl';
        d.dataset.mk = h.colour ?? 'other';
        Object.assign(d.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        overlays.appendChild(d);
      }
    }
    let first: HTMLElement | null = null;
    let found: boolean | undefined;
    for (const q of [p.cite, reveal].filter((x): x is string => !!x)) {
      const r = rangeOf(el, q);
      if (q === p.cite) found = !!r;
      if (!r) continue;
      const rects = rectsIn(r, el);
      for (const rect of rects) {
        const m = document.createElement('mark');
        m.className = 'cite doc-cite';
        Object.assign(m.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        overlays.appendChild(m);
        first ??= m;
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
    el.appendChild(overlays);
    if (first) first.scrollIntoView({ block: 'center' });
    else if (p.slide) el.querySelector(`[data-slide="${p.slide}"]`)?.scrollIntoView({ block: 'start' });
    p.onReady({ ...(content.kind === 'slides' ? { slides: content.slides.length } : {}), ...(found !== undefined ? { found } : {}) });
  }, [content, props.highlights, props.cite, reveal, props.slide]);

  const onPointerUp = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const el = article.current;
      if (!sel || sel.isCollapsed || !sel.rangeCount || !el) {
        live.current.onSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        live.current.onSelection(null);
        return;
      }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 2) {
        live.current.onSelection(null);
        return;
      }
      const start = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null;
      const slideEl = start?.closest<HTMLElement>('[data-slide]');
      const r = range.getBoundingClientRect();
      live.current.onSelection({ text: text.slice(0, 300), rect: { top: r.top, left: r.left, width: r.width, height: r.height }, slide: slideEl ? Number(slideEl.dataset.slide) : null, blockText: el.textContent ?? '' });
    }, 0);
  };

  if (!content) {
    return (
      <div className="doc-reading-wrap" aria-busy>
        <div className="doc-reading doc-reading--skeleton reading" aria-hidden>
          {[92, 100, 86, 97, 60, 0, 94, 88, 99, 72].map((w, i) => <span key={i} className="skeleton doc-skel-line" style={{ width: `${w}%` }} />)}
        </div>
        <span className="visually-hidden" role="status">{t('documents.view.loading')}</span>
      </div>
    );
  }
  return (
    <div className="doc-reading-wrap" onPointerUp={onPointerUp} onKeyUp={(e) => e.shiftKey && onPointerUp()}>
      <article ref={article} className={`doc-reading reading doc-reading--${content.kind}`} data-testid="doc-text" tabIndex={0}>
        {content.kind === 'html' ? content.nodes : null}
        {content.kind === 'md' ? <MarkdownView source={content.source} links="all" onLink={props.onLink} className="markdown" /> : null}
        {content.kind === 'plain' ? <div className="doc-plain">{content.text}</div> : null}
        {content.kind === 'slides' ? content.slides.map((s, i) => (
          <section key={i} className="doc-slide" data-slide={i + 1} data-testid="doc-slide" aria-label={t('documents.view.slide', { n: i + 1 })}>
            <header className="doc-slide__head">
              <span className="doc-slide__n">{t('documents.view.slide', { n: i + 1 })}</span>
            </header>
            <h2 className="doc-slide__title">{s.title || t('documents.view.slide', { n: i + 1 })}</h2>
            {s.lines.length ? <ul>{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul> : null}
            {s.notes.length ? <aside className="doc-slide__notes">{s.notes.map((l, j) => <p key={j}>{l}</p>)}</aside> : null}
          </section>
        )) : null}
      </article>
    </div>
  );
});
