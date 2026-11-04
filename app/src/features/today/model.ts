// Today's sections (UX §3.2) as pure functions over the class views, lecture lists, exam dates and chat views, so
// the rules (21 days, within 3 days, 14 days, at most 6, 60 characters…) are tested without a DOM.
import { DateTime } from 'luxon';
import type { ChatMessageView, ClassView, ExamDateView, LectureView } from '../../services/types/viewModels';

export const EXAM_DAYS = 21;
export const SOON_DAYS = 3;
export const RECENT_DAYS = 14;
export const RECENT_MAX = 6;
export const EXCERPT_MAX = 60;

export interface ClassData {
  cls: ClassView;
  lectures: LectureView[];
  dates: ExamDateView[];
  documents: number;
  chat: { items: ChatMessageView[]; unread: number; mentions: number };
}

/** Whole days from today's date to `at`'s date (0 today, 1 tomorrow), in the zone of `now`. */
export function daysUntil(at: string, now: DateTime): number {
  const d = DateTime.fromISO(at, { zone: now.zone });
  return Math.round(d.startOf('day').diff(now.startOf('day'), 'days').days);
}

export function greetingPart(now: DateTime): 'morning' | 'afternoon' | 'evening' {
  const h = now.hour;
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 19 ? 'afternoon' : 'evening';
}

/** Coming up: exam dates in the next 21 days over non-archived classes, ascending. */
export function comingUp(data: readonly ClassData[], now: DateTime): Array<{ cls: ClassView; exam: ExamDateView; days: number }> {
  const out: Array<{ cls: ClassView; exam: ExamDateView; days: number }> = [];
  for (const d of data) {
    if (d.cls.archived) continue;
    for (const exam of d.dates) {
      const days = daysUntil(exam.at, now);
      const at = DateTime.fromISO(exam.at, { zone: now.zone });
      if (days < 0 || days > EXAM_DAYS) continue;
      // A timed exam earlier today is over; an all-day one stays until midnight.
      if (days === 0 && !exam.allDay && at < now) continue;
      out.push({ cls: d.cls, exam, days });
    }
  }
  return out.sort((a, b) => (a.exam.at < b.exam.at ? -1 : a.exam.at > b.exam.at ? 1 : 0));
}

/** Recent lectures: started in the last 14 days, newest first, at most 6. */
export function recentLectures(data: readonly ClassData[], now: DateTime): Array<{ cls: ClassView; lecture: LectureView }> {
  const from = now.minus({ days: RECENT_DAYS }).toMillis();
  const all = data
    .filter((d) => !d.cls.archived)
    .flatMap((d) => d.lectures.map((lecture) => ({ cls: d.cls, lecture })))
    .filter(({ lecture }) => {
      const t = Date.parse(lecture.startedAt);
      return Number.isFinite(t) && t >= from && t <= now.toMillis() + 60_000;
    });
  return all.sort((a, b) => Date.parse(b.lecture.startedAt) - Date.parse(a.lecture.startedAt)).slice(0, RECENT_MAX);
}

/** Transcriptions: other devices' active claims, and the lectures nobody has claimed (oldest first). */
export function transcriptions(data: readonly ClassData[]): {
  others: Array<{ cls: ClassView; lecture: LectureView; device: string; percent: number }>;
  waiting: Array<{ cls: ClassView; lecture: LectureView }>;
} {
  const others: Array<{ cls: ClassView; lecture: LectureView; device: string; percent: number }> = [];
  const waiting: Array<{ cls: ClassView; lecture: LectureView }> = [];
  for (const d of data) {
    if (d.cls.archived || !d.cls.shared) continue;
    for (const lecture of d.lectures) {
      const s = lecture.transcription;
      if (s.kind === 'claimed' && !s.by.self && s.health !== 'stale') others.push({ cls: d.cls, lecture, device: s.by.deviceName || s.by.memberName, percent: Math.round(s.percent) });
      else if (s.kind === 'none' && lecture.audio?.present && !lecture.duplicateOf) waiting.push({ cls: d.cls, lecture });
    }
  }
  waiting.sort((a, b) => Date.parse(a.lecture.startedAt) - Date.parse(b.lecture.startedAt));
  return { others, waiting };
}

/** Unread: classes with unread messages or mentions; the newest mention of me, else the newest message (≤ 60 chars). */
export function unread(data: readonly ClassData[], me: string | null): Array<{ cls: ClassView; unread: number; mentions: number; from: string; excerpt: string }> {
  const out: Array<{ cls: ClassView; unread: number; mentions: number; from: string; excerpt: string }> = [];
  for (const d of data) {
    if (d.cls.archived || !d.cls.shared) continue;
    const n = d.chat.unread;
    const m = d.chat.mentions;
    if (n <= 0 && m <= 0) continue;
    const visible = d.chat.items.filter((x) => !x.deleted && (x.kind === 'message' || x.kind === 'ai') && !x.author.self && x.text.trim() !== '');
    const mention = [...visible].reverse().find((x) => x.mentions.some((y) => y.memberId === me || y.memberId === 'everyone'));
    const pick = mention ?? visible[visible.length - 1];
    out.push({ cls: d.cls, unread: n, mentions: m, from: pick ? pick.author.memberName.split(/\s+/)[0] ?? '' : '', excerpt: pick ? excerpt(withMentionNames(pick)) : '' });
  }
  return out;
}

/** A chat line's text with its `<@memberId>` tokens (folder spec §8.16) written as "@Name". */
export function withMentionNames(m: Pick<ChatMessageView, 'text' | 'mentions'>): string {
  return m.text.replace(/<@(everyone|ai|[a-z2-7]{26})>/g, (_, id: string) => `@${m.mentions.find((x) => x.memberId === id)?.name ?? (id === 'everyone' || id === 'ai' ? id : '')}`);
}

/** Plain text of a chat line, without Markdown marks, cut at a word to at most 60 characters with an ellipsis. */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const plain = text.replace(/[*_`>#[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** The welcome checklist's ticks, from data. */
export function checklist(data: readonly ClassData[]): { classes: boolean; lecture: boolean; document: boolean; exam: boolean } {
  return {
    classes: data.length > 0,
    lecture: data.some((d) => d.lectures.length > 0),
    document: data.some((d) => d.documents > 0),
    exam: data.some((d) => d.dates.length > 0),
  };
}
