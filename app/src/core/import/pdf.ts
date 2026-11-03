import { canonicalize } from './text';
import { ImportError, WARNING, warning } from './types';

// PDF text layer → paragraphs. pdf.js is injected by the caller: the app passes the build that
// runs its worker from a bundled file, tests pass 'pdfjs-dist/legacy/build/pdf.mjs' (Node).
// A PDF has no paragraphs, only positioned runs of glyphs, so lines are rebuilt from the
// runs' positions (in content-stream order, which keeps columns apart), and paragraphs from
// vertical gaps, indents, short last lines and font-size changes. Words hyphenated across
// a line break are joined again.

/** The part of the pdfjs-dist module we use (structural, so either build fits). */
export interface PdfJsLike {
  getDocument(src: {
    data: Uint8Array;
    password?: string;
    verbosity?: number;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    stopAtErrors?: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): unknown }>;
    }>;
    destroy(): Promise<void>;
  };
}

export interface PdfText {
  text: string;
  pages: number;
  /** Offset in `text` where each page starts (a page without text: where the text before it ends). */
  pageStarts: number[];
  /** Pages (from 1) without any text: probably scanned images. */
  imagePages: number[];
  warnings: string[];
}

interface Run {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  eol: boolean;
}

interface Line {
  text: string;
  x: number;
  xEnd: number;
  y: number;
  size: number;
}

function toRun(item: unknown): Run | null {
  if (!item || typeof item !== 'object' || !('str' in item)) return null;
  const it = item as { str: unknown; transform?: unknown; width?: unknown; height?: unknown; hasEOL?: unknown };
  if (typeof it.str !== 'string') return null;
  const t = Array.isArray(it.transform) ? (it.transform as number[]) : [1, 0, 0, 1, 0, 0];
  const size = Math.hypot(t[2] ?? 0, t[3] ?? 0) || (typeof it.height === 'number' ? it.height : 0) || 10;
  return { str: it.str, x: t[4] ?? 0, y: t[5] ?? 0, w: typeof it.width === 'number' ? it.width : 0, size, eol: it.hasEOL === true };
}

