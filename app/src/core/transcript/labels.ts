// The words Tramado writes *into* transcript files (folder spec §8.8): default speaker labels and the
// "recorded by" of transcript.md. They follow the transcript's language, not the UI's: Portuguese when
// the language matches `pt` (any region), Spanish when it matches `es`, otherwise English (folder spec §2
// `Lang` matching). The UI's own labels live in the `lectures` catalogs.
import { langMatches, type Lang } from '../model/ids';
import type { TranscriptFile } from '../model/files';

export type FileLang = 'pt' | 'es' | 'en';

/** The language of the labels written into a transcript of language `lang`. */
export function fileLang(lang: Lang | 'auto' | null | undefined): FileLang {
  if (!lang || lang === 'auto') return 'en';
  if (langMatches(lang, 'pt')) return 'pt';
  if (langMatches(lang, 'es')) return 'es';
  return 'en';
}

const SPEAKERS: Record<FileLang, { lecture: string; me: string; class: string; other: string }> = {
  en: { lecture: 'Lecturer', me: 'Me', class: 'Class', other: 'Speaker' },
  pt: { lecture: 'Professor', me: 'Eu', class: 'Turma', other: 'Orador' },
  es: { lecture: 'Profesor', me: 'Yo', class: 'Clase', other: 'Hablante' },
};

const RECORDED_BY: Record<FileLang, string> = { en: 'recorded by', pt: 'gravado por', es: 'grabado por' };

/** Speaker ids of folder spec §8.8: `lecture`, `me`, `class` or `spk_<n>`. */
export const RE_SPEAKER_ID = /^(?:lecture|me|class|spk_\d{1,3})$/;
export const isSpeakerId = (s: unknown): s is string => typeof s === 'string' && RE_SPEAKER_ID.test(s);

/**
 * The default label of a speaker id. `me` is the person who recorded (their name, when known: the
 * transcript is shared, so "Me" would name the wrong person for everyone else).
 */
export function speakerLabel(id: string, lang: Lang | 'auto' | null | undefined, recorderName?: string | null): string {
  const l = SPEAKERS[fileLang(lang)];
  if (id === 'lecture') return l.lecture;
  if (id === 'class') return l.class;
  if (id === 'me') return recorderName?.trim() ? recorderName.trim().slice(0, 40) : l.me;
  const n = /^spk_(\d{1,3})$/.exec(id);
  return n ? `${l.other} ${Number(n[1])}` : id;
}

/** "gravado por" / "grabado por" / "recorded by". */
export function recordedByLabel(lang: Lang | 'auto' | null | undefined): string {
  return RECORDED_BY[fileLang(lang)];
}

/** The label of `id` in a transcript, or its default when the transcript does not list it. */
export function labelOf(t: Pick<TranscriptFile, 'speakers' | 'language'>, id: string): string {
  return t.speakers.find((s) => s.id === id)?.label ?? speakerLabel(id, t.language);
}

/**
 * The engine as people read it: "whisper.cpp large-v3-turbo" (the ggml file stem without its `ggml-`
 * prefix and quantisation suffix), "openrouter whisper-large-v3-turbo", "vtt".
 */
export function engineLabel(engine: TranscriptFile['engine']): string {
  const model = engine.model?.trim();
  if (!model) return engine.name;
  const short =
    engine.kind === 'local'
      ? model.replace(/^ggml-/, '').replace(/-q\d+_\d+$/, '').replace(/-f(?:16|32)$/, '')
      : model.slice(model.lastIndexOf('/') + 1);
  return `${engine.name} ${short}`;
}
