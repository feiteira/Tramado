// Exam question extraction (openrouter-lab §5 and §11.9, critique G10/R14): the schema goes in the prompt (and in
// `response_format` only for models that list `structured_outputs`), the output is parsed tolerantly, validated,
// normalised deterministically and reconciled with the pre-split blocks, then shown on the mandatory review screen.
import type { Question } from '../model/files';
import type { QuestionId } from '../model/ids';
import { newQuestionId } from '../ids';
import { PACKS, type PromptLang } from '../ai/prompts';
import type { Msg, ResponseFormat } from '../ai/types';
import { chooseOf, inlineOptions, presplit, stripPoints, type Block, type Presplit } from './presplit';

/** The flat schema of openrouter-lab §5 (recursive schemas are poorly supported). */
export const EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'questions'],
  properties: {
    title: { type: ['string', 'null'], description: 'Exam title/course, if stated' },
    questions: {
      type: 'array', description: 'Every question AND sub-question, flattened, in document order',
      items: {
        type: 'object', additionalProperties: false, required: ['number', 'parent', 'group', 'text', 'points', 'kind', 'options'],
        properties: {
          number: { type: 'string', description: "Label as printed: '1', '2', '2a', '2b', 'II', 'II.a'" },
          parent: { type: ['string', 'null'], description: 'number of the parent question for sub-questions, else null' },
          group: { type: ['string', 'null'], description: "Section/group heading, e.g. 'GRUPO I'" },
          text: { type: 'string', description: 'Question text verbatim, without the number and the points' },
          points: { type: ['number', 'null'], description: 'Points for this item, null if not stated' },
          kind: { type: 'string', enum: ['open', 'multiple_choice', 'true_false', 'short', 'container'] },
          options: { type: 'array', items: { type: 'string' }, description: 'Choices for multiple_choice, else []' },
        },
      },
    },
  },
} as const;

export const EXTRACTION_FORMAT: ResponseFormat = { type: 'json_schema', json_schema: { name: 'exam_questions', strict: true, schema: EXTRACTION_SCHEMA } };

const EXAMPLE = '{"title": "Exam", "questions": [{"number": "1", "parent": null, "group": "GRUPO I", "text": "Defina negócio jurídico.", "points": 2, "kind": "short", "options": []}]}';

/** System + user messages of the extraction request: schema and a tiny example in the prompt, the pre-split as hints. */
export function extractionPrompt(lang: PromptLang, text: string, blocks: readonly Block[]): Msg[] {
  const p = PACKS[lang];
  const hints = blocks.length
    ? `\n\nA deterministic splitter found these labels; keep each as a separate question: ${blocks.map((b) => b.number).join(', ')}.`
    : '';
  return [
    { role: 'system', content: `${p.extractRole}\n${JSON.stringify(EXTRACTION_SCHEMA)}\nExample: ${EXAMPLE}\nCopy the text verbatim. Do not answer the questions.` },
    { role: 'user', content: `Exam:\n${text.trim()}${hints}` },
  ];
}

/** The repair request (one at most): the output and what was wrong with it. */
export function repairPrompt(lang: PromptLang, output: string, errors: string[]): Msg[] {
  return [
    { role: 'system', content: `${PACKS[lang].repairPrompt(errors.join('; '))}\n${JSON.stringify(EXTRACTION_SCHEMA)}` },
    { role: 'user', content: output.slice(0, 20_000) },
  ];
}

export interface RawQuestion { number: string; parent: string | null; group: string | null; text: string; points: number | null; kind: string; options: string[] }
export interface RawExtraction { title: string | null; questions: RawQuestion[]; errors: string[] }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /(\d+(?:[.,]\d+)?)/.exec(v);
    if (m) return Number(m[1]!.replace(',', '.'));
  }
  return null;
};

