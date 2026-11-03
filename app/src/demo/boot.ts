// The browser demo (architecture §11.6, UX §7): the memory platform with the fakes, the URL parameters of
// UX §7.2 parsed into DemoFlags, the seed, the initial route and `dialog=`, and window.__tramadoDemo.
// Everything lives in memory and disappears when the tab closes. Frozen after M0.
import { fromBase64 } from '../core/bytes';
import { isUiLocale, type UiLocale } from '../core/i18n/languages';
import { mulberry32 } from '../core/util/prng';
import { DIALOG_IDS, type DialogId, type DialogPropsMap } from '../features/registry';
import { createMemoryPlatform, type MemoryPlatform } from '../platform/memory';
import { createFakeAi } from '../platform/memory/ai';
import { createFakeSpeech } from '../platform/memory/speech';
import type { AppProps } from '../App';
import type { AppServicesImpl } from '../services/index';
import { systemClock } from '../services/context';
import type { InitialDialog } from '../shell/AppState';
import { CLASS_TABS, ROUTE_NAMES, SETTINGS_SECTIONS, type ClassTabId, type Route, type SettingsSection } from '../shell/routes';
import { createWorkerExtractHost, createWorkerHost } from '../workers/hosts';
import type { DemoControls } from './controls';
import { freeze } from './freeze';
import { installHooks } from './hooks';
import { MISSING_ID, type DemoKeys } from './keys';
import { seedDemo } from './seed';

export interface DemoFlags {
  /** `demo=empty`: a first run (onboarding step 1). */
  empty: boolean;
  lang: UiLocale;
  theme: 'light' | 'dark';
  /** The frozen time (zone Europe/Lisbon). */
  clock: string;
  name: string;
  route: Route['name'];
  class: string | null;
  tab: ClassTabId | null;
  lecture: string | null;
  at: number | null;
  cite: boolean;
  doc: string | null;
  page: number | null;
  quote: string | null;
  note: string | null;
  exam: string | null;
  q: string | null;
  mode: 'extracting' | 'review' | 'answers' | 'practice' | null;
  section: SettingsSection | null;
  ai: 'fake' | 'off' | 'busy' | 'quota' | 'badkey';
  speech: 'fake' | null;
  model: 'ready' | 'missing' | 'downloading';
  sync: 'fake' | 'offline' | 'error' | 'local';
  recording: boolean;
  join: 'ask' | null;
  unverified: boolean;
  conflict: boolean;
  dialog: DialogId | null;
  code: string | null;
}

const oneOf = <T extends string>(v: string | null, all: readonly T[], dflt: T): T => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : dflt);
const maybe = <T extends string>(v: string | null, all: readonly T[]): T | null => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : null);
const int = (v: string | null): number | null => (v !== null && /^\d{1,10}$/.test(v) ? Number(v) : null);
const str = (v: string | null): string | null => (v === null || v === '' ? null : v);

export function parseDemoFlags(search: string): DemoFlags {
  const q = new URLSearchParams(search);
  const lang = q.get('lang');
  return {
    empty: q.get('demo') === 'empty',
    lang: isUiLocale(lang) ? lang : 'en',
    theme: q.get('theme') === 'dark' ? 'dark' : 'light',
    clock: str(q.get('clock')) ?? '2026-11-03T15:30',
    name: str(q.get('name'))?.slice(0, 64) ?? 'Ana Ribeiro',
    route: oneOf(q.get('route'), ROUTE_NAMES, 'today'),
    class: str(q.get('class')),
    tab: maybe(q.get('tab'), CLASS_TABS),
    lecture: str(q.get('lecture')),
    at: int(q.get('at')),
    cite: q.get('cite') === '1',
    doc: str(q.get('doc')),
    page: int(q.get('page')),
    quote: str(q.get('quote')),
    note: str(q.get('note')),
    exam: str(q.get('exam')),
    q: str(q.get('q')),
    mode: maybe(q.get('mode'), ['extracting', 'review', 'answers', 'practice'] as const),
    section: maybe(q.get('section'), SETTINGS_SECTIONS),
    ai: oneOf(q.get('ai'), ['fake', 'off', 'busy', 'quota', 'badkey'] as const, 'fake'),
    speech: q.get('speech') === 'fake' ? 'fake' : null,
    model: oneOf(q.get('model'), ['ready', 'missing', 'downloading'] as const, 'ready'),
    sync: oneOf(q.get('sync'), ['fake', 'offline', 'error', 'local'] as const, 'fake'),
    recording: q.get('recording') === '1',
    join: q.get('join') === 'ask' ? 'ask' : null,
    unverified: q.get('unverified') === '1',
    conflict: q.get('conflict') === '1',
    dialog: maybe(q.get('dialog'), DIALOG_IDS),
    code: str(q.get('code')),
  };
}

