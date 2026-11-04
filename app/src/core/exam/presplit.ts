// The deterministic pre-split of an exam's text (critique G10, D14): groups (`GRUPO II`, `II.`), numbered questions
// (`3.`, `3)`, `Pergunta 3`), lettered items (`a)`), inline and line options (`(A) …`, `A) …`), points
// (`(3 valores)`, `2 points`, `1,5 puntos`), choose-N phrases ("Responda a duas das seguintes"), the rules, duration
// and extra points of the header and footer. The model's extraction is reconciled against these blocks, so a merged
// II.a–c (critique V6) is split again before the mandatory review.

export type BlockLevel = 'group' | 'number' | 'letter';
export interface Block {
  level: BlockLevel;
  label: string;                 // as printed: "II", "3", "a"
  number: string;                // composed label: "II", "II.a", "3", "2a"
  parent: string | null;         // composed label of the parent question, if any
  group: string | null;          // the group heading as printed ("GRUPO II"), if any
  text: string;                  // the question text without its label and points
  points: number | null;
  choose: number | null;         // "answer N of the following"
  options: Array<{ key: string; text: string }>;
  container: boolean;            // has child questions
  start: number; end: number;    // offsets of the block in the source text
}
export interface Presplit {
  header: string;                // the text before the first block
  title: string | null;          // the first non-empty header line
  blocks: Block[];
  rules: string[];
  durationMin: number | null;
  extraPoints: Array<{ label: string; points: number }>;
  unit: string | null;           // "valores" / "puntos" / "points", as printed
}