/** Reads the model's JSON in the schema shape, or the shapes free models invent (groups → questions → sub_questions). */
export function readExtraction(raw: unknown): RawExtraction {
  const errors: string[] = [];
  const out: RawQuestion[] = [];
  if (!raw || typeof raw !== 'object') return { title: null, questions: [], errors: ['not a JSON object'] };
  const o = raw as Record<string, unknown>;
  const title = str(o.title) ?? str((o.exam_metadata as Record<string, unknown> | undefined)?.title) ?? null;
  const visit = (q: unknown, parent: string | null, group: string | null) => {
    if (!q || typeof q !== 'object') return;
    const r = q as Record<string, unknown>;
    const number = str(r.number) ?? str(r.label) ?? str(r.id) ?? '';
    const text = str(r.text) ?? str(r.question) ?? str(r.statement) ?? '';
    const options = Array.isArray(r.options) ? r.options.map((x) => (typeof x === 'string' ? x : str((x as Record<string, unknown>)?.text) ?? '')).filter(Boolean) : [];
    const kind = str(r.kind) ?? str(r.type) ?? 'open';
    out.push({ number: number.trim(), parent: str(r.parent) ?? parent, group: str(r.group) ?? group, text, points: num(r.points ?? r.value ?? r.valores), kind, options });
    const subs = r.sub_questions ?? r.subquestions ?? r.children ?? r.items;
    if (Array.isArray(subs)) subs.forEach((s) => visit(s, number.trim() || parent, str(r.group) ?? group));
  };
  if (Array.isArray(o.questions)) o.questions.forEach((q) => visit(q, null, null));
  else if (Array.isArray(o.groups)) {
    for (const g of o.groups) {
      const gr = (g ?? {}) as Record<string, unknown>;
      const gname = str(gr.title) ?? str(gr.name) ?? str(gr.group) ?? (str(gr.number) ? `Grupo ${str(gr.number)}` : null);
      if (Array.isArray(gr.questions)) gr.questions.forEach((q) => visit(q, null, gname));
    }
  } else errors.push('no "questions" array');
  if (!out.length && !errors.length) errors.push('no questions');
  out.forEach((q, i) => {
    if (!q.text.trim()) errors.push(`question ${i + 1} has no text`);
  });
  return { title, questions: out, errors };
}

const LABEL_OK = /^(?:[IVXLC]+(?:\.[a-z0-9]+)?|\d{1,2}[a-z]?|\d{1,2}\.\d{1,2}|[a-z])$/;

/** openrouter-lab §5 rule 4: a label from the text when the model's label is junk (", "), the text without it. */
export function cleanLabel(number: string, text: string): { number: string; text: string } {
  let n = number.trim().replace(/[).:]+$/, '').replace(/^\(/, '');
  let t = text.trim();
  const lead = /^\s*(?:(\d{1,2})[.)]|\(?([a-z])\))\s+/.exec(t);
  if (lead) {
    if (!LABEL_OK.test(n)) n = lead[1] ?? lead[2]!;
    t = t.slice(lead[0].length);
  }
  return { number: n, text: t };
}

const KIND_FROM_MODEL: Record<string, Question['kind'] | null> = {
  open: null, short: 'short', multiple_choice: 'multiple_choice', true_false: 'true_false', container: 'container',
  case: 'case', essay: 'essay', comment: 'comment', calculation: 'calculation', other: 'other',
};

