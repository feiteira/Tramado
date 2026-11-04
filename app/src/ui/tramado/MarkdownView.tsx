// MarkdownView (UX §2.11): renders core/text/markdown.ts's hardened AST — no raw HTML (markup stays
// text, escaped by React), links only to https:/mailto:/tramado: targets, images only from the media
// scheme (the parser drops everything else, critique G27). tramado: links become in-app buttons;
// https and mailto links are buttons too and go through `onLink` (Rust's open_external with a host
// confirmation), never a navigating <a>. With `citations`, `[S#]` markers render through
// `renderCite` (CitationChip, UX §4.2); with `mentions`, `<@…>` tokens through `renderMention`.
// T-DOCS hardened core/text/markdown.ts in wave 1; UI-DOCS owns this component in wave 2.
import React, { type ReactNode } from 'react';
import { parseMarkdown, safeHref, safeImageSrc, type Block, type Inline } from '../../core/text/markdown';

export interface MarkdownViewProps {
  source: string;
  links: 'internal-only' | 'all';
  onLink?(href: string): void;
  /** Read `[S#]` markers (AI answers); rendered by `renderCite`, else as plain text. */
  citations?: boolean;
  renderCite?(refs: string[], pin: string | null, key: string): ReactNode;
  /** Read `<@member>` / `<@everyone>` / `<@ai>` tokens (chat); rendered by `renderMention`, else as plain text. */
  mentions?: boolean;
  renderMention?(target: string, key: string): ReactNode;
  className?: string;
  'data-testid'?: string;
}

function inline(nodes: Inline[], props: MarkdownViewProps, key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text': return n.v;
      case 'bold': return <strong key={k}>{inline(n.c, props, k)}</strong>;
      case 'italic': return <em key={k}>{inline(n.c, props, k)}</em>;
      case 'strike': return <s key={k}>{inline(n.c, props, k)}</s>;
      case 'code': return <code key={k}>{n.v}</code>;
      case 'cite': return props.renderCite ? <React.Fragment key={k}>{props.renderCite(n.refs, n.pin, k)}</React.Fragment> : n.raw;
      case 'mention': return props.renderMention ? <React.Fragment key={k}>{props.renderMention(n.target, k)}</React.Fragment> : n.raw;
      case 'link': {
        const href = safeHref(n.href);
        const internal = href?.toLowerCase().startsWith('tramado:') ?? false;
        if (!href || (props.links === 'internal-only' && !internal)) return <span key={k}>{inline(n.c, props, k)}</span>;
        return (
          <button key={k} type="button" className="md-link" onClick={() => props.onLink?.(href)} data-href={href}>
            {inline(n.c, props, k)}
          </button>
        );
      }
    }
  });
}

function block(b: Block, i: number, props: MarkdownViewProps): ReactNode {
  switch (b.t) {
    case 'heading': {
      const H = `h${Math.min(6, Math.max(2, b.level + 1))}` as 'h2';
      return <H key={i}>{inline(b.c, props)}</H>;
    }
    case 'para': return <p key={i}>{inline(b.c, props)}</p>;
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return <L key={i}>{b.items.map((it, j) => <li key={j} style={{ marginInlineStart: it.depth * 16 }}>{inline(it.c, props)}</li>)}</L>;
    }
    case 'table':
      return (
        <table key={i}>
          <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c, props)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, props)}</td>)}</tr>)}</tbody>
        </table>
      );
    case 'image': {
      // The parser only keeps media-scheme images; checked again here (architecture §16).
      const src = safeImageSrc(b.src);
      return src ? <img key={i} src={src} alt={b.alt} /> : <p key={i}>{b.alt}</p>;
    }
    case 'quote': return <blockquote key={i}>{inline(b.c, props)}</blockquote>;
    case 'code': return <pre key={i}><code>{b.v}</code></pre>;
    case 'rule': return <hr key={i} />;
  }
}

export function MarkdownView(props: MarkdownViewProps) {
  const blocks = parseMarkdown(props.source, { breaks: true, citations: props.citations ?? false, mentions: props.mentions ?? false });
  return (
    <div className={['markdown', props.className].filter(Boolean).join(' ')} data-testid={props['data-testid'] ?? 'markdown'}>
      {blocks.map((b, i) => block(b, i, props))}
    </div>
  );
}
