// A small Markdown reader for the manual shown in Help and for text written by The Human
// Loop's assistant: headings with <a id> anchors, paragraphs, lists, tables, images, quotes,
// code blocks, rules, and bold/italic/strikethrough/code/links.
//
// Tramado hardening (architecture §11.1, §16, critique G27): everything rendered from it is
// untrusted classmate or model text (chat, class notes, transcripts, AI answers), so the AST is
// safe by construction — there is no raw-HTML node at all (markup stays text and is escaped by the
// renderer), a link node exists only for `https:`, `mailto:` and `tramado:` targets (anything else,
// `javascript:`, `data:`, `vbscript:`, relative paths, encoded or spaced variants, is plain text),
// an image node only for the media scheme (`tramado-media:`, `http://tramado-media.localhost`,
// `blob:`; anything else becomes its alt text), and anchors are reduced to [A-Za-z0-9_-]. With
// `citations` the `[S#]` markers of folder spec §8.15 become `cite` nodes; with `mentions` the chat
// tokens `<@memberId>`, `<@everyone>`, `<@ai>` (§8.16) become `mention` nodes.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'strike'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'cite'; refs: string[]; pin: string | null; raw: string }
  | { t: 'mention'; target: string; raw: string };

export type Block =
  | { t: 'heading'; level: number; anchor: string | null; c: Inline[] }
  | { t: 'para'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: { depth: number; c: Inline[] }[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'image'; alt: string; src: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'rule' };

export interface MarkdownOptions {
  /** Keep single line breaks inside a paragraph (as chat messages mean them), instead of joining the lines. */
  breaks?: boolean;
  /** Read `[S1]`, `[S1, S4]`, `[S4, n.º 3]` as citation nodes (AI answers, folder spec §8.15). */
  citations?: boolean;
  /** Read `<@memberId>`, `<@everyone>`, `<@ai>` as mention nodes (chat, folder spec §8.16). */
  mentions?: boolean;
  /**
   * A trusted, bundled document (the manual): also keep relative links between its pages
   * (`02-classes.md#first-run`, `#anchor`) and relative images (`../img/en/today.png`). Never for
   * classmate or model text.
   */
  relative?: boolean;
}

// ── Safe targets ───────────────────────────────────────────────────────────────────────────────

/** Characters that never appear in a target we accept: controls, spaces, quotes, angle brackets, backslash, backtick. */
const UNSAFE_CHARS = /[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff"'<>\\`]/u;

/**
 * A link target Tramado may act on, or null: `https://<host>…`, `mailto:<address>`, or an in-app
 * `tramado:<kind>/…` link. Nothing is decoded first: a target that only becomes safe or unsafe after
 * entity or percent decoding is refused as written.
 */
export function safeHref(href: string): string | null {
  if (!href || href.length > 2048 || UNSAFE_CHARS.test(href)) return null;
  if (/^https:\/\/[^/?#@:]+(?::\d{1,5})?(?:[/?#]|$)/i.test(href)) return href;
  if (/^mailto:[^/?#:]+@[^/?#:]+/i.test(href)) return href;
  if (/^tramado:[a-z]+(?:[/?#]|$)/i.test(href)) return href;
  return null;
}

/** An image source the app may load: the media scheme only (architecture §8, §16), or null. */
export function safeImageSrc(src: string): string | null {
  if (!src || src.length > 4096 || UNSAFE_CHARS.test(src)) return null;
  if (/^tramado-media:\/\/localhost\//i.test(src) || /^http:\/\/tramado-media\.localhost\//i.test(src)) return src;
  if (/^blob:(?:https?:\/\/[^/\s]+|tauri:\/\/localhost|null)\/[0-9a-f-]{8,}$/i.test(src)) return src;
  return null;
}

/** A relative link inside a trusted document: path segments of [A-Za-z0-9._-] and an optional #anchor. */
export function safeRelativeHref(href: string): string | null {
  return /^(?:(?:\.\.?\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)?(?:#[A-Za-z0-9_-]+)?$/.test(href) && href !== '' ? href : null;
}

const safeAnchor = (a: string) => a.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || null;

const CITE = /^\[(S\d{1,3}(?:\s*,\s*S\d{1,3})*)(?:\s*,\s*([^\]\[]{1,40}))?\]/;
const MENTION = /^<@([a-z2-7]{26}|everyone|ai)>/;

// An underscore only opens emphasis at the start of a word (snake_case stays as it is).
const wordChar = /[\p{L}\d]/u;

export function parseInline(s: string, options: MarkdownOptions = {}): Inline[] {
  const out: Inline[] = [];
  const inner = (x: string) => parseInline(x, options);
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  for (let i = 0; i < s.length; ) {
    const rest = s.slice(i);
    const afterWord = i > 0 && wordChar.test(s[i - 1]!);
    let m: RegExpExecArray | null;
    if ((m = /^\*\*\*(?!\s)(.+?)\*\*\*/.exec(rest)) || (!afterWord && (m = /^___(?!\s)(.+?)___(?![\p{L}\d])/u.exec(rest)))) {
      flush();
      out.push({ t: 'bold', c: [{ t: 'italic', c: inner(m[1]!) }] });
    } else if ((m = /^\*\*(?!\s)(.+?)\*\*/.exec(rest)) || (!afterWord && (m = /^__(?!\s)(.+?)__(?![\p{L}\d])/u.exec(rest)))) {
      flush();
      out.push({ t: 'bold', c: inner(m[1]!) });
    } else if ((m = /^\*(?![\s*])(.+?)\*/.exec(rest)) || (!afterWord && (m = /^_(?![\s_])(.+?)_(?![\p{L}\d])/u.exec(rest)))) {
      flush();
      out.push({ t: 'italic', c: inner(m[1]!) });
    } else if ((m = /^~~(?!\s)(.+?)~~/.exec(rest))) {
      flush();
      out.push({ t: 'strike', c: inner(m[1]!) });
    } else if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: 'code', v: m[1]! });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      const href = safeHref(m[2]!) ?? (options.relative ? safeRelativeHref(m[2]!) : null);
      // An unsafe target keeps only its label, as text: there is nothing to click.
      if (href) out.push({ t: 'link', href, c: inner(m[1]!) });
      else out.push(...inner(m[1]!));
    } else if (options.citations && (m = CITE.exec(rest))) {
      flush();
      out.push({ t: 'cite', refs: m[1]!.split(/\s*,\s*/), pin: m[2]?.trim() || null, raw: m[0] });
    } else if (options.mentions && (m = MENTION.exec(rest))) {
      flush();
      out.push({ t: 'mention', target: m[1]!, raw: m[0] });
    } else {
      text += s[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

const cells = (line: string, o: MarkdownOptions) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => parseInline(c.trim(), o));

export function parseMarkdown(src: string, options: MarkdownOptions = {}): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let anchor: string | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'para', c: parseInline(para.join(options.breaks ? '\n' : ' '), options) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if ((m = /^\s*(```|~~~)/.exec(line))) {
      flushPara();
      const fence = m[1]!;
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence); i++) code.push(lines[i]!);
      blocks.push({ t: 'code', v: code.join('\n') });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      blocks.push({ t: 'rule' });
      continue;
    }
    if ((m = /^<a id="([^"]+)"><\/a>\s*$/.exec(line))) {
      flushPara();
      anchor = safeAnchor(m[1]!);
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara();
      blocks.push({ t: 'heading', level: m[1]!.length, anchor, c: parseInline(m[2]!, options) });
      anchor = null;
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line))) {
      flushPara();
      const src = safeImageSrc(m[2]!) ?? (options.relative ? safeRelativeHref(m[2]!) : null);
      blocks.push(src ? { t: 'image', alt: m[1]!, src } : { t: 'para', c: m[1] ? [{ t: 'text', v: m[1] }] : [] });
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      flushPara();
      const head = cells(line, options);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!, options));
      i--;
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flushPara();
      const ordered = /\d/.test(m[2]!);
      const items: { depth: number; c: Inline[] }[] = [];
      while (i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!))) {
        items.push({ depth: Math.min(8, Math.floor(m[1]!.length / 2)), c: parseInline(m[3]!, options) });
        i++;
      }
      i--;
      blocks.push({ t: 'list', ordered, items });
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      blocks.push({ t: 'quote', c: parseInline(m[1]!, options) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

export function inlineText(c: Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'cite' || n.t === 'mention' ? n.raw : inlineText(n.c))).join('');
}

// ── A string renderer with the same rules (clipboard HTML, tests) ──────────────────────────────

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** HTML for an AST, every text escaped, links and images only from the safe targets above. */
export function renderHtml(blocks: readonly Block[]): string {
  const inl = (c: readonly Inline[]): string => c.map((n) => {
    switch (n.t) {
      case 'text': return escapeHtml(n.v).replace(/\n/g, '<br>');
      case 'bold': return `<strong>${inl(n.c)}</strong>`;
      case 'italic': return `<em>${inl(n.c)}</em>`;
      case 'strike': return `<s>${inl(n.c)}</s>`;
      case 'code': return `<code>${escapeHtml(n.v)}</code>`;
      case 'link': {
        const href = safeHref(n.href) ?? safeRelativeHref(n.href);
        return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${inl(n.c)}</a>` : inl(n.c);
      }
      case 'cite': return `<sup>${escapeHtml(n.raw)}</sup>`;
      case 'mention': return `<span>${escapeHtml(n.raw)}</span>`;
    }
  }).join('');
  return blocks.map((b) => {
    switch (b.t) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, b.level));
        return `<h${level}${b.anchor ? ` id="${escapeHtml(b.anchor)}"` : ''}>${inl(b.c)}</h${level}>`;
      }
      case 'para': return `<p>${inl(b.c)}</p>`;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        return `<${tag}>${b.items.map((i) => `<li>${inl(i.c)}</li>`).join('')}</${tag}>`;
      }
      case 'table':
        return `<table><thead><tr>${b.head.map((h) => `<th>${inl(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      case 'image': {
        const src = safeImageSrc(b.src) ?? safeRelativeHref(b.src);
        return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(b.alt)}">` : `<p>${escapeHtml(b.alt)}</p>`;
      }
      case 'quote': return `<blockquote>${inl(b.c)}</blockquote>`;
      case 'code': return `<pre><code>${escapeHtml(b.v)}</code></pre>`;
      case 'rule': return '<hr>';
    }
  }).join('\n');
}
