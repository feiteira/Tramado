// The body of an AI answer (UX §3.9.8, §4.2): the hardened Markdown AST of core/text/markdown.ts (no raw HTML, only
// safe links), with `[S#]` markers as CitationChips (each marker keeps its own pin-point; consecutive refs are
// separated by a thin space), unverified sentences wrapped in `span.unverified` with a trailing "Not in your
// materials" badge, headings as h4 (the case template), and `tramado:` links as in-app buttons.
import React, { type ReactNode } from 'react';
import { parseMarkdown, safeHref, type Block, type Inline } from '../../core/text/markdown';
import type { ViewCitation } from '../../services/types/viewModels';
import { CitationChip } from '../../ui/tramado/CitationChip';
import { useI18n } from '../../ui/i18n';

const OPEN = '';
const CLOSE = '';

/** Marks each unverified sentence in the source with private-use sentinels (kept as text by the parser). */
export function markUnverified(text: string, sentences: readonly string[]): string {
  let out = text;
  let from = 0;
  for (const s of sentences) {
    const needle = s.trim();
    if (!needle) continue;
    const at = out.indexOf(needle, from);
    if (at < 0) continue;
    out = `${out.slice(0, at)}${OPEN}${needle}${CLOSE}${out.slice(at + needle.length)}`;
    from = at + needle.length + 2;
  }
  return out;
}

interface Ctx {
  byRef: Map<string, ViewCitation>;
  onChip(c: ViewCitation): void;
  openChip: string | null;
  onLink(href: string): void;
  badge: string;
  unverified: { on: boolean };
}

function textPieces(v: string, ctx: Ctx, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (!buf) return;
    const lines = buf.split('\n');
    const nodes: ReactNode[] = [];
    lines.forEach((l, j) => {
      if (j) nodes.push(<br key={`${key}b${i}-${j}`} />);
      nodes.push(l);
    });
    out.push(ctx.unverified.on ? <span key={`${key}u${i}`} className="unverified">{nodes}</span> : <React.Fragment key={`${key}t${i}`}>{nodes}</React.Fragment>);
    buf = '';
    i++;
  };
  for (const ch of v) {
    if (ch === OPEN) {
      flush();
      ctx.unverified.on = true;
    } else if (ch === CLOSE) {
      flush();
      ctx.unverified.on = false;
      out.push(<span key={`${key}x${i++}`} className="unverified__badge" data-testid="ai-unverified-badge">{ctx.badge}</span>);
    } else buf += ch;
  }
  flush();
  return out;
}

function inline(nodes: Inline[], ctx: Ctx, key = ''): ReactNode[] {
  return nodes.flatMap((n, i): ReactNode[] => {
    const k = `${key}${i}.`;
    const wrap = (node: ReactNode) => (ctx.unverified.on ? <span key={k} className="unverified">{node}</span> : node);
    switch (n.t) {
      case 'text': return textPieces(n.v, ctx, k);
      case 'bold': return [wrap(<strong key={k}>{inline(n.c, ctx, k)}</strong>)];
      case 'italic': return [wrap(<em key={k}>{inline(n.c, ctx, k)}</em>)];
      case 'strike': return [wrap(<s key={k}>{inline(n.c, ctx, k)}</s>)];
      case 'code': return [wrap(<code key={k}>{n.v}</code>)];
      case 'mention': return [n.raw];
      case 'cite':
        return n.refs.map((ref, j) => {
          const base = ctx.byRef.get(ref.trim());
          const pin = j === n.refs.length - 1 ? n.pin : null;
          const c: ViewCitation = base ? { ...base, pin } : { n: 0, ref, pin, source: null, status: 'hallucinated' };
          return (
            <React.Fragment key={`${k}${j}`}>
              {j ? <span className="cchip-sep" aria-hidden>{' '}</span> : null}
              <CitationChip citation={c} onOpen={ctx.onChip} className={ctx.openChip === `${c.ref}` ? 'cchip--open' : undefined} />
            </React.Fragment>
          );
        });
      case 'link': {
        const href = safeHref(n.href);
        if (!href || !href.toLowerCase().startsWith('tramado:')) return [<span key={k}>{inline(n.c, ctx, k)}</span>];
        return [
          <button key={k} type="button" className="md-link" onClick={() => ctx.onLink(href)} data-href={href} data-testid="ai-link">
            {inline(n.c, ctx, k)}
          </button>,
        ];
      }
    }
  });
}

function block(b: Block, i: number, ctx: Ctx): ReactNode {
  switch (b.t) {
    case 'heading': return <h4 key={i}>{inline(b.c, ctx, `${i}.`)}</h4>;
    case 'para': return <p key={i}>{inline(b.c, ctx, `${i}.`)}</p>;
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return <L key={i}>{b.items.map((it, j) => <li key={j} style={it.depth ? { marginInlineStart: it.depth * 16 } : undefined}>{inline(it.c, ctx, `${i}.${j}.`)}</li>)}</L>;
    }
    case 'table':
      return (
        <table key={i}>
          <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c, ctx, `${i}.h${j}.`)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, ctx, `${i}.${j}.${k}.`)}</td>)}</tr>)}</tbody>
        </table>
      );
    case 'image': return <p key={i}>{b.alt}</p>;
    case 'quote': return <blockquote key={i}>{inline(b.c, ctx, `${i}.`)}</blockquote>;
    case 'code': return <pre key={i}><code>{b.v}</code></pre>;
    case 'rule': return <hr key={i} />;
  }
}

export interface AnswerBodyProps {
  text: string;
  citations: readonly ViewCitation[];
  unverified?: readonly string[];
  onChip(c: ViewCitation): void;
  /** The ref whose popover is open (its chip gets the open outline). */
  openRef?: string | null;
  onLink(href: string): void;
}

export function AnswerBody({ text, citations, unverified = [], onChip, openRef = null, onLink }: AnswerBodyProps) {
  const { t } = useI18n();
  const source = unverified.length ? markUnverified(text, unverified) : text;
  const blocks = parseMarkdown(source, { breaks: true, citations: true });
  const ctx: Ctx = { byRef: new Map(citations.map((c) => [c.ref, c])), onChip, openChip: openRef, onLink, badge: t('exams.answers.notInMaterials'), unverified: { on: false } };
  return <div className="answer-md" data-testid="ai-answer-text">{blocks.map((b, i) => block(b, i, ctx))}</div>;
}
