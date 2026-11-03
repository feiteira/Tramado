import { canonicalize, tidy } from './text';

// Markdown → plain text, lightly: the reader should see the words, not the markup. Headings
// lose their #, emphasis markers and link targets go, list items stay one per paragraph
// (bullets become "•", numbers stay), table rows become tab-separated cells, and soft-wrapped
// lines of a paragraph are joined as Markdown means them. Everything is line by line and
// regex-linear, so a book-length file is quick.

// Backslash escapes are swapped for private-use stand-ins while markup is stripped, so that
// "\*" never reads as emphasis, then restored.
const ESCAPABLE = '\\`*_{}[]()#+-.!|>~<';
const STAND_IN = 0xf8e0;
const hideEscapes = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, (_, c: string) => String.fromCharCode(STAND_IN + ESCAPABLE.indexOf(c)));
const showEscapes = (s: string) => s.replace(/[\u{f8e0}-\u{f8f2}]/gu, (c) => ESCAPABLE[c.charCodeAt(0) - STAND_IN]!);

function stripEmphasis(s: string): string {
  let t = s;
  // Repeat for nesting (***both***, **bold *and italic***).
  for (let k = 0; k < 3; k++) {
    const before = t;
    t = t
      .replace(/(\*\*\*|\*\*|\*)(?=\S)([^*]*?\S)\1/g, '$2')
      .replace(/(?<![\p{L}\p{N}_])(___|__|_)(?=\S)(.*?\S)\1(?![\p{L}\p{N}_])/gu, '$2')
      .replace(/~~(?=\S)(.*?\S)~~/g, '$1');
    if (t === before) break;
  }
  return t;
}

/** Inline Markdown → text. Code spans are kept literally. */
export function markdownInline(line: string): string {
  const s = hideEscapes(line);
  const parts = s.split(/(`+)([\s\S]*?[^`])\1(?!`)/);
  let out = '';
  // split with two groups yields [text, ticks, code, text, ticks, code, ...]
  for (let i = 0; i < parts.length; i += 3) {
    let t = parts[i] ?? '';
    t = t
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))*(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/<((?:https?|mailto|ftp):[^>\s]+)>/gi, '$1')
      .replace(/<([^>\s@]+@[^>\s@]+\.[^>\s]+)>/g, '$1');
    out += stripEmphasis(t);
    const code = parts[i + 2];
    if (code !== undefined) out += code.replace(/^ (.*) $/s, '$1');
  }
  return showEscapes(out);
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// Only the opening sequence: the closing one is taken off in atxHeading(), since a regex for it
// backtracks quadratically over a long run of spaces inside the heading.
const ATX = /^\s{0,3}(#{1,6})(?:\s+(.*))?$/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const QUOTE = /^\s{0,3}>\s?/;
const REF_DEF = /^\s{0,3}\[[^\]]+\]:\s*\S+/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** The text of an ATX heading ("## Title ##" → "Title"), or null when the line is not one. */
function atxHeading(line: string): string | null {
  const m = ATX.exec(line);
  if (!m) return null;
  const text = (m[2] ?? '').trimEnd();
  const open = text.replace(/(?<!#)#+$/, '');
  // A closing run of # counts only after a space (or alone); "C#" keeps its #.
  return open === '' || /\s$/.test(open) ? open.trimEnd() : text;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => markdownInline(c.trim()))
    .join('\t');

/** Markdown → canonical text: one paragraph per line. */
export function markdownToText(src: string): string {
  const lines = canonicalize(src).split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let inTable = false;
  const flush = () => {
    if (para.length) out.push(markdownInline(para.join(' ')));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(marker); i++) out.push(lines[i]!);
      continue;
    }
    // Block quotes: the text without its markers (nested quotes too).
    while (QUOTE.test(line)) line = line.replace(QUOTE, '');
    if (!line.trim()) {
      flush();
      inTable = false;
      continue;
    }
    if (inTable && line.includes('|')) {
      out.push(cells(line));
      continue;
    }
    inTable = false;
    if (line.includes('|') && TABLE_SEP.test((lines[i + 1] ?? '').trim()) && (lines[i + 1] ?? '').includes('-')) {
      flush();
      out.push(cells(line));
      i++;
      inTable = true;
      continue;
    }
    const atx = atxHeading(line);
    if (atx !== null) {
      flush();
      if (atx) out.push(markdownInline(atx));
      continue;
    }
    // "Title\n=====": the underline turns the paragraph above into a heading.
    if (para.length && SETEXT.test(line)) {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      continue;
    }
    if (REF_DEF.test(line) && !para.length) continue;
    const item = LIST.exec(line);
    if (item && (item[3] ?? '').trim()) {
      flush();
      const marker = /\d/.test(item[2]!) ? `${item[2]!.replace(')', '.')} ` : '\u{2022} ';
      para.push(marker + item[3]!.trim());
      continue;
    }
    const hardBreak = line.endsWith('  ') || line.endsWith('\\');
    para.push(line.trim().replace(/\\$/, ''));
    if (hardBreak) flush();
  }
  flush();
  // List markers were added before inline parsing; "• " survives it, numbers too.
  return tidy(out.join('\n'));
}
