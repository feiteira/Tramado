// The demo fixtures (UX §7): people and device IDs, transcripts (segment ids, key segments, filler, exam radar),
// markers, every citation quote (resolveQuote on its page, slide or segment, and unique in the whole source), the
// committed assets (text layers, pages, slides), the seed's files (signatures, derived IDs, hashes, chat months,
// private data, demo flags) and every UX §7.2 key and §7.4 route.
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { toHex } from '../../core/bytes';
import { extractPdfText, type PdfJsLike } from '../../core/import/pdf';
import { docxToText } from '../../core/import/docx';
import { itemIdMatches, memberIdOf } from '../../core/model/derive';
import type { AnswersFile, ChatLine, ClaimFile, ConsentLine, ExamFile, LectureFile, MemberFile, MetaFile, ModLine, PresenceFile, TranscriptEditLine, TranscriptFile } from '../../core/model/files';
import { isHlc, isQuestionId, isUlid, RE_SEGMENT_ID } from '../../core/model/ids';
import { parseConflictName } from '../../core/model/paths';
import { deviceIdChecks, verifyPersonProof, verifySig } from '../../core/model/sig';
import { sha256Hex } from '../../core/util/sha256';
import { resolveQuote } from '../../core/search/resolve';
import { renderMarkdown, renderVtt, utcOffsetMinAt } from '../../core/transcript/render';
import { createMemoryPlatform, type MemoryPlatform } from '../../platform/memory';
import { deviceIdentity, poolKey } from '../../platform/memory/signer';
import { demoRoute, parseDemoFlags } from '../boot';
import { createFakeMedia, tickFakeMedia } from '../fakeMedia';
import { MISSING_ID, type DemoKeys } from '../keys';
import { DEMO_ASSETS, fakeAudio, seedDemo, type SeedOptions } from '../seed';
import { CLASSES, demoTranscript, findDoc, findLecture } from './index';
import { FIRST_FREE_POOL_SLOT, MEMBER_KEYS, PEOPLE, UNVERIFIED_DEVICE } from './people';
import { FILLER, L6_E00_WHISPER } from './content/transcripts';
import { LF_PAGES, lfArticlePage } from './content/lf';
import { buildTranscript, demoPeaks, fillTranscript, fillerId } from './fill';
import { docSourceText, docUnits, docWholeText } from './sources';
import { clockMs, lisbon, lisbonDateTime } from './time';
import type { DemoAiAnswer, DemoCitation, DemoLecture, DemoSegment } from './types';

const NOW = Date.UTC(2026, 10, 3, 15, 30);
const dec = new TextDecoder();
const assetBytes = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));
const sha1 = async (s: string) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))));
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Exam radar of research/product-ux.md §9.3 (T-LECTURES' core/transcript/radar.ts implements it; copied to pin the fixtures). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const RADAR: Record<string, RegExp> = {
  pt: /\b(?:isto|isso|esta materia|este tema|esta parte|esta pergunta)\s+(?:\S+\s+){0,2}(?:sai|vai sair|costuma sair|pode sair|entra|vai entrar|e para)\s+(?:\S+\s+){0,3}(?:exame|teste|frequencia)\b|\b(?:importante|fundamental)\s+para\s+o\s+(?:exame|teste)\b|\bpergunta\s+de\s+exame\b|\btomem\s+nota\b/u,
  es: /\b(?:esto|esta parte|este tema|esta pregunta)\s+(?:\S+\s+){0,2}(?:entra|va a entrar|cae|suele caer|puede caer|sale|va a salir)\s+(?:\S+\s+){0,3}(?:examen|parcial|final)\b|\bpregunta\s+de\s+examen\b|\bapuntad(?:lo)?\s+esto\b|\bimportante\s+para\s+el\s+examen\b/u,
  en: /\b(?:this|that|it)\s+(?:will|is going to|might|could|may|is likely to)\s+(?:be|come up|appear|show up)\s+(?:on|in)\s+the\s+(?:exam|test|final|midterm)\b|\bexam\s+question\b|\bwrite\s+this\s+down\b|\bmake\s+sure\s+you\s+know\b/u,
};
const radarLang = (lang: string) => lang.slice(0, 2);

const lectures = CLASSES.flatMap((c) => c.lectures.map((l) => ({ cls: c, l })));
const transcriptOf = (l: DemoLecture): DemoSegment[] => {
  const t = l.transcript!;
  return buildTranscript({ key: l.key, durationMs: l.durationMs, keys: t.keySegments, speaker: l.speakers[0]!.id, fillerSpeaker: t.filler.speaker, sentences: FILLER[t.filler.lang], seed: t.filler.seed });
};
/** The effective text (pending corrections applied) of a segment. */
const effectiveText = (l: DemoLecture, segment: string) => {
  const seg = transcriptOf(l).find((s) => s.id === segment);
  if (!seg) throw new Error(`no segment ${segment} in ${l.key}`);
  return (l.edits ?? []).filter((e) => e.segment === segment).at(-1)?.text ?? seg.text;
};

describe('people (UX §7.3)', () => {
  it('commits the device IDs and member IDs the test key pool gives', () => {
    const seen = new Set<string>();
    for (const k of MEMBER_KEYS) {
      const p = PEOPLE[k];
      expect(memberIdOf(poolKey(p.personPool).pub)).toBe(p.memberId);
      for (const d of p.devices) {
        expect(deviceIdentity(d.pool).deviceId).toBe(d.deviceId);
        expect(deviceIdChecks(d.deviceId)).toBe(true);
        expect(d.pool).toBeLessThan(FIRST_FREE_POOL_SLOT);
        expect(seen.has(d.deviceId)).toBe(false);
        seen.add(d.deviceId);
      }
    }
    expect(PEOPLE.ana.devices[0]!.pool).toBe(0);
    expect(deviceIdentity(UNVERIFIED_DEVICE.pool).deviceId).toBe(UNVERIFIED_DEVICE.deviceId);
    expect(memberIdOf(poolKey(UNVERIFIED_DEVICE.personPool).pub)).not.toBe(PEOPLE.carla.memberId);
    expect(PEOPLE.carla.devices.map((d) => d.name)).toEqual(['Carla’s laptop', 'Carla’s desktop']);
  });
});

describe('time', () => {
  it('reads Lisbon wall times across the October DST change', () => {
    expect(new Date(lisbon('2026-10-20T10:00')).toISOString()).toBe('2026-10-20T09:00:00.000Z');
    expect(new Date(lisbon('2026-10-27T10:00')).toISOString()).toBe('2026-10-27T10:00:00.000Z');
    expect(lisbonDateTime('2026-11-12T10:00')).toBe('2026-11-12T10:00:00+00:00');
    expect(lisbonDateTime('2026-10-20T10:00')).toBe('2026-10-20T10:00:00+01:00');
    expect(clockMs('0:41:12')).toBe(2_472_000);
  });
});

