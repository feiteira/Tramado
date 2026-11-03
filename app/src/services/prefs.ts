// config/prefs.json: a flat string map written only by TS (architecture §13.3). Every key with its default
// and the values `set` accepts. Frozen after M0; no owner (bugs are fixed by the integrator at a gate).
import { PlatformError } from '../core/errors';
import { isClassId, isModelId } from '../core/model/ids';
import type { Platform } from '../platform/types';
import { Store, type ReadableStore } from './store';

export const PREF_DEFAULTS = {
  'ui.locale': '',
  'ui.theme': 'system',
  'ui.textSize': '1',
  'ui.readingFont': 'default',
  'ui.reduceMotion': 'system',
  'ui.classOrder': '[]',
  'app.trayOnClose': '1',
  'app.trayAsked': '0',
  'classes.last': '',
  'today.checklistDismissed': '0',
  'search.recent': '[]',
  'lecture.playbackRate': '1',
  'ai.enabled': '1',
  'ai.model': 'google/gemma-4-31b-it:free',
  'ai.fallbacks': '[]',
  'ai.customHost': '',
  'ai.answerLanguage': 'question',
  'ai.generalDefault': '0',
  'ai.deepDefault': '0',
  'exam.tryFirst': '1',
  'speech.model': 'turbo',
  'speech.volunteer': 'plugged',
  'speech.volunteerAsked': '0',
  'speech.cloud': '0',
  'speech.cloudModel': 'openai/whisper-large-v3-turbo',
  'speech.cloudAuto': '0',
  'speech.inputDevice': '',
  'speech.bitrate': '24000',
  'speech.markerShortcuts': '',
  'speech.markerOffsetMs': '3000',
  'sync.localOnly': '0',
  'sync.paused': '0',
  'sync.maxSendKbps': '0',
  'sync.maxRecvKbps': '0',
  'notify.system': '1',
  'notify.default': 'important',
  'notify.transcripts': '1',
  'notify.joins': '1',
  'notify.exams': '1',
  'notify.model': '1',
  'privacy.deleteAudioAfterDays': '0',
  'dev.rotation': '0',
} as const;

export type PrefKey = keyof typeof PREF_DEFAULTS | `record.${string}` | `notify.class.${string}` | `pinsHidden.${string}`;

export interface PrefsStore {
  get(k: PrefKey): string;                         // default when unset (PREF_DEFAULTS, or '' for the template keys)
  set(k: PrefKey, v: string): Promise<void>;       // validates the value against §13.3; INVALID otherwise
  store: ReadableStore<Readonly<Record<string, string>>>;
}

const oneOf = (...xs: string[]) => (v: string) => xs.includes(v);
const bool01 = oneOf('0', '1');
const jsonArray = (max: number, item: (x: unknown) => boolean) => (v: string) => {
  try {
    const a: unknown = JSON.parse(v);
    return Array.isArray(a) && a.length <= max && a.every(item);
  } catch {
    return false;
  }
};
const nonNegInt = (v: string) => /^\d{1,9}$/.test(v);
const modelId = (v: string) => /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._:-]+$/.test(v) && v.length <= 120;
const RATES = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2', '2.5', '3'];