/** The initial route of `route=` and the key parameters (UX §7.2). Unknown keys resolve to the Missing state. */
export function demoRoute(f: DemoFlags, keys: DemoKeys): Route {
  const classKeyOf = (k: string | null | undefined) => (k ? keys.classes[k] : undefined);
  const classId = (k: string | null | undefined) => classKeyOf(k) ?? MISSING_ID;
  switch (f.route) {
    case 'today':
      return { name: 'today' };
    case 'class':
      return { name: 'class', classId: classId(f.class ?? 'law'), ...(f.tab ? { tab: f.tab } : {}) };
    case 'lecture': {
      const l = f.lecture ? keys.lectures[f.lecture] : undefined;
      if (!l) return { name: 'lecture', classId: MISSING_ID, lectureId: MISSING_ID };
      const at = f.cite ? l.citeAtMs : (f.at ?? undefined);
      return {
        name: 'lecture', classId: classId(l.classKey), lectureId: l.lectureId,
        ...(at !== undefined ? { at } : {}),
        ...(f.cite && l.citeSegmentId ? { segmentId: l.citeSegmentId } : {}),
        ...(f.cite && l.citeQuote ? { quote: l.citeQuote } : {}),
      };
    }
    case 'document': {
      const d = f.doc ? keys.docs[f.doc] : undefined;
      if (!d) return { name: 'document', classId: MISSING_ID, relPath: f.doc ?? MISSING_ID };
      return { name: 'document', classId: classId(d.classKey), relPath: d.relPath, ...(f.page !== null ? { page: f.page } : {}), ...(f.quote ? { quote: f.quote } : {}) };
    }
    case 'note': {
      const n = f.note ? keys.notes[f.note] : undefined;
      if (!n) return { name: 'note', classId: MISSING_ID, relPath: f.note ?? MISSING_ID, private: false };
      return { name: 'note', classId: classId(n.classKey), relPath: n.relPath, private: n.private };
    }
    case 'exam': {
      const e = f.exam ? keys.exams[f.exam] : undefined;
      if (!e) return { name: 'exam', classId: MISSING_ID, examId: MISSING_ID };
      const qid = f.q ? e.questions[f.q] : undefined;
      return { name: 'exam', classId: classId(e.classKey), examId: e.examId, ...(qid ? { questionId: qid } : {}), ...(f.mode ? { mode: f.mode } : {}) };
    }
    case 'practice':
      return { name: 'practice', classId: classId(f.class ?? 'law') };
    case 'ask':
      return { name: 'ask', ...(f.quote ? { query: f.quote } : {}) };
    case 'settings':
      return { name: 'settings', ...(f.section ? { section: f.section } : {}) };
  }
}

/** A fictional finished recording for the `save` and `recover` dialogs. */
function demoRecording(classId: string, nowMs: number, state: 'stopped' | 'recovered') {
  return {
    recordingId: '01JBX0000000000000000DEMO0', classId, title: 'Aula 9', mode: 'room' as const, language: 'pt-PT',
    startedAt: new Date(nowMs - 5_400_000).toISOString(), durationMs: 5_400_000, channels: 1 as const, bitrate: 24000,
    speakers: [], pauses: [], markers: [], state, recoveredLostMs: state === 'recovered' ? 4000 : null,
  };
}