describe('transcripts and markers', () => {
  it('lays key segments at their times, filler in the gaps, ids of the right shape', () => {
    for (const { l } of lectures.filter((x) => x.l.transcript)) {
      const segs = transcriptOf(l);
      const ids = new Set<string>();
      let prevEnd = 0;
      for (const s of segs) {
        expect(s.id).toMatch(RE_SEGMENT_ID);
        expect(s.id).toMatch(/^s_[0-9A-Za-z]{5,8}$/);
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        expect(s.startMs).toBeGreaterThanOrEqual(prevEnd);
        expect(s.endMs).toBeGreaterThan(s.startMs);
        expect(s.endMs).toBeLessThanOrEqual(l.durationMs);
        expect(l.speakers.map((x) => x.id)).toContain(s.speaker);
        prevEnd = s.endMs;
      }
      for (const k of l.transcript!.keySegments) {
        const s = segs.find((x) => x.id === k.id)!;
        expect(s.startMs).toBe(clockMs(k.at));
        expect(s.text).toBe(k.text);
      }
      // About 160 words a minute over the whole recording, with no long silences.
      const words = segs.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
      expect(words / (l.durationMs / 60_000)).toBeGreaterThan(120);
      expect(words / (l.durationMs / 60_000)).toBeLessThan(170);
    }
  });

  it('fills deterministically with Trama’s pauses', () => {
    const a = fillTranscript(1, 0, 60_000, FILLER.en);
    expect(fillTranscript(1, 0, 60_000, FILLER.en)).toEqual(a);
    expect(a[1]!.startMs - a[0]!.endMs).toBe(0);
    expect(a[2]!.startMs - a[1]!.endMs).toBe(7919 % 1100);
    expect(fillerId('l6', 0)).toBe('s_l6x000');
    expect(fillerId('b3', 62 * 62 + 1)).toBe('s_b3x101');
    for (const lang of ['pt', 'en', 'es'] as const) {
      expect(FILLER[lang]).toHaveLength(40);
      expect(new Set(FILLER[lang]).size).toBe(40);
    }
  });

  it('puts the exam radar exactly where UX §7.3 says, and never in filler', () => {
    for (const lang of ['pt', 'en', 'es'] as const) for (const s of FILLER[lang]) expect(RADAR[lang]!.test(fold(s)), s).toBe(false);
    const auto = (key: string) => {
      const { lecture } = findLecture(key)!;
      return demoTranscript(key)!.segments.filter((s) => RADAR[radarLang(lecture.language)]!.test(fold(s.text))).map((s) => s.startMs);
    };
    expect(auto('l8')).toEqual([]);
    expect(auto('b4')).toEqual([]);
    expect(auto('l6')).toEqual([clockMs('0:41:12'), clockMs('1:05:00')]);
    expect(auto('l7')).toEqual([]);
    expect(auto('b3')).toEqual([clockMs('0:18:40')]);
    // 41:12 is hidden (a manual exam marker within 30 s), 1:05:00 is shown.
    const l6 = findLecture('l6')!.lecture;
    const manualExam = l6.markers.filter((m) => m.kind === 'exam').map((m) => clockMs(m.at));
    expect(manualExam.some((t) => Math.abs(t - clockMs('0:41:12')) <= 30_000)).toBe(true);
    expect(manualExam.some((t) => Math.abs(t - clockMs('1:05:00')) <= 30_000)).toBe(false);
  });

  it('keeps every marker within its lecture and every highlight on its segment', () => {
    for (const { l } of lectures) {
      for (const m of l.markers) {
        expect(clockMs(m.at)).toBeGreaterThanOrEqual(0);
        expect(clockMs(m.at) + 3_000).toBeLessThanOrEqual(l.durationMs);
        if (m.note) expect(m.note.length).toBeLessThanOrEqual(200);
      }
      for (const h of l.highlights ?? []) expect(() => resolveQuote(effectiveText(l, h.segment), h.quote)).not.toThrow();
      if (l.cite) expect(() => resolveQuote(effectiveText(l, l.cite!.segment), l.cite!.quote)).not.toThrow();
    }
    const l6 = findLecture('l6')!.lecture;
    expect(l6.markers.map((m) => [m.at, m.kind])).toEqual([['0:12:05', 'important'], ['0:33:40', 'note'], ['0:41:12', 'exam'], ['0:52:30', 'confused'], ['1:20:10', 'todo']]);
  });

  it('turns the pending correction on s_l6e00 into the UX text', () => {
    const l6 = findLecture('l6')!.lecture;
    expect(transcriptOf(l6).find((s) => s.id === 's_l6e00')!.text).toBe('É o que diz o artigo 18.º, n.º 3.');
    expect(l6.transcript!.original!.s_l6e00).toBe(L6_E00_WHISPER);
    expect(effectiveText(l6, 's_l6e00')).toBe('É o que diz o artigo 18.º, n.º 3.');
  });

  it('scripts the transcripts the speech fake delivers for l8 and b4, and returns the seeded ones', () => {
    for (const key of ['l6', 'l7', 'l8', 'b3', 'b4']) {
      const t = demoTranscript(key)!;
      const { lecture } = findLecture(key)!;
      expect(t.language).toBe(lecture.language);
      expect(new Set(t.segments.map((s) => s.id)).size).toBe(t.segments.length);
      expect(t.segments.every((s) => RE_SEGMENT_ID.test(s.id) && s.endMs <= lecture.durationMs)).toBe(true);
      expect(t.segments.length).toBeGreaterThan(200);
      if (lecture.transcript) expect(t.segments).toEqual(transcriptOf(lecture).map((s) => (lecture.transcript!.original?.[s.id] ? { ...s, text: lecture.transcript!.original[s.id]! } : s)));
    }
    expect(demoTranscript('l8')!.segments.find((s) => s.id === 's_l8d00')!.startMs).toBe(clockMs('0:44:10'));
    expect(demoTranscript('nope')).toBeNull();
  });

  it('draws the peaks of UX §7.1', () => {
    const p = demoPeaks();
    expect(p).toHaveLength(1200);
    expect(p.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
    for (const i of [0, 1, 99, 777, 1199]) {
      const v = 60 + 50 * Math.sin(i / 7) + 40 * Math.sin(i / 23) + ((i * 7919) % 37);
      expect(p[i]).toBe(Math.max(0, Math.min(255, Math.round(v))));
    }
  });
});

// ── Citations ──────────────────────────────────────────────────────────────────────────────────────
interface Cited { where: string; text: string; c: DemoCitation }
function allCitations(): Cited[] {
  const out: Cited[] = [];
  const add = (where: string, text: string, cs: DemoCitation[]) => cs.forEach((c) => out.push({ where, text, c }));
  const fromAnswer = (where: string, a: DemoAiAnswer | undefined) => a && add(where, a.text, a.citations);
  for (const cls of CLASSES) {
    for (const ex of cls.exams) for (const q of ex.questions) fromAnswer(`${ex.key}/${q.key}`, q.answer);
    for (const m of cls.chat) fromAnswer(`chat ${cls.key} #${m.n}`, m.ai);
    for (const t of cls.ask) add(`ask ${t.key}`, t.answer, t.citations);
    for (const l of cls.lectures) if (l.summary) add(`summary ${l.key}`, l.summary.answer, l.summary.citations);
  }
  return out;
}
const REFS = /\[(S\d+(?:\s*,\s*S\d+)*)(?:\s*,\s*([^\]]{1,40}))?\]/g;

