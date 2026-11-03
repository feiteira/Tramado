// A small Markdown reader for the manual shown in Help and for text written by The Human
// Loop's assistant: headings with <a id> anchors, paragraphs, lists, tables, images, quotes,
// code blocks, rules, and bold/italic/strikethrough/code/links.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'strike'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

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
}

// An underscore only opens emphasis at the start of a word (snake_case stays as it is).
const wordChar = /[\p{L}\d]/u;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
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
      out.push({ t: 'bold', c: [{ t: 'italic', c: parseInline(m[1]!) }] });
    } else if ((m = /^\*\*(?!\s)(.+?)\*\*/.exec(rest)) || (!afterWord && (m = /^__(?!\s)(.+?)__(?![\p{L}\d])/u.exec(rest)))) {
      flush();
      out.push({ t: 'bold', c: parseInline(m[1]!) });
    } else if ((m = /^\*(?![\s*])(.+?)\*/.exec(rest)) || (!afterWord && (m = /^_(?![\s_])(.+?)_(?![\p{L}\d])/u.exec(rest)))) {
      flush();
      out.push({ t: 'italic', c: parseInline(m[1]!) });
    } else if ((m = /^~~(?!\s)(.+?)~~/.exec(rest))) {
      flush();
      out.push({ t: 'strike', c: parseInline(m[1]!) });
    } else if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: 'code', v: m[1]! });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      out.push({ t: 'link', href: m[2]!, c: parseInline(m[1]!) });
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

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => parseInline(c.trim()));

export function parseMarkdown(src: string, options: MarkdownOptions = {}): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let anchor: string | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'para', c: parseInline(para.join(options.breaks ? '\n' : ' ')) });
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
      anchor = m[1]!;
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara();
      blocks.push({ t: 'heading', level: m[1]!.length, anchor, c: parseInline(m[2]!) });
      anchor = null;
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line))) {
      flushPara();
      blocks.push({ t: 'image', alt: m[1]!, src: m[2]! });
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      flushPara();
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      i--;
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flushPara();
      const ordered = /\d/.test(m[2]!);
      const items: { depth: number; c: Inline[] }[] = [];
      while (i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!))) {
        items.push({ depth: Math.floor(m[1]!.length / 2), c: parseInline(m[3]!) });
        i++;
      }
      i--;
      blocks.push({ t: 'list', ordered, items });
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      blocks.push({ t: 'quote', c: parseInline(m[1]!) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

export function inlineText(c: Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('');
}