/** Text runs → lines, in stream order. */
function buildLines(runs: Run[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let last: Run | null = null;
  const end = () => {
    if (cur && cur.text.trim()) lines.push({ ...cur, text: cur.text.replace(/\s+/g, ' ').trim() });
    cur = null;
  };
  for (const r of runs) {
    if (!r.str) {
      if (r.eol) end();
      continue;
    }
    // Fake bold: the same run drawn twice at almost the same place.
    if (last && last.str === r.str && Math.abs(last.x - r.x) < 1.5 && Math.abs(last.y - r.y) < 1.5) continue;
    last = r;
    const c = cur as Line | null;
    if (c) {
      const size = Math.max(c.size, r.size);
      const sameLine = Math.abs(r.y - c.y) <= size * 0.5 && r.x >= c.xEnd - size;
      if (!sameLine) end();
    }
    const now = cur as Line | null;
    if (!now) {
      cur = { text: r.str, x: r.x, xEnd: r.x + r.w, y: r.y, size: r.size };
    } else {
      const gap = r.x - now.xEnd;
      const needsSpace = gap > now.size * 0.15 && !/\s$/.test(now.text) && !/^\s/.test(r.str);
      now.text += (needsSpace ? ' ' : '') + r.str;
      now.xEnd = Math.max(now.xEnd, r.x + r.w);
      // Superscripts and subscripts do not move the baseline of the line.
      if (r.size >= now.size) now.y = r.y;
      now.size = Math.max(now.size, r.size);
    }
    if (r.eol) end();
  }
  end();
  return lines;
}

// Portuguese clitics written with a hyphen ("disse-lhe", "fala-se"): a line break at that
// hyphen must keep it.
const CLITIC = /^(?:me|te|se|lhe|lhes|nos|vos|o|a|os|as|lo|la|los|las|no|na|nas|mo|ma|to|ta|lho|lha|ei|ás|á|emos|eis|ão|ia|ias|íamos|íeis|iam)(?![\p{L}])/u;

function joinLines(prev: string, next: string): string {
  if (/\u{ad}$/u.test(prev)) return prev.slice(0, -1) + next;
  if (/\p{L}[-\u{2010}]$/u.test(prev) && /^\p{L}/u.test(next)) {
    // "aten-" + "ção": a word split by the line break. "disse-" + "lhe" or "Norte-" +
    // "Americano": a hyphenated word that happened to break at its hyphen.
    return /^\p{Ll}/u.test(next) && !CLITIC.test(next) ? prev.slice(0, -1) + next : prev + next;
  }
  return `${prev} ${next}`;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

const LIST_START = /^(?:[\u{2022}\u{25aa}\u{25cf}\u{25e6}\u{2013}\u{2014}\u{f0b7}-]\s|\(?\d{1,3}[.)]\s|\(?[a-z][.)]\s)/u;
const SENTENCE_END = /[.!?:;\u{2026}"\u{201d}\u{bb})\]]$/u;

/** Lines of one page → paragraphs. */
function buildParagraphs(lines: Line[]): string[] {
  if (!lines.length) return [];
  const gaps: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    const dy = lines[k - 1]!.y - lines[k]!.y;
    if (dy > 0 && dy < lines[k]!.size * 3) gaps.push(dy);
  }
  const bodySize = median(lines.map((l) => l.size));
  const lead = median(gaps) || bodySize * 1.2;
  // Margins per column: lines that start near each other share a right edge.
  const left = lines.reduce((m, l) => Math.min(m, l.x), Infinity);
  const rightOf = lines.map((l) => lines.reduce((m, o) => (Math.abs(o.x - l.x) < l.size * 3 ? Math.max(m, o.xEnd) : m), l.xEnd));

  const paras: string[] = [];
  let cur = lines[0]!.text;
  for (let k = 1; k < lines.length; k++) {
    const p = lines[k - 1]!;
    const l = lines[k]!;
    const dy = p.y - l.y;
    const size = Math.max(p.size, l.size);
    const breakHere =
      dy <= 0 || // went up: a new column or a box placed out of order
      dy > lead * 1.45 + 0.5 ||
      Math.abs(p.size - l.size) > Math.max(1, bodySize * 0.15) ||
      LIST_START.test(l.text) ||
      (SENTENCE_END.test(p.text) && p.xEnd < rightOf[k - 1]! - size * 3) || // a short last line
      (l.x > p.x + size * 0.9 && Math.abs(p.x - left) < size * 0.5 && SENTENCE_END.test(p.text)); // an indented first line
    if (breakHere) {
      paras.push(cur);
      cur = l.text;
    } else cur = joinLines(cur, l.text);
  }
  paras.push(cur);
  return paras;
}

function pdfError(e: unknown): ImportError {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  const code = e && typeof e === 'object' && 'code' in e ? (e as { code: unknown }).code : null;
  const message = e instanceof Error ? e.message : String(e);
  // pdf.js: PasswordResponses.NEED_PASSWORD = 1, INCORRECT_PASSWORD = 2.
  if (name === 'PasswordException') return new ImportError('ENCRYPTED_PDF', code === 2 ? 'incorrect-password' : 'password', message);
  return new ImportError('DAMAGED', 'pdf', message);
}

export interface PdfOptions {
  /** For a PDF that needs a password to open. */
  password?: string;
}

/** Extracts the text layer of a PDF. Throws ImportError ENCRYPTED_PDF or DAMAGED. */
export async function extractPdfText(bytes: Uint8Array, pdfjs: PdfJsLike, opts: PdfOptions = {}): Promise<PdfText> {
  // pdf.js takes ownership of the buffer (it may transfer it to its worker): give it a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...(opts.password !== undefined ? { password: opts.password } : {}),
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (e) {
      throw pdfError(e);
    }
    const pageTexts: string[] = [];
    const imagePages: number[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      let items: unknown[];
      try {
        const page = await doc.getPage(n);
        items = (await page.getTextContent()).items;
        page.cleanup();
      } catch (e) {
        throw pdfError(e);
      }
      const runs = items.map(toRun).filter((r): r is Run => r !== null);
      const paras = buildParagraphs(buildLines(runs))
        .map((p) => canonicalize(p).replace(/\u{ad}/gu, '').trim())
        .filter(Boolean);
      if (!paras.length) imagePages.push(n);
      pageTexts.push(paras.join('\n'));
    }
    // Pages are separated by a blank line; pages without text add nothing.
    const pageStarts: number[] = [];
    let text = '';
    for (const t of pageTexts) {
      if (t && text) text += '\n\n';
      pageStarts.push(text.length);
      text += t;
    }
    const warnings: string[] = [];
    if (doc.numPages > 0 && imagePages.length === doc.numPages) warnings.push(WARNING.pdfNoText);
    else if (imagePages.length) warnings.push(warning(WARNING.pdfImagePages, imagePages.join(',')));
    return { text, pages: doc.numPages, pageStarts, imagePages, warnings };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