describe('citations (folder spec §8.15)', () => {
  const cited = allCitations();
  it('has the citations of UX §7.3', () => {
    // mock 10, pquiz 3, chat 2, Ask 2, the l6 summary 6.
    expect(cited.length).toBe(23);
  });

  it.each(cited.map((x) => [`${x.where} ${x.c.ref}`, x] as const))('%s resolves its quote', (_, { c }) => {
    const src = c.source;
    if (src.kind === 'lecture') {
      const { lecture } = findLecture(src.lecture)!;
      expect(() => resolveQuote(effectiveText(lecture, src.segment), c.quote)).not.toThrow();
      // Unique in the whole transcript too, so search lands on one place.
      expect(() => resolveQuote(transcriptOf(lecture).map((s) => s.text).join('\n'), c.quote)).not.toThrow();
      return;
    }
    const loc = src.locator;
    const unit = loc.type === 'slide' ? loc.slide : loc.page;
    expect(() => resolveQuote(docSourceText(src.doc, unit), c.quote)).not.toThrow();
    expect(() => resolveQuote(docWholeText(src.doc), c.quote)).not.toThrow();
    if (loc.type === 'article') expect(lfArticlePage(Number.parseInt(loc.article, 10))).toBe(loc.page);
    expect(c.quote.length).toBeLessThanOrEqual(300);
  });

  it('marks every cited ref in its text, and only S9 of II.c is hallucinated', () => {
    const hallucinated: string[] = [];
    const answers = new Map<string, { text: string; refs: string[] }>();
    for (const x of cited) {
      const e = answers.get(x.where) ?? { text: x.text, refs: [] };
      e.refs.push(x.c.ref);
      answers.set(x.where, e);
    }
    for (const [where, { text, refs }] of answers) {
      const inText = new Set<string>();
      for (const m of text.matchAll(REFS)) for (const r of m[1]!.split(/\s*,\s*/)) inText.add(r);
      for (const r of refs) expect(inText.has(r), `${where} cites ${r} without a marker`).toBe(true);
      for (const r of inText) if (!refs.includes(r)) hallucinated.push(`${where} ${r}`);
    }
    expect(hallucinated).toEqual(['mock/IIc S9']);
  });

  it('keeps the answer texts of UX §7.3', () => {
    const mock = CLASSES[0]!.exams.find((e) => e.key === 'mock')!;
    const t = (k: string) => mock.questions.find((q) => q.key === k)!.answer!.text;
    expect(t('I')).toContain('a professora usou um exemplo semelhante na aula [S4]');
    expect(t('I')).toContain('[S3, n.º 3]');
    expect(t('I')).toContain('**Conclusão.** A lei é desconforme com a Lei Fundamental de Exemplo, por violar os arts. 18.º e 30.º.');
    expect(t('IIb')).toBe('Só nos casos expressamente previstos na Lei Fundamental [S1], devendo as restrições limitar-se ao necessário e revestir caráter geral e abstrato, sem nunca atingir o conteúdo essencial [S1, n.º 3] [S2].');
    expect(t('IIc')).toContain('Na doutrina alemã fala-se, a este propósito, de «Wesensgehalt».');
    expect(t('III')).toBe('A frase é correta: mesmo em estado de exceção, a declaração nunca pode afetar o direito à vida [S1], que a Lei Fundamental declara inviolável [S2].');
  });
});