/** The props `dialog=<id>` opens with: the class of `class=` (default `law`), the other keys likewise. */
export function demoDialog(f: DemoFlags, keys: DemoKeys, nowMs: number): InitialDialog | null {
  if (!f.dialog) return null;
  const classId = keys.classes[f.class ?? 'law'] ?? MISSING_ID;
  const exam = f.exam ? keys.exams[f.exam] : undefined;
  const lecture = f.lecture ? keys.lectures[f.lecture] : undefined;
  const props: { [I in DialogId]: DialogPropsMap[I] } = {
    'new-class': {}, 'class-settings': { classId }, leave: { classId }, invite: { classId }, join: f.code ? { code: f.code } : {},
    record: f.class ? { classId } : {}, save: { recording: demoRecording(classId, nowMs, 'stopped') }, recover: { recording: demoRecording(classId, nowMs, 'recovered') },
    import: { classId }, model: { classId, lectureId: lecture?.lectureId ?? MISSING_ID }, 'exam-date': { classId, ...(exam ? { examId: exam.examId } : {}) },
    'exam-paper': { classId }, 'answer-settings': { classId, examId: exam?.examId ?? MISSING_ID, qids: [] }, shortcuts: {},
    'first-share': { classId }, 'mass-delete': { classId }, 'recently-deleted': { classId },
  };
  return { id: f.dialog, props: props[f.dialog] } as InitialDialog;
}

/** The parts of DemoControls the memory platform provides itself; the fakes add theirs (wave 1). */
function controlsFor(platform: MemoryPlatform, keys: DemoKeys): DemoControls {
  return {
    files: {
      async addFile(classKey, relPath, base64) {
        const classId = keys.classes[classKey];
        if (!classId) throw new Error(`unknown class key ${classKey}`);
        platform.mem.addFile(classId, relPath, fromBase64(base64));
      },
      queueAnswer: (a) => platform.mem.queueDialog(a),
    },
  };
}

export async function bootDemo(search: string = window.location.search): Promise<AppProps> {
  const flags = parseDemoFlags(search);
  freeze(flags.clock);
  const nowMs = Date.now();
  const platform = createMemoryPlatform({
    kind: 'demo',
    clock: { now: () => Date.now() },
    rand: mulberry32(0x7a3a),
    syncMode: flags.sync,
    ai: createFakeAi({ mode: flags.ai }),
    ...(flags.speech === 'fake' ? { speech: createFakeSpeech({ model: flags.model, recording: flags.recording }) } : {}),
    power: { source: 'battery', percent: 64 },
    selftestUrl: '/demo/lecture.webm',
  });
  const keys = await seedDemo(platform, { lang: flags.lang, theme: flags.theme, name: flags.name, nowMs, empty: flags.empty });
  const hooks = installHooks(controlsFor(platform, keys));
  // Worker-backed hosts (architecture §11.7); the workers are stubs until T-DOCS.
  const indexHost = createWorkerHost(new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' }));
  const extractHost = createWorkerExtractHost(new Worker(new URL('../workers/extract.worker.ts', import.meta.url), { type: 'module' }));
  return {
    platform,
    options: {
      context: { clock: systemClock, rand: mulberry32(0x5eed1), indexHost, extractHost },
      initialRoute: () => demoRoute(flags, keys),
      initialDialog: () => demoDialog(flags, keys, nowMs),
      example: { leave: () => window.location.assign(`${window.location.pathname}?demo=empty&lang=${flags.lang}&theme=${flags.theme}`) },
      onReady: (services: AppServicesImpl) => {
        void services;
        hooks.ready = true;
      },
    },
  };
}