/** Kind heuristics (openrouter-lab §5 rule 4, product-ux §8.4); "other" means "check the type" on the review screen. */
export function kindOf(text: string, options: readonly unknown[], hasChildren: boolean): Question['kind'] {
  if (hasChildren) return 'container';
  if (options.length >= 2) return 'multiple_choice';
  const t = text.trim();
  const has = (words: string) => new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, 'iu').test(t);
  if (has('verdadeiro ou falso|true or false|verdadero o falso|V\\s*/\\s*F')) return 'true_false';
  if (/^(?:comente|comment|comenta|analise criticamente|analyse critically)(?![\p{L}])/iu.test(t)) return 'comment';
  if (has('quid (?:iuris|juris)|resolva (?:o caso|a hipótese)|hipótese prática|caso práctico|resuelva el caso|solve the case|analise a (?:constitucionalidade|validade|legalidade|situação)|aprecie a (?:situação|validade)|analice (?:la|el) (?:caso|validez)') || t.length > 320) return 'case';
  if (has('calcule|calcula|calculate|compute|determine o valor')) return 'calculation';
  if (has('desenvolva|disserte|discuta|discuss|desarrolle|elabore|evaluate')) return 'essay';
  if (has('distinga|explique|defina|indique|enumere|identifique|o que (?:é|se entende)|em que (?:condições|casos|termos)|distinguish|explain|define|what is|state|name|in which cases|under what conditions|qué es|en qué (?:casos|condiciones)|explica|enumera|indica')) return 'short';
  return 'other';
}

const keyOf = (s: string) => s.toLowerCase().replace(/[\s.()]/g, '');

export interface NormalizeOptions {
  rand: () => number;
  /** Where a block is printed (file and physical page), from the text offset. */
  sourceOf?: (offset: number) => Question['source'];
  /** The ids already used (on re-extraction). */
  used?: ReadonlySet<QuestionId>;
}

