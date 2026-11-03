// MarkdownView (UX §2.11): renders core/text/markdown.ts's AST — no raw HTML, no javascript:/data: links;
// tramado: links become in-app buttons; https links go through Rust's open_external (host confirmation).
// T-DOCS hardens core/text/markdown.ts in wave 1; UI-DOCS owns this component in wave 2.
import React, { type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../../core/text/markdown';

export interface MarkdownViewProps {
  source: string;
  links: 'internal-only' | 'all';
  onLink?(href: string): void;
  className?: string;
  'data-testid'?: string;
}

const SAFE = /^(https:|mailto:|tramado:)/i;

function inline(nodes: Inline[], props: MarkdownViewProps, key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text': return n.v;
      case 'bold': return <strong key={k}>{inline(n.c, props, k)}</strong>;
      case 'italic': return <em key={k}>{inline(n.c, props, k)}</em>;
      case 'strike': return <s key={k}>{inline(n.c, props, k)}</s>;
      case 'code': return <code key={k}>{n.v}</code>;
      case 'link': {
        const internal = n.href.toLowerCase().startsWith('tramado:');
        if (!SAFE.test(n.href) || (props.links === 'internal-only' && !internal)) return <span key={k}>{inline(n.c, props, k)}</span>;
        return (
          <button key={k} type="button" className="md-link" onClick={() => props.onLink?.(n.href)} data-href={n.href}>
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
    case 'image':
      // Images only from the media scheme (architecture §16); anything else shows its alt text.
      return /^(tramado-media:|http:\/\/tramado-media\.localhost|blob:)/.test(b.src) ? <img key={i} src={b.src} alt={b.alt} /> : <p key={i}>{b.alt}</p>;
    case 'quote': return <blockquote key={i}>{inline(b.c, props)}</blockquote>;
    case 'code': return <pre key={i}><code>{b.v}</code></pre>;
    case 'rule': return <hr key={i} />;
  }
}

export function MarkdownView(props: MarkdownViewProps) {
  const blocks = parseMarkdown(props.source, { breaks: true });
  return (
    <div className={['markdown', props.className].filter(Boolean).join(' ')} data-testid={props['data-testid'] ?? 'markdown'}>
      {blocks.map((b, i) => block(b, i, props))}
    </div>
  );
}