// ── Assets ─────────────────────────────────────────────────────────────────────────────────────────
describe('committed assets (tools/fixtures/build-demo-assets.mjs)', () => {
  const docs = CLASSES.flatMap((c) => c.documents);
  it('has exactly the assets the fixtures name', () => {
    const named = new Set([...docs.map((d) => d.asset), ...CLASSES.flatMap((c) => c.exams.flatMap((e) => (e.file ? [e.file.asset] : [])))]);
    expect([...named].sort()).toEqual([...DEMO_ASSETS].sort());
    for (const a of DEMO_ASSETS) expect(assetBytes(a).length).toBeGreaterThan(500);
  });

  it('prints every PDF page of the source text, with the cited quotes on the right pages', async () => {
    for (const d of docs.filter((x) => x.mime === 'application/pdf')) {
      const pdf = await extractPdfText(assetBytes(d.asset), pdfjs as unknown as PdfJsLike);
      expect(pdf.pages, d.key).toBe(d.pages);
      if (d.key === 'acordao') {
        expect(pdf.imagePages).toEqual([1, 2]);
        expect(pdf.text.trim()).toBe('');
        continue;
      }
      expect(pdf.imagePages, d.key).toEqual([]);
      for (let p = 1; p <= pdf.pages; p++) {
        const page = norm(pdf.text.slice(pdf.pageStarts[p - 1], pdf.pageStarts[p] ?? pdf.text.length));
        for (const line of docSourceText(d.key, p).split('\n')) expect(page, `${d.key} p. ${p}`).toContain(norm(line));
      }
    }
    for (const x of allCitations()) {
      if (x.c.source.kind !== 'document' || x.c.source.locator.type === 'slide') continue;
      const d = findDoc(x.c.source.doc)!.doc;
      const pdf = await extractPdfText(assetBytes(d.asset), pdfjs as unknown as PdfJsLike);
      const p = x.c.source.locator.page;
      expect(norm(pdf.text.slice(pdf.pageStarts[p - 1], pdf.pageStarts[p] ?? pdf.text.length))).toContain(norm(x.c.quote));
    }
  });

  it('gives the law its running header on every page and articles 1.º–40.º', async () => {
    const pdf = await extractPdfText(assetBytes('lf.pdf'), pdfjs as unknown as PdfJsLike);
    expect(pdf.pages).toBe(24);
    expect(LF_PAGES).toHaveLength(24);
    const pages = Array.from({ length: 24 }, (_, i) => pdf.text.slice(pdf.pageStarts[i], pdf.pageStarts[i + 1] ?? pdf.text.length));
    expect(pages.every((p) => p.includes('Lei Fundamental de Exemplo — texto fictício para demonstração'))).toBe(true);
    for (let n = 1; n <= 40; n++) expect(pdf.text).toContain(`Artigo ${n}.º (`);
    expect([13, 18, 19, 24, 30].map(lfArticlePage)).toEqual([5, 9, 10, 12, 15]);
  });

  it('builds the DOCX and PPTX files from the same text', async () => {
    for (const key of ['resumo', 'lab2']) {
      const d = findDoc(key)!.doc;
      const r = await docxToText(assetBytes(d.asset));
      for (const line of docSourceText(key, 1).split('\n')) expect(norm(r.text)).toContain(norm(line));
    }
    const resumo = docSourceText('resumo', 1);
    const words = resumo.split(/\s+/).length;
    expect(words).toBeGreaterThan(560);
    expect(words).toBeLessThan(660);
    for (const key of ['slides6', 'slides3']) {
      const d = findDoc(key)!.doc;
      const files = unzipSync(assetBytes(d.asset));
      const slides = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
      expect(slides).toHaveLength(docUnits(key));
      slides.forEach((name, i) => {
        const text = [...strFromU8(files[name]!).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]!.replace(/&amp;/g, '&')).join('\n');
        expect(text).toBe(docSourceText(key, i + 1));
      });
      expect(strFromU8(files['ppt/presentation.xml']!)).toContain('<p:sldIdLst>');
    }
    expect(docSourceText('slides6', 6).split('\n')[0]).toBe('Conteúdo essencial — o limite dos limites');
  });

  it('draws the plant cell as a PNG', () => {
    const png = assetBytes('cell.png');
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

// ── The seed ───────────────────────────────────────────────────────────────────────────────────────
async function seeded(extra: Partial<SeedOptions> = {}): Promise<{ platform: MemoryPlatform; keys: DemoKeys }> {
  const platform = createMemoryPlatform({ kind: 'demo', clock: { now: () => NOW } });
  const keys = await seedDemo(platform, { lang: 'en', theme: 'light', name: 'Ana Ribeiro', nowMs: NOW, empty: false, ...extra });
  return { platform, keys };
}
const files = (platform: MemoryPlatform, classId: string) => platform.mem.list(classId);
const json = <T>(b: Uint8Array) => JSON.parse(dec.decode(b)) as T;
const lines = <T>(b: Uint8Array) => dec.decode(b).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);

describe('seedDemo (UX §7.3 as files)', async () => {
  const { platform, keys } = await seeded();
  const law = keys.classes.law!;
  const bio = keys.classes.bio!;

  it('fills every UX §7.2 key', () => {
    expect(Object.keys(keys.classes).sort()).toEqual(['bio', 'hist', 'law', 'stats']);
    expect(Object.keys(keys.lectures).sort()).toEqual(['b3', 'b4', 'l6', 'l7', 'l8']);
    // `arriving` (INT) is a key only: the slides are in the global index, not in the class (doc-arriving).
    expect(Object.keys(keys.docs).sort()).toEqual(['acordao', 'apuntes', 'arriving', 'calendario', 'cell', 'esquemas', 'lab2', 'lf', 'primer', 'resumo', 'slides3', 'slides6']);
    expect(Object.keys(keys.notes).sort()).toEqual(['class8', 'mine6']);
    expect(Object.keys(keys.exams).sort()).toEqual(['final', 'freq', 'mock', 'parcial', 'pquiz', 'quiz1']);
    expect(Object.keys(keys.exams.mock!.questions).sort()).toEqual(['I', 'II', 'III', 'IIa', 'IIb', 'IIc']);
    expect(Object.keys(keys.exams.pquiz!.questions).sort()).toEqual(['1', '2', '3', '4']);
    expect(Object.values(keys.exams.mock!.questions).every(isQuestionId)).toBe(true);
    expect(Object.keys(keys.members).sort()).toEqual(['ana', 'bruno', 'carla', 'diogo', 'jamie']);
    expect(keys.members.ana).toEqual({ memberId: PEOPLE.ana.memberId, deviceIds: [PEOPLE.ana.devices[0]!.deviceId] });
    expect(keys.members.carla!.deviceIds).toHaveLength(2);
    expect(keys.lectures.l6).toMatchObject({ classKey: 'law', citeAtMs: 2_472_000, citeSegmentId: 's_l6d00', citeQuote: 'nunca pode atingir o conteúdo essencial do direito' });
    expect(keys.docs.lf).toEqual({ classKey: 'law', relPath: 'Documentos/Legislação/Lei Fundamental de Exemplo (texto fictício).pdf' });
    expect(keys.docs.calendario!.relPath).toBe('Documentos/Da conversa/Calendário de avaliações.pdf');
    expect(keys.notes.mine6).toEqual({ classKey: 'law', relPath: 'notes/Notas — Aula 6.md', private: true });
    expect(keys.notes.class8).toEqual({ classKey: 'law', relPath: 'Apontamentos/Resumo partilhado — Semana 8.md', private: false });
  });

  it('resolves every route of UX §7.4 and every key of UX §7.2', () => {
    const queries = [
      'route=today&sync=fake&ai=fake', 'route=class&class=law&tab=lectures&sync=fake', 'route=lecture&class=law&lecture=l6&cite=1&ai=fake',
      'route=lecture&class=law&lecture=l6&ai=fake', 'route=class&class=law&speech=fake&dialog=record', 'route=lecture&class=law&lecture=l7&speech=fake&recording=1',
      'route=lecture&class=bio&lecture=b4&model=missing&dialog=model', 'route=class&class=law&tab=documents',
      'route=document&class=law&doc=lf&page=9&quote=nunca%20podem%20atingir', 'route=exam&class=law&exam=mock&mode=review', 'route=exam&class=law&exam=mock&q=IIb&ai=fake',
      'route=exam&class=law&exam=mock&mode=practice', 'route=class&class=law&tab=chat&sync=fake', 'route=class&class=law&tab=ask&ai=fake',
      'route=class&class=law&tab=members&sync=fake&join=ask', 'route=class&class=law&tab=members&sync=fake&dialog=invite', 'route=class&class=law',
      'route=class&class=stats&tab=lectures', 'route=class&class=law&tab=ask&ai=busy',
      ...['l6', 'l7', 'l8', 'b3', 'b4'].map((l) => `route=lecture&lecture=${l}`),
      ...['lf', 'slides6', 'resumo', 'acordao', 'calendario', 'esquemas', 'primer', 'slides3', 'lab2', 'cell', 'apuntes'].map((d) => `route=document&doc=${d}`),
      ...['mine6', 'class8'].map((n) => `route=note&note=${n}`),
      ...['freq', 'final', 'mock', 'quiz1', 'pquiz', 'parcial'].map((e) => `route=exam&exam=${e}`),
      ...['I', 'IIa', 'IIb', 'IIc', 'III'].map((q) => `route=exam&exam=mock&q=${q}`), ...['1', '2', '3', '4'].map((q) => `route=exam&exam=pquiz&q=${q}`),
      ...['law', 'bio', 'stats', 'hist'].map((c) => `route=class&class=${c}`),
    ];
    for (const q of queries) {
      const flags = parseDemoFlags(`?${q}`);
      const route = demoRoute(flags, keys);
      const ids = Object.entries(route).filter(([k]) => ['classId', 'lectureId', 'relPath', 'examId'].includes(k)).map(([, v]) => v);
      expect(ids, q).not.toContain(MISSING_ID);
      if (flags.q) expect(route, q).toHaveProperty('questionId');
    }
    expect(demoRoute(parseDemoFlags('?route=lecture&lecture=l6&cite=1'), keys)).toMatchObject({ at: 2_472_000, segmentId: 's_l6d00' });
  });

  it('signs every record that must be signed, with derived ids and person proofs', async () => {
    for (const def of CLASSES) {
      const classId = keys.classes[def.key]!;
      const all = files(platform, classId);
      let signed = 0;
      for (const [path, f] of all) {
        const m = /^\.tramado\/(meta|members|consent|mod|bans)\/([A-Z2-7-]{63})\.jsonl?$/.exec(path);
        if (path === '.tramado/class.json') {
          const c = json<Record<string, unknown>>(f.bytes);
          expect(await verifySig(c, classId, path, platform.mem.deviceId)).toBe(true);
          signed++;
        } else if (m) {
          const writer = m[2]!;
          expect(f.modifiedBy).toBe(writer.slice(0, 7));
          const recs = path.endsWith('.jsonl') ? lines<Record<string, unknown>>(f.bytes) : [json<Record<string, unknown>>(f.bytes)];
          for (const r of recs) {
            expect(await verifySig(r, classId, path, writer), path).toBe(true);
            expect(r.memberId ?? (r as { deviceId?: string }).deviceId).toBeTruthy();
            signed++;
          }
          if (m[1] === 'members') {
            const mf = recs[0] as unknown as MemberFile;
            expect(mf.deviceId).toBe(writer);
            expect(await verifyPersonProof(mf, classId)).toBe(true);
          }
        }
      }
      expect(signed).toBeGreaterThanOrEqual(3);
      const roster = [...all.keys()].filter((p) => p.startsWith('.tramado/members/')).length;
      expect(roster).toBe(1 + def.members.length);
    }
    const meta = json<MetaFile>(files(platform, law).get(`.tramado/meta/${platform.mem.deviceId}.json`)!.bytes);
    expect(meta.fields.dirs?.value).toEqual({ lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Apontamentos', fromChat: 'Da conversa' });
    expect(meta.fields.askBeforeAdmit).toBeUndefined();
    expect(meta.organiserOps.map((o) => o.memberId)).toEqual([PEOPLE.ana.memberId]);
  });

  it('writes lectures with derived ids, exact audio hashes, transcripts, claims and the pending edit', async () => {
    const all = files(platform, law);
    for (const key of ['l6', 'l7', 'l8', 'b3', 'b4']) {
      const { cls, lecture } = findLecture(key)!;
      const classId = keys.classes[cls.key]!;
      const list = files(platform, classId);
      const lectureId = keys.lectures[key]!.lectureId;
      const manifestPath = [...list.keys()].find((p) => p.endsWith('/lecture.json') && json<LectureFile>(list.get(p)!.bytes).id === lectureId)!;
      const lf = json<LectureFile>(list.get(manifestPath)!.bytes);
      const dir = manifestPath.slice(0, -'/lecture.json'.length);
      expect(isUlid(lf.id)).toBe(true);
      expect(itemIdMatches(lf.id, lf.recordedBy.deviceId, lf.idNonce)).toBe(true);
      expect(lf.id.slice(0, 10)).toBe(lectureId.slice(0, 10));
      expect(lf.startedAt).toBe(new Date(lisbon(lecture.startedAt)).toISOString());
      expect(lf.durationMs).toBe(lecture.durationMs);
      expect(lf.recordedBy.deviceId).toBe(keys.members[lecture.recordedBy]!.deviceIds[0]);
      const audio = list.get(`${dir}/audio.webm`)!;
      expect(lf.audio).toMatchObject({ size: audio.bytes.length, sha256: sha256Hex(audio.bytes) });
      expect(audio.bytes).toEqual(fakeAudio(key));
      expect(audio.modifiedBy).toBe(lf.recordedBy.deviceId.slice(0, 7));
      expect(lf.consent.length).toBe(2);
      // G2 (folder spec §8.6): the recorder's offset in Lisbon (0 in winter, +60 in summer); transcript.md's date is local.
      expect(lf.utcOffsetMin).toBe(utcOffsetMinAt(Date.parse(lf.startedAt), 'Europe/Lisbon'));
      expect([0, 60]).toContain(lf.utcOffsetMin);
      const t = list.get(`${dir}/transcript.json`);
      expect(Boolean(t)).toBe(Boolean(lecture.transcript));
      if (t) {
        const tf = json<TranscriptFile>(t.bytes);
        expect(tf).toMatchObject({ lectureId, round: 1, revision: 1, audioSha256: lf.audio!.sha256, folded: {} });
        expect(tf.writer.deviceId).toBe(keys.members[lecture.transcript!.by]!.deviceIds[0]);
        expect(t.modifiedBy).toBe(tf.writer.deviceId.slice(0, 7));
        expect(tf.segments.every((s) => RE_SEGMENT_ID.test(s.id))).toBe(true);
        expect(tf.engine.modelId).toBe('turbo');
        // G1: transcript.md / .vtt are byte-equal to what LectureService writes from these two files (folder spec §8.8).
        const text = (p: string) => new TextDecoder().decode(list.get(p)!.bytes);
        expect(text(`${dir}/transcript.md`)).toBe(renderMarkdown(tf, lf));
        expect(text(`${dir}/transcript.vtt`)).toBe(renderVtt(tf));
        expect(text(`${dir}/transcript.md`)).toMatch(/^<!-- Generated by Tramado from transcript\.json \(revision 1\)\./);
        expect(text(`${dir}/transcript.vtt`).startsWith('WEBVTT\n\n')).toBe(true);
      } else {
        expect(list.has(`${dir}/transcript.md`) || list.has(`${dir}/transcript.vtt`)).toBe(false);
      }
      const claims = [...list.keys()].filter((p) => p.startsWith(`.tramado/claims/${lectureId}/`));
      expect(claims.length).toBe(lecture.claim ? 1 : 0);
      for (const p of claims) {
        const c = json<ClaimFile>(list.get(p)!.bytes);
        expect(c).toMatchObject({ kind: 'transcribe', lectureId, round: 1, status: lecture.claim!.status, audioSha256: lf.audio!.sha256 });
        expect(p.endsWith(`/${c.deviceId}.json`)).toBe(true);
      }
    }
    const l6 = keys.lectures.l6!.lectureId;
    const editPath = `.tramado/edits/${l6}/${PEOPLE.carla.devices[0]!.deviceId}.jsonl`;
    const [edit] = lines<TranscriptEditLine>(all.get(editPath)!.bytes);
    expect(edit).toMatchObject({ op: 'set_text', segment: 's_l6e00', round: 1, baseRevision: 1, memberId: PEOPLE.carla.memberId, text: 'É o que diz o artigo 18.º, n.º 3.' });
    expect(edit!.base).toBe(await sha1(L6_E00_WHISPER));
    expect(isHlc(edit!.hlc)).toBe(true);
    const working = json<ClaimFile>(all.get(`.tramado/claims/${keys.lectures.l8!.lectureId}/${PEOPLE.bruno.devices[0]!.deviceId}.json`)!.bytes);
    expect(working).toMatchObject({ status: 'working', progress: 0.4, etaMs: 1_500_000 });
    const presence = json<PresenceFile>(all.get(`.tramado/presence/${PEOPLE.bruno.devices[0]!.deviceId}.json`)!.bytes);
    expect(presence.activity.transcribing).toMatchObject({ lectureId: keys.lectures.l8!.lectureId, progress: 0.4 });
    expect(presence.activity.editing?.path).toBe('Apontamentos/Resumo partilhado — Semana 8.md');
    expect(await platform.cache.read(`peaks/${json<LectureFile>([...all.entries()].find(([p]) => p.endsWith('/lecture.json'))![1].bytes).audio!.sha256}-1200.json`)).not.toBeNull();
  });

  it('writes the documents with their adders, dates and hashes', () => {
    for (const def of CLASSES) {
      const list = files(platform, keys.classes[def.key]!);
      for (const d of def.documents) {
        const f = list.get(keys.docs[d.key]!.relPath)!;
        expect(f.bytes).toEqual(assetBytes(d.asset));
        expect(f.modifiedBy).toBe(keys.members[d.addedBy]!.deviceIds[0]!.slice(0, 7));
        expect(f.mtimeMs).toBe(lisbon(d.addedAt));
      }
    }
  });

  it('marks “Os meus esquemas” as only on this computer', async () => {
    const entry = (await platform.classes.list()).find((e) => e.classId === law)!;
    expect(entry.localIgnores).toEqual(['Documentos/Os meus esquemas.pdf']);
    expect(entry.shared).toBe(true);
    expect((await platform.classes.list()).find((e) => e.classId === keys.classes.hist)!.archived).toBe(true);
  });

  it('writes exams with derived ids, questions, and the shared answers of each asker', async () => {
    const list = files(platform, law);
    const examFile = (key: string, classId = law) => {
      const l = files(platform, classId);
      const p = [...l.keys()].find((x) => x.endsWith('/exam.json') && json<ExamFile>(l.get(x)!.bytes).id === keys.exams[key]!.examId)!;
      return { path: p, exam: json<ExamFile>(l.get(p)!.bytes) };
    };
    const { exam: freq } = examFile('freq');
    expect(freq).toMatchObject({ title: 'Frequência', type: 'midterm', status: 'upcoming', date: '2026-11-12T10:00:00+00:00', room: 'Anfiteatro 1.02', weightText: '40 %', questions: [] });
    expect(examFile('final').exam.date).toBe('2027-01-14T09:30:00+00:00');
    const { path, exam: mock } = examFile('mock');
    expect(path).toBe('Exames/Frequência 2025-26 (simulada)/exam.json');
    expect(itemIdMatches(mock.id, mock.importedBy.deviceId, mock.idNonce)).toBe(true);
    expect(mock.scale).toEqual({ max: 20, unit: 'valores' });
    expect(mock.files[0]).toMatchObject({ path: 'Exames/Frequência 2025-26 (simulada)/enunciado.pdf', pages: 2, sha256: sha256Hex(assetBytes('mock.pdf')) });
    expect(mock.questions.map((q) => q.number)).toEqual(['I', 'II', 'II.a', 'II.b', 'II.c', 'III']);
    const container = mock.questions.find((q) => q.number === 'II')!;
    expect(container).toMatchObject({ kind: 'container', choose: 2 });
    expect(mock.questions.filter((q) => q.parent === container.id).map((q) => q.number)).toEqual(['II.a', 'II.b', 'II.c']);
    const anaAnswers = json<AnswersFile>(list.get(`.tramado/answers/${mock.id}/${platform.mem.deviceId}.json`)!.bytes);
    const brunoAnswers = json<AnswersFile>(list.get(`.tramado/answers/${mock.id}/${PEOPLE.bruno.devices[0]!.deviceId}.json`)!.bytes);
    const byNumber = (f: AnswersFile) => f.answers.map((a) => mock.questions.find((q) => q.id === a.questionId)!.number);
    expect(byNumber(anaAnswers)).toEqual(['I', 'II.b', 'III']);
    expect(byNumber(brunoAnswers)).toEqual(['II.c']);
    for (const a of [...anaAnswers.answers, ...brunoAnswers.answers]) {
      const q = mock.questions.find((x) => x.id === a.questionId)!;
      expect(a.questionSha1).toBe(await sha1(q.text));
      for (const c of a.citations) {
        if (c.source.kind === 'document') expect(c.source.sha256).toBe(sha256Hex(list.get(c.source.path)!.bytes));
        if (c.source.kind === 'lecture') expect(Object.values(keys.lectures).map((l) => l!.lectureId)).toContain(c.source.lectureId);
        expect(c.quote!.exact.length).toBeGreaterThan(0);
        expect(c.quote!.prefix.length).toBeLessThanOrEqual(32);
        expect(c.quote!.suffix.length).toBeLessThanOrEqual(32);
      }
    }
    const iic = brunoAnswers.answers[0]!;
    expect(iic.model).toBe('google/gemma-4-31b-it:free');
    expect(iic.scope).toBe('materials+general');
    expect(iic.text.slice(iic.generalKnowledge[0]![0], iic.generalKnowledge[0]![1])).toBe('Na doutrina alemã fala-se, a este propósito, de «Wesensgehalt».');
    expect(anaAnswers.answers.find((a) => a.questionId === keys.exams.mock!.questions.IIb)).toMatchObject({ model: 'dots-studio/dots-3-note-preview:free', requestedModel: 'google/gemma-4-31b-it:free' });
    const pquiz = examFile('pquiz', bio).exam;
    expect(pquiz.questions.map((q) => q.kind)).toEqual(['multiple_choice', 'short', 'short', 'essay']);
    expect(pquiz.extraction?.method).toBe('typed');
  });

  it('writes the chat of UX §7.3 by month and by device, with replies, mentions, the AI answer, thanks and the pin', () => {
    const list = files(platform, law);
    const chat = [...list.entries()].filter(([p]) => p.startsWith('.tramado/chat/'));
    for (const [p, f] of chat) {
      const [, dev, month] = /^\.tramado\/chat\/([A-Z2-7-]{63})\/(\d{4}-\d{2})\.jsonl$/.exec(p)!;
      expect(f.modifiedBy).toBe(dev!.slice(0, 7));
      for (const l of lines<ChatLine>(f.bytes)) expect(new Date(Number(l.hlc.slice(0, 15))).toISOString().slice(0, 7)).toBe(month);
    }
    const all = chat.flatMap(([p, f]) => lines<ChatLine>(f.bytes).map((l) => ({ dev: p.split('/')[2]!, l }))).sort((a, b) => (a.l.hlc < b.l.hlc ? -1 : 1));
    expect(all).toHaveLength(12);
    expect(all.map((x) => x.l.type)).toEqual(['message', 'message', 'message', 'message', 'message', 'message', 'ai', 'thanks', 'message', 'message', 'message', 'message']);
    const msg = (i: number) => all[i]!.l as Extract<ChatLine, { type: 'message' }>;
    expect(msg(3).replyTo).toEqual({ deviceId: all[2]!.dev, id: all[2]!.l.id });
    expect(msg(4).attachments?.[0]).toMatchObject({ path: 'Documentos/Da conversa/Calendário de avaliações.pdf', mime: 'application/pdf' });
    expect(msg(5)).toMatchObject({ text: '<@ai> o que disse a professora sobre o conteúdo essencial?', mentions: ['ai'] });
    expect(msg(10)).toMatchObject({ text: `<@${PEOPLE.ana.memberId}> tens os apontamentos da aula 7? Faltei à segunda parte.`, mentions: [PEOPLE.ana.memberId] });
    const ai = all[6]!.l as Extract<ChatLine, { type: 'ai' }>;
    expect(ai).toMatchObject({ status: 'ok', model: 'google/gemma-4-31b-it:free', replyTo: { deviceId: all[5]!.dev, id: all[5]!.l.id } });
    expect(ai.citations.map((c) => c.label)).toEqual(['Aula 6 · 41:12', 'Lei Fundamental de Exemplo (texto fictício).pdf · p. 9 · art. 18.º']);
    expect(all[7]!.l).toMatchObject({ type: 'thanks', to: PEOPLE.ana.memberId, lectureId: keys.lectures.l7!.lectureId });
    expect(all[8]!.dev).toBe(platform.mem.deviceId);
    const pin = lines<ModLine>(list.get(`.tramado/mod/${PEOPLE.bruno.devices[0]!.deviceId}.jsonl`)!.bytes)[0]!;
    expect(pin).toMatchObject({ type: 'pin', target: { deviceId: all[1]!.dev, id: all[1]!.l.id } });
    expect(new Set(all.map((x) => `${x.dev}:${x.l.id}`)).size).toBe(12);
  });

  it('writes my private data: read marker, markers, highlight, summary, marks, practice, Ask thread, notes', async () => {
    const read = async <T>(classId: string, p: string) => json<T>((await platform.privateFiles.read(classId, p))!);
    const state = await read<{ readHlc: string }>(law, 'chat-state.json');
    const chat = [...files(platform, law).entries()].filter(([p]) => p.startsWith('.tramado/chat/')).flatMap(([, f]) => lines<ChatLine>(f.bytes));
    expect(chat.filter((l) => l.hlc > state.readHlc)).toHaveLength(3);
    expect((await read<{ readHlc: string }>(bio, 'chat-state.json')).readHlc).toBe(
      [...files(platform, bio).entries()].filter(([p]) => p.startsWith('.tramado/chat/')).flatMap(([, f]) => lines<ChatLine>(f.bytes)).map((l) => l.hlc).sort().at(-1),
    );
    const l6 = keys.lectures.l6!.lectureId;
    const markers = await read<{ markers: Array<{ atMs: number; rawMs: number; kind: string; note?: string }> }>(law, `markers/${l6}.json`);
    expect(markers.markers.map((m) => [m.atMs, m.kind])).toEqual([[725_000, 'important'], [2_020_000, 'note'], [2_472_000, 'exam'], [3_150_000, 'confused'], [4_810_000, 'todo']]);
    expect(markers.markers.find((m) => m.kind === 'confused')?.note).toBe('rever exemplo');
    const ann = dec.decode((await platform.privateFiles.read(law, 'annotations.jsonl'))!).trim().split('\n').map((l) => JSON.parse(l) as { kind: string; colour: string; target: { quote: { exact: string } } });
    expect(ann).toEqual([expect.objectContaining({ kind: 'highlight', colour: 'exam', target: expect.objectContaining({ quote: expect.objectContaining({ exact: 'nunca pode atingir o conteúdo essencial do direito' }) }) })]);
    const summary = await read<{ summary: { answer: string; citations: unknown[] } }>(law, `lectures/${l6}.json`);
    expect(summary.summary.answer.split('\n')).toHaveLength(6);
    expect(summary.summary.citations).toHaveLength(6);
    const marks = await read<{ marks: Record<string, string>; inPractice: Record<string, true>; practice: Record<string, { count: number }>; revealed: Record<string, true>; myAnswers: Record<string, string>; correct: Record<string, string> }>(law, `exams/${keys.exams.mock!.examId}.json`);
    const q = keys.exams.mock!.questions;
    expect(marks.marks).toEqual({ [q.I!]: 'right', [q.IIb!]: 'partly' });
    expect(Object.keys(marks.inPractice).sort()).toEqual([q.I, q.IIa, q.IIb, q.IIc, q.III].sort());
    expect(marks.practice[q.I!]!.count).toBe(2);
    expect(marks.practice[q.IIb!]!.count).toBe(1);
    expect(marks.practice[q.IIc!]!.count).toBe(1);
    expect(marks.revealed[q.IIb!]).toBeUndefined();
    expect(marks.myAnswers[q.I!]!.split('\n')).toHaveLength(2);
    expect(Object.keys(marks.correct)).toEqual([q.IIb]);
    const asks = await platform.privateFiles.list(law, 'ask');
    expect(asks).toHaveLength(1);
    const [turn] = dec.decode((await platform.privateFiles.read(law, asks[0]!.startsWith('ask/') ? asks[0]! : `ask/${asks[0]}`))!).trim().split('\n').map((l) => JSON.parse(l) as { question: string; citations: unknown[] });
    expect(turn).toMatchObject({ question: 'O que diz o art. 18.º sobre as leis restritivas?' });
    expect(turn!.citations).toHaveLength(2);
    const note = dec.decode((await platform.privateFiles.read(law, 'notes/Notas — Aula 6.md'))!);
    expect(note).toContain(`[41:12](tramado:lecture/${l6}?t=2472000)`);
    expect(note).toContain(`[12:05](tramado:lecture/${l6}?t=725000)`);
    expect(note).toContain(`(tramado:doc/${encodeURIComponent('Documentos/Legislação/Lei Fundamental de Exemplo (texto fictício).pdf')}?page=9)`);
    const classNote = dec.decode(files(platform, law).get('Apontamentos/Resumo partilhado — Semana 8.md')!.bytes);
    expect(classNote.split(/\s+/).length).toBeGreaterThan(150);
    expect(classNote.split(/\s+/).length).toBeLessThan(260);
  });

  it('writes the app files and the classes of the rail', async () => {
    const prefs = json<Record<string, string>>(new TextEncoder().encode((await platform.appFiles.read('prefs.json'))!));
    expect(JSON.parse(prefs['ui.classOrder']!)).toEqual(CLASSES.map((c) => keys.classes[c.key]));
    const ids = await platform.classes.list();
    expect(ids.map((e) => [e.dirName, e.shared, e.archived])).toEqual(CLASSES.map((c) => [c.name, c.shared, c.archived]));
    expect((await platform.secrets.status('openrouter')).set).toBe(true);
    // Stats has no lectures and hist is empty.
    expect([...files(platform, keys.classes.stats!).keys()].filter((p) => p.endsWith('lecture.json'))).toEqual([]);
    expect([...files(platform, keys.classes.hist!).keys()].filter((p) => !p.startsWith('.tramado/'))).toEqual([]);
  });

  it('is reproducible', async () => {
    const again = await seeded();
    expect(again.keys).toEqual(keys);
    const a = files(platform, law);
    const b = files(again.platform, law);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [p, f] of a) if (!p.startsWith('.tramado/presence/')) expect(sha256Hex(b.get(p)!.bytes), p).toBe(sha256Hex(f.bytes));
  });
});

describe('seedDemo flags (UX §7.2)', () => {
  it('join=ask turns on "Ask before letting people in" in law', async () => {
    const { platform, keys } = await seeded({ join: 'ask' });
    const path = `.tramado/meta/${platform.mem.deviceId}.json`;
    const meta = json<MetaFile>(files(platform, keys.classes.law!).get(path)!.bytes);
    expect(meta.fields.askBeforeAdmit?.value).toBe(true);
    expect(meta.hlc >= meta.fields.askBeforeAdmit!.hlc).toBe(true);
    expect(await verifySig(meta as unknown as Record<string, unknown>, keys.classes.law!, path, platform.mem.deviceId)).toBe(true);
  });

  it('unverified=1 adds Carla-PC, signed by its device but not bound to Carla', async () => {
    const { platform, keys } = await seeded({ unverified: true });
    const path = `.tramado/members/${UNVERIFIED_DEVICE.deviceId}.json`;
    const mf = json<MemberFile>(files(platform, keys.classes.law!).get(path)!.bytes);
    expect(mf).toMatchObject({ memberId: PEOPLE.carla.memberId, deviceName: 'Carla-PC', name: 'Carla Mendes' });
    expect(await verifySig(mf as unknown as Record<string, unknown>, keys.classes.law!, path, UNVERIFIED_DEVICE.deviceId)).toBe(true);
    expect(await verifyPersonProof(mf, keys.classes.law!)).toBe(false);
  });

  it('conflict=1 adds a sync-conflict sibling of class8', async () => {
    const { platform, keys } = await seeded({ conflict: true });
    const names = [...files(platform, keys.classes.law!).keys()].filter((p) => p.startsWith('Apontamentos/')).map((p) => p.slice('Apontamentos/'.length));
    const conflict = names.map(parseConflictName).find(Boolean);
    expect(conflict?.original).toBe('Resumo partilhado — Semana 8.md');
    expect(names).toHaveLength(2);
    const plain = await seeded();
    expect([...files(plain.platform, plain.keys.classes.law!).keys()].filter((p) => p.startsWith('Apontamentos/'))).toHaveLength(1);
  });

  it('ai=off leaves AI without a key', async () => {
    const { platform } = await seeded({ ai: 'off' });
    expect((await platform.secrets.status('openrouter')).set).toBe(false);
  });

  it('INT fixtures: a damaged PDF, a name Windows refuses, skipped audio, a class of one, many messages, the tray question', async () => {
    const { platform, keys } = await seeded({ brokenDoc: true, windowsName: true, skipAudio: true, solo: true, chatMany: 300, trayAsk: true });
    const law = files(platform, keys.classes.law!);
    expect(keys.docs.broken?.relPath).toBe('Documentos/Leituras/Apontamentos (danificado).pdf');
    expect(new TextDecoder().decode(law.get(keys.docs.broken!.relPath)!.bytes).startsWith('%PDF-1.7')).toBe(true);
    expect(law.has('Documentos/Leituras/Resumo: aula 6?.pdf')).toBe(true);
    expect(keys.docs.arriving?.relPath).toBe('Documentos/Slides/Aula 8 — Estado de exceção (slides).pptx');
    expect(law.has(keys.docs.arriving!.relPath)).toBe(false);
    const entry = (await platform.classes.list()).find((e) => e.classId === keys.classes.law)!;
    expect(entry.skipAudio).toBe(true);
    const audio = [...law.keys()].filter((p) => p.endsWith('/audio.webm'));
    expect(audio).toHaveLength(2);   // l6 and l8 (l7's recording is not here)
    expect(keys.classes.solo).toBeDefined();
    const solo = (await platform.classes.list()).find((e) => e.classId === keys.classes.solo)!;
    expect(solo.shared).toBe(true);
    expect([...files(platform, keys.classes.solo!).keys()].filter((p) => p.startsWith('.tramado/members/'))).toHaveLength(1);
    const chatLines = [...law].filter(([p]) => p.startsWith('.tramado/chat/')).reduce((n, [, f]) => n + new TextDecoder().decode(f.bytes).split('\n').filter(Boolean).length, 0);
    expect(chatLines).toBe(300 + 12);
    const prefs = JSON.parse((await platform.appFiles.read('prefs.json'))!) as Record<string, string>;
    expect(prefs['app.trayAsked']).toBe('0');
    expect(JSON.parse(prefs['ui.classOrder']!)).toHaveLength(5);
  });
});

describe('createFakeMedia (UX §7.1)', () => {
  function rig(durationMs = 10_000) {
    let t = 0;
    const timers = new Map<number, () => void>();
    let next = 1;
    const media = createFakeMedia(durationMs, {
      now: () => t,
      setInterval: (fn) => {
        timers.set(next, fn);
        return next++;
      },
      clearInterval: (h) => timers.delete(h as number),
    });
    const advance = (ms: number) => {
      for (let i = 0; i < ms / 250; i++) {
        t += 250;
        for (const fn of [...timers.values()]) fn();
      }
    };
    return { media, advance, timers };
  }

  it('plays at 4 Hz from performance time, pauses, seeks, skips and changes rate', () => {
    const { media, advance, timers } = rig();
    const seen: number[] = [];
    media.onTime((ms) => seen.push(ms));
    media.play();
    expect(media.playing).toBe(true);
    advance(1000);
    expect(media.ms).toBe(1000);
    expect(seen.slice(-4)).toEqual([250, 500, 750, 1000]);
    media.pause();
    expect(timers.size).toBe(0);
    advance(1000);
    expect(media.ms).toBe(1000);
    media.seek(5000);
    media.skip(-10_000);
    expect(media.ms).toBe(0);
    media.setRate(2);
    media.play();
    advance(1000);
    expect(media.ms).toBe(2000);
    media.setRate(10);
    expect(media.rate).toBe(3);
    media.toggle();
    expect(media.playing).toBe(false);
  });

  it('ends at the duration and moves by hand with tick()', () => {
    const { media, advance } = rig(1000);
    let ended = 0;
    media.onEnded(() => ended++);
    media.tick(400);
    expect(media.ms).toBe(400);
    media.play();
    advance(1000);
    expect(media.playing).toBe(false);
    expect(media.ms).toBe(1000);
    expect(ended).toBe(1);
    media.play();
    expect(media.ms).toBe(0);
    media.tick(5000);
    expect(ended).toBe(2);
    media.dispose();
    media.play();
    expect(media.playing).toBe(false);
  });

  it('lets the demo tick every live player', () => {
    const a = createFakeMedia(10_000, { now: () => 0, setInterval: () => 1, clearInterval: () => undefined });
    const b = createFakeMedia(10_000, { now: () => 0, setInterval: () => 1, clearInterval: () => undefined });
    b.dispose();
    tickFakeMedia(1500);
    expect(a.ms).toBe(1500);
    expect(b.ms).toBe(0);
    a.dispose();
  });
});