function uniqueId(rand: () => number, used: Set<string>): QuestionId {
  for (;;) {
    const id = newQuestionId(rand);
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

/** Questions from the pre-split alone (typed questions, or a model that failed). */
export function questionsFromBlocks(pre: Presplit, opts: NormalizeOptions, model: RawExtraction | null = null): Question[] {
  const used = new Set<string>(opts.used ?? []);
  const ids = new Map<string, QuestionId>();
  const byKey = new Map<string, RawQuestion>();
  for (const q of model?.questions ?? []) {
    const c = cleanLabel(q.number, q.text);
    const parentKey = q.parent ? keyOf(q.parent) : '';
    byKey.set(keyOf(c.number), q);
    if (/^[a-z]$/.test(c.number) && parentKey) byKey.set(parentKey + keyOf(c.number), q);
  }
  return pre.blocks.map((b) => {
    const id = uniqueId(opts.rand, used);
    ids.set(b.number, id);
    const m = byKey.get(keyOf(b.number));
    const modelKind = m ? KIND_FROM_MODEL[m.kind] ?? null : null;
    const options = b.options.length ? b.options : (m?.options ?? []).map((x, i) => optionOf(x, i));
    const kind: Question['kind'] = b.container ? 'container' : modelKind && modelKind !== 'container' && modelKind !== 'short' ? modelKind : kindOf(b.text, options, false) === 'other' && modelKind ? modelKind : kindOf(b.text, options, false);
    return {
      id, number: b.number, parent: b.parent ? ids.get(b.parent) ?? null : null, group: b.group,
      kind, text: b.text, points: b.points ?? m?.points ?? null,
      options: kind === 'multiple_choice' ? options : [],
      choose: b.container ? b.choose ?? chooseOf(b.text) : null,
      source: opts.sourceOf?.(b.start) ?? null, answerKey: null,
    };
  });
}

function optionOf(x: string, i: number): { key: string; text: string } {
  const m = /^\s*\(?([A-Fa-f])[).]\s*(.*)$/.exec(x);
  return m ? { key: m[1]!.toUpperCase(), text: m[2]!.trim() } : { key: String.fromCharCode(65 + i), text: x.trim() };
}

/** Questions from the model's extraction alone, normalised (labels, points, options, kinds, parents, choose-N). */
export function questionsFromModel(model: RawExtraction, opts: NormalizeOptions): Question[] {
  const used = new Set<string>(opts.used ?? []);
  const rows = model.questions.map((q) => {
    const c = cleanLabel(q.number, q.text);
    const sp = stripPoints(c.text);
    const inl = q.options.length ? { stem: sp.text, options: q.options.map(optionOf) } : (() => {
      const r = inlineOptions(sp.text);
      return { stem: r.stem, options: r.options };
    })();
    return { raw: q, number: c.number, text: inl.stem, points: q.points ?? sp.points, options: inl.options };
  });
  // Sub-labels "a" under a parent become "<parent>a" / "<parent>.a" as in the pre-split.
  for (const r of rows) {
    if (/^[a-z]$/.test(r.number) && r.raw.parent) {
      const p = r.raw.parent.trim();
      r.number = /^[IVXLC]+$/.test(p) ? `${p}.${r.number}` : `${p}${r.number}`;
    }
  }
  const idOf = new Map<string, QuestionId>();
  for (const r of rows) idOf.set(keyOf(r.number), uniqueId(opts.rand, used));
  const parents = new Set(rows.filter((r) => r.raw.parent).map((r) => keyOf(r.raw.parent!)));
  return rows.map((r) => {
    const hasChildren = parents.has(keyOf(r.number)) || r.raw.kind === 'container';
    const mk = KIND_FROM_MODEL[r.raw.kind] ?? null;
    const heur = kindOf(r.text, r.options, hasChildren);
    const kind: Question['kind'] = hasChildren ? 'container' : mk && mk !== 'short' && mk !== 'container' ? mk : heur === 'other' && mk && mk !== 'container' ? mk : heur;
    return {
      id: idOf.get(keyOf(r.number))!, number: r.number, parent: r.raw.parent ? idOf.get(keyOf(r.raw.parent)) ?? null : null,
      group: r.raw.group, kind, text: r.text, points: r.points, options: kind === 'multiple_choice' ? r.options : [],
      choose: kind === 'container' ? chooseOf(r.text) : null, source: null, answerKey: null,
    };
  });
}

/**
 * Reconciles the model's extraction with the pre-split (critique G10): when the pre-split found a structure (≥ 2
 * blocks) it is the skeleton (verbatim text, labels, points, choose-N) and the model contributes kinds and options;
 * otherwise the model's questions are normalised; when both are empty the whole text is one question ("other").
 */
export function normalizeExtraction(model: RawExtraction | null, pre: Presplit, text: string, opts: NormalizeOptions): Question[] {
  if (pre.blocks.length >= 2) return questionsFromBlocks(pre, opts, model);
  if (model && model.questions.length) return questionsFromModel(model, opts);
  if (pre.blocks.length === 1) return questionsFromBlocks(pre, opts, model);
  const t = text.trim();
  if (!t) return [];
  const used = new Set<string>(opts.used ?? []);
  return [{ id: uniqueId(opts.rand, used), number: '1', parent: null, group: null, kind: kindOf(t, [], false), text: t, points: null, options: [], choose: null, source: opts.sourceOf?.(0) ?? null, answerKey: null }];
}

/** "Type or paste the questions" (UX §3.9.4): the pre-split applied to the pasted text, no AI. */
export function typedQuestions(text: string, rand: () => number): { questions: Question[]; pre: Presplit } {
  const pre = presplit(text);
  return { questions: normalizeExtraction(null, pre, text, { rand }), pre };
}

export interface PointsCheck { ok: boolean; total: number; mismatches: QuestionId[] }

/** Σ children = parent (a sanity badge on the review screen, not a blocker; openrouter-lab §5 rule 6). */
export function checkPoints(questions: readonly Question[]): PointsCheck {
  const mismatches: QuestionId[] = [];
  for (const q of questions) {
    if (q.kind !== 'container' || q.points === null) continue;
    const kids = questions.filter((c) => c.parent === q.id && c.points !== null);
    if (!kids.length) continue;
    const per = kids.map((c) => c.points!);
    const sum = q.choose ? [...per].sort((a, b) => b - a).slice(0, q.choose).reduce((a, b) => a + b, 0) : per.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - q.points) > 1e-6) mismatches.push(q.id);
  }
  const total = questions.filter((q) => q.parent === null).reduce((a, q) => a + (q.points ?? 0), 0);
  return { ok: mismatches.length === 0, total, mismatches };
}