const ROMAN = /^(?:M{0,3})(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const GROUP_WORD = /^\s*(?:GRUPO|Grupo|GROUP|Group|PARTE|Parte|PART|Part|BLOQUE|Bloque|SECÇÃO|Secção|SECCIÓN|Sección|SECTION|Section)\s+([IVXLC]+|\d{1,2})\b[.:)]?\s*(.*)$/;
const GROUP_ROMAN = /^\s*([IVX]{1,5})\s*(?:[.)—–-]|\s{2,}|$)\s*(.*)$/;
const NUMBER = /^\s*(\d{1,2})\s*[.)](?:\s+(.*))?$/;
const NUMBER_WORD = /^\s*(?:Pergunta|Questão|Question|Pregunta|Cuestión)\s+(\d{1,2})\b[.:)]?\s*(.*)$/i;
const LETTER = /^\s*(?:\(([a-h])\)|([a-h])\))\s*(.*)$/;
const OPTION_LINE = /^\s*(?:\(([A-F])\)|([A-F])[).])\s+(.*)$/;
const OPTION_INLINE = /\(([A-F])\)\s*([^;()]+?)(?=\s*;|\s*\([A-F]\)|\s*\(\d|\s*$|\.\s*$)/g;
const UNIT = '(valor(?:es)?|val\\.|pontos?|points?|pts?\\.?|puntos?|marks?)';
const POINTS_PAREN = new RegExp(`\\((\\d+(?:[.,]\\d+)?)\\s*${UNIT}\\)`, 'i');
const POINTS_TAIL = new RegExp(`[—–-]\\s*(\\d+(?:[.,]\\d+)?)\\s*${UNIT}\\s*\\.?\\s*$`, 'i');
const NUM_WORDS: Record<string, number> = {
  um: 1, uma: 1, one: 1, uno: 1, un: 1, duas: 2, dois: 2, two: 2, dos: 2, três: 3, tres: 3, three: 3, quatro: 4, four: 4, cuatro: 4, cinco: 5, five: 5,
};
const CHOOSE = /\b(?:responda|responde|conteste|contesta|answer|escolha|escoja|elija|choose|resolva|resuelva)\s+(?:(?:a|à|apenas|only|solo|sólo|somente)\s+)?(\d|um|uma|duas|dois|três|tres|quatro|cinco|one|two|three|four|five|uno|una|dos|cuatro)\b(?:\s+(?:das|de|of|entre)\b)/i;
const RULE_HINT = /\b(permitid[ao]s?|proibid[ao]s?|consulta|não (?:é )?permitid|allowed|not allowed|permitted|prohibid[ao]|se permite|calculadora|calculator|legisla(?:ção|ción) (?:não )?anotada|sem consulta|without notes)\b/i;
const DURATION = /\b(?:Duração|Duration|Duración|Tempo|Time allowed)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(h(?:oras?|ours?)?|min(?:utos|utes)?)(?:\s*(?:e|and|y)?\s*(\d+)\s*min(?:utos|utes)?)?/i;
const EXTRA = /^\s*(.{3,80}?)\s*[:—–-]\s*(\d+(?:[.,]\d+)?)\s*(valor(?:es)?|pontos?|points?|puntos?)\s*\.?\s*$/i;
const EXTRA_HINT = /\b(pondera(?:ção|ción)|redação|redacção|redacción|apresentação|presentación|presentation|sistematiza|ortografia|writing|global)\b/i;

const toNum = (s: string) => Number(s.replace(',', '.'));

export function chooseOf(text: string): number | null {
  const m = CHOOSE.exec(text);
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  const n = /^\d$/.test(w) ? Number(w) : NUM_WORDS[w];
  return n && n > 0 ? n : null;
}

/** Points printed in the text, and the text without them. */
export function stripPoints(text: string): { text: string; points: number | null; unit: string | null } {
  let m = POINTS_PAREN.exec(text);
  if (m) return { text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').replace(/\s+([.:;,])/g, '$1').trim(), points: toNum(m[1]!), unit: m[2]!.toLowerCase() };
  m = POINTS_TAIL.exec(text);
  if (m) return { text: text.slice(0, m.index).trim(), points: toNum(m[1]!), unit: m[2]!.toLowerCase() };
  return { text: text.trim(), points: null, unit: null };
}

/** Inline options "(A) … ; (B) …" → options + the stem. */
export function inlineOptions(text: string): { stem: string; options: Array<{ key: string; text: string }> } {
  const first = /\(([A-F])\)\s*\S/.exec(text);
  if (!first || first[1] !== 'A') return { stem: text, options: [] };
  const opts: Array<{ key: string; text: string }> = [];
  for (const m of text.slice(first.index).matchAll(OPTION_INLINE)) opts.push({ key: m[1]!, text: m[2]!.trim().replace(/[.;]$/, '') });
  if (opts.length < 2) return { stem: text, options: [] };
  return { stem: text.slice(0, first.index).trim(), options: opts };
}

interface Raw { level: BlockLevel; label: string; groupLine: string | null; lines: string[]; start: number; end: number }

export function presplit(source: string): Presplit {
  const text = source.replace(/\r\n?/g, '\n');
  const lines: Array<{ s: string; at: number }> = [];
  let at = 0;
  for (const s of text.split('\n')) {
    lines.push({ s, at });
    at += s.length + 1;
  }
  const raws: Raw[] = [];
  let headerEnd = text.length;
  for (const { s, at: pos } of lines) {
    let m: RegExpExecArray | null;
    let level: BlockLevel | null = null;
    let label = '';
    let rest = '';
    let groupLine: string | null = null;
    if ((m = GROUP_WORD.exec(s))) {
      level = 'group';
      label = m[1]!;
      rest = m[2] ?? '';
      groupLine = s.trim().replace(/\s*\(.*$/, '').replace(/[.:]$/, '');
    } else if ((m = GROUP_ROMAN.exec(s)) && ROMAN.test(m[1]!) && !/^[IVX]\s*-\s*\w/.test(s.trim()) && (m[2] ?? '').length < 400) {
      level = 'group';
      label = m[1]!;
      rest = m[2] ?? '';
    } else if ((m = NUMBER_WORD.exec(s)) || (m = NUMBER.exec(s))) {
      level = 'number';
      label = m[1]!;
      rest = m[2] ?? '';
    } else if ((m = LETTER.exec(s))) {
      level = 'letter';
      label = (m[1] ?? m[2])!;
      rest = m[3] ?? '';
    }
    // A line "1. …" inside the header that is a rule or a date is not a question; a letter needs a parent.
    if (level === 'letter' && !raws.length) level = null;
    if (level) {
      if (!raws.length) headerEnd = pos;
      const prev = raws.at(-1);
      if (prev) prev.end = pos;
      raws.push({ level, label, groupLine, lines: rest ? [rest] : [], start: pos, end: text.length });
    } else if (raws.length) {
      raws.at(-1)!.lines.push(s);
    }
  }

  const header = text.slice(0, headerEnd).trim();
  const headerLines = header.split('\n').map((l) => l.trim()).filter(Boolean);
  const rules = headerLines.filter((l) => RULE_HINT.test(l) && !DURATION.test(l)).map((l) => l.replace(/\s+/g, ' '));
  const dm = DURATION.exec(header);
  let durationMin: number | null = null;
  if (dm) {
    const v = toNum(dm[1]!);
    durationMin = /^h/i.test(dm[2]!) ? Math.round(v * 60) + (dm[3] ? Number(dm[3]) : 0) : Math.round(v);
  }

  // Footer lines of the last block that are extra points ("Ponderação global …: 2 valores").
  const extraPoints: Array<{ label: string; points: number }> = [];
  const last = raws.at(-1);
  if (last) {
    for (let i = last.lines.length - 1; i >= 0; i--) {
      const l = last.lines[i]!.trim();
      if (!l) continue;
      const m = EXTRA.exec(l);
      if (m && EXTRA_HINT.test(m[1]!)) {
        extraPoints.unshift({ label: m[1]!.trim(), points: toNum(m[2]!) });
        last.lines.splice(i, 1);
        continue;
      }
      break;
    }
  }

  // Structure: which raw blocks are containers, and the composed labels.
  const blocks: Block[] = [];
  let unit: string | null = null;
  let groupLine: string | null = null;
  let groupBlock: Block | null = null;
  let numberParent: Block | null = null;
  const parentOf = new Map<Block, Block>();
  const groupHasNumbers = new Map<number, boolean>();
  raws.forEach((r, i) => {
    if (r.level !== 'group') return;
    let nums = false;
    for (let j = i + 1; j < raws.length && raws[j]!.level !== 'group'; j++) if (raws[j]!.level === 'number') nums = true;
    groupHasNumbers.set(i, nums);
  });

  raws.forEach((r, i) => {
    const body = r.lines.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    const sp = stripPoints(body.replace(/\n/g, ' '));
    unit ??= sp.unit;
    const opt = inlineOptions(sp.text);
    const lineOpts = r.lines.map((l) => OPTION_LINE.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ key: (m[1] ?? m[2])!, text: m[3]!.trim() }));
    let qtext = opt.stem;
    let options = opt.options;
    if (!options.length && lineOpts.length >= 2) {
      options = lineOpts;
      qtext = stripPoints(r.lines.filter((l) => !OPTION_LINE.test(l)).join(' ').replace(/\s+/g, ' ')).text;
    }
    const choose = chooseOf(qtext);
    if (r.level === 'group') {
      groupLine = r.groupLine ?? r.label;
      groupBlock = null;
      numberParent = null;
      // A group with numbered questions is a heading; it becomes a question only to carry a choose-N rule.
      if ((groupHasNumbers.get(i) ?? false) && choose === null) return;
      const b: Block = { level: 'group', label: r.label, number: r.label, parent: null, group: r.groupLine ?? null, text: qtext, points: sp.points, choose, options, container: false, start: r.start, end: r.end };
      blocks.push(b);
      groupBlock = b;
      numberParent = b;
      return;
    }
    if (r.level === 'number') {
      const b: Block = {
        level: 'number', label: r.label, number: r.label, parent: groupBlock?.number ?? null, group: groupLine,
        text: qtext, points: sp.points, choose, options, container: false, start: r.start, end: r.end,
      };
      blocks.push(b);
      if (groupBlock) {
        groupBlock.container = true;
        parentOf.set(b, groupBlock);
      }
      numberParent = b;
      return;
    }
    // A letter: child of the current numbered question, or of the group question.
    const parent: Block | null = numberParent;
    const number = parent ? (parent.level === 'number' ? `${parent.number}${r.label}` : `${parent.number}.${r.label}`) : r.label;
    blocks.push({ level: 'letter', label: r.label, number, parent: parent?.number ?? null, group: groupLine ?? parent?.group ?? null, text: qtext, points: sp.points, choose, options, container: false, start: r.start, end: r.end });
    if (parent) parent.container = true;
    if (parent) parentOf.set(blocks.at(-1)!, parent);
  });
  // Numbers that restart in each group ("Grupo I: 1, 2; Grupo II: 1, 2"): every grouped number gets the group prefix,
  // so labels stay unique; children follow their parent's new label.
  const nums = blocks.filter((b) => b.level === 'number').map((b) => b.number);
  if (new Set(nums).size < nums.length) {
    for (const b of blocks) {
      if (b.level !== 'number' || !b.group) continue;
      const g = /([IVXLC]+|\d+)\s*$/.exec(b.group)?.[1] ?? '';
      if (g) b.number = `${g}.${b.label}`;
    }
    for (const b of blocks) {
      const p = parentOf.get(b);
      if (!p) continue;
      b.parent = p.number;
      if (b.level === 'letter') b.number = p.level === 'number' && !p.number.includes('.') ? `${p.number}${b.label}` : `${p.number}.${b.label}`;
    }
  }
  return { header, title: headerLines[0] ?? null, blocks, rules, durationMin, extraPoints, unit };
}