const RULES: Record<keyof typeof PREF_DEFAULTS, (v: string) => boolean> = {
  'ui.locale': oneOf('', 'en', 'pt', 'es'),
  'ui.theme': oneOf('system', 'light', 'dark'),
  'ui.textSize': oneOf('0.875', '1', '1.125', '1.25', '1.5'),
  'ui.readingFont': oneOf('default', 'atkinson', 'opendyslexic'),
  'ui.reduceMotion': oneOf('system', '1'),
  'ui.classOrder': jsonArray(10_000, isClassId),
  'app.trayOnClose': bool01,
  'app.trayAsked': bool01,
  'classes.last': (v) => v === '' || isClassId(v),
  'today.checklistDismissed': bool01,
  'search.recent': jsonArray(5, (x) => typeof x === 'string' && x.length <= 200),
  'lecture.playbackRate': oneOf(...RATES),
  'ai.enabled': bool01,
  'ai.model': modelId,
  'ai.fallbacks': jsonArray(2, (x) => typeof x === 'string' && modelId(x)),
  'ai.customHost': (v) => v === '' || /^[A-Za-z0-9_-]{1,64}$/.test(v),
  'ai.answerLanguage': oneOf('question', 'ui'),
  'ai.generalDefault': bool01,
  'ai.deepDefault': bool01,
  'exam.tryFirst': bool01,
  'speech.model': oneOf('turbo', 'small', 'large-v3'),
  'speech.volunteer': oneOf('off', 'plugged', 'always'),
  'speech.volunteerAsked': bool01,
  'speech.cloud': bool01,
  'speech.cloudModel': modelId,
  'speech.cloudAuto': bool01,
  'speech.inputDevice': (v) => v.length <= 512,
  'speech.bitrate': oneOf('24000', '16000'),
  'speech.markerShortcuts': oneOf('', '1'),
  'speech.markerOffsetMs': oneOf('0', '3000', '5000', '10000'),
  'sync.localOnly': bool01,
  'sync.paused': bool01,
  'sync.maxSendKbps': nonNegInt,
  'sync.maxRecvKbps': nonNegInt,
  'notify.system': bool01,
  'notify.default': oneOf('important', 'all', 'none'),
  'notify.transcripts': bool01,
  'notify.joins': bool01,
  'notify.exams': bool01,
  'notify.model': bool01,
  'privacy.deleteAudioAfterDays': oneOf('0', '30', '90'),
  'dev.rotation': oneOf('0'),
};

function validRecord(v: string): boolean {
  try {
    const r = JSON.parse(v) as Record<string, unknown>;
    return (
      typeof r === 'object' && r !== null &&
      (r.mode === 'room' || r.mode === 'online') && typeof r.includeMic === 'boolean' &&
      (r.share === 'audio+transcript' || r.share === 'transcript-only' || r.share === 'none') &&
      typeof r.language === 'string' && (r.language === 'auto' || /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(r.language))
    );
  } catch {
    return false;
  }
}

/** Whether `v` is an accepted value of `k` (architecture §13.3). */
export function isValidPref(k: string, v: string): boolean {
  if (typeof v !== 'string') return false;
  if (k in RULES) return RULES[k as keyof typeof PREF_DEFAULTS](v);
  if (k.startsWith('record.')) return isClassId(k.slice(7)) && validRecord(v);
  if (k.startsWith('notify.class.')) return isClassId(k.slice(13)) && ['important', 'all', 'none'].includes(v);
  if (k.startsWith('pinsHidden.')) return isClassId(k.slice(11)) && bool01(v);
  return false;
}

/** Reads prefs.json robustly (Trama's parsePrefs): a string map; anything else is dropped. */
export function parsePrefs(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && isValidPref(k, v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** The prefs store over platform.appFiles; writes are serialised (one at a time, last value wins). */
export async function createPrefsStore(platform: Pick<Platform, 'appFiles'>): Promise<PrefsStore> {
  const store = new Store<Readonly<Record<string, string>>>(parsePrefs(await platform.appFiles.read('prefs.json')));
  let chain: Promise<void> = Promise.resolve();
  return {
    store,
    get(k) {
      const v = store.get()[k];
      return v ?? (PREF_DEFAULTS as Record<string, string>)[k] ?? '';
    },
    set(k, v) {
      if (!isValidPref(k, v)) return Promise.reject(new PlatformError('INVALID', `invalid value for pref ${k}`));
      store.set({ ...store.get(), [k]: v });
      const next = chain.then(() => platform.appFiles.write('prefs.json', JSON.stringify(store.get(), null, 2) + '\n'));
      chain = next.catch(() => undefined);
      return next;
    },
  };
}

export { isModelId };
