import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { ChatMessageView, ClassView, ExamDateView, LectureView } from '../../services/types/viewModels';
import { checklist, comingUp, daysUntil, excerpt, greetingPart, recentLectures, transcriptions, unread, type ClassData } from './model';

const now = DateTime.fromISO('2026-11-03T15:30', { zone: 'Europe/Lisbon' });
const cls = (id: string, p: Partial<ClassView> = {}): ClassView => ({
  id, name: id, shortName: id.toUpperCase(), color: '#12a594', icon: 'scale', lecturer: null, term: null, language: 'pt-PT', vocabulary: '', shared: true, archived: false,
  path: '/x', sync: { kind: 'upToDate' }, onlineMembers: 0, memberCount: 1, unread: 0, mentions: 0, recordingBy: null, nextExams: [], pins: [], notify: 'important',
  askBeforeJoin: false, skipAudio: false, organisers: [], newerFormat: false, ...p,
});
const dev = (self = false) => ({ deviceId: self ? 'me' : 'b', deviceName: self ? "Ana's laptop" : "Bruno's laptop", memberId: self ? 'ana' : 'bruno', memberName: self ? 'Ana Ribeiro' : 'Bruno Costa', self });
const exam = (id: string, at: string, p: Partial<ExamDateView> = {}): ExamDateView => ({ examId: id, classId: 'law', title: id, kind: 'midterm', at, allDay: false, room: null, covers: null, weight: null, practiceCount: 0, ...p });
const lecture = (id: string, startedAt: string, p: Partial<LectureView> = {}): LectureView => ({
  id, classId: 'law', title: id, startedAt, durationMs: 60_000, mode: 'room', language: 'pt-PT', recordedBy: dev(), audio: { present: true, arriving: false, skipped: false },
  transcription: { kind: 'none' }, myMarkers: { important: 0, confused: 0, exam: 0, todo: 0, note: 0 }, autoExamMarks: 0, duplicateOf: null, probableDuplicateOf: null,
  newerFormat: false, untrustedTranscript: false, ...p,
});
const msg = (id: string, text: string, p: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id, author: dev(), at: '2026-11-03T12:15:00Z', text, kind: 'message', replyTo: null, attachments: [], mentions: [], edited: false, deleted: false, hiddenBy: null, pinned: false,
  delivery: 'sent', unverified: false, ...p,
});
const data = (c: ClassView, p: Partial<ClassData> = {}): ClassData => ({ cls: c, lectures: [], dates: [], documents: 0, chat: { items: [], unread: 0, mentions: 0 }, ...p });

describe('Today (UX §3.2)', () => {
  it('greets by the time of day', () => {
    expect(greetingPart(now.set({ hour: 5 }))).toBe('morning');
    expect(greetingPart(now.set({ hour: 11, minute: 59 }))).toBe('morning');
    expect(greetingPart(now.set({ hour: 12 }))).toBe('afternoon');
    expect(greetingPart(now.set({ hour: 18, minute: 59 }))).toBe('afternoon');
    expect(greetingPart(now.set({ hour: 19 }))).toBe('evening');
    expect(greetingPart(now.set({ hour: 4 }))).toBe('evening');
  });

  it('lists exams of the next 21 days, ascending, without archived classes or past ones', () => {
    const rows = comingUp([
      data(cls('law'), { dates: [exam('freq', '2026-11-12T10:00'), exam('final', '2027-01-14T09:30'), exam('past', '2026-11-03T09:00')] }),
      data(cls('bio'), { dates: [exam('quiz1', '2026-11-05T14:00'), exam('allday', '2026-11-03T00:00', { allDay: true })] }),
      data(cls('hist', { archived: true }), { dates: [exam('old', '2026-11-04T10:00')] }),
    ], now);
    expect(rows.map((r) => r.exam.examId)).toEqual(['allday', 'quiz1', 'freq']);
    expect(rows.map((r) => r.days)).toEqual([0, 2, 9]);
    expect(daysUntil('2026-11-04T00:30', now)).toBe(1);
  });

  it('keeps at most 6 lectures of the last 14 days, newest first', () => {
    const ls = ['2026-10-01', '2026-10-20', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03'].map((d, i) => lecture(`l${i}`, `${d}T10:00:00Z`));
    expect(recentLectures([data(cls('law'), { lectures: ls })], now).map((r) => r.lecture.id)).toEqual(['l7', 'l6', 'l5', 'l4', 'l3', 'l2']);
  });

  it('finds other computers transcribing and lectures waiting, oldest first', () => {
    const t = transcriptions([
      data(cls('law'), { lectures: [
        lecture('l8', '2026-11-03T10:00:00Z', { transcription: { kind: 'claimed', by: dev(), percent: 40, etaMin: 25, quietMin: 1, health: 'healthy' } }),
        lecture('l9', '2026-11-03T11:00:00Z'),
      ] }),
      data(cls('bio'), { lectures: [lecture('b4', '2026-11-02T14:00:00Z'), lecture('b5', '2026-11-02T15:00:00Z', { audio: null })] }),
      data(cls('stats', { shared: false }), { lectures: [lecture('s1', '2026-11-01T10:00:00Z')] }),
    ]);
    expect(t.others).toEqual([expect.objectContaining({ device: "Bruno's laptop", percent: 40 })]);
    expect(t.waiting.map((w) => w.lecture.id)).toEqual(['b4', 'l9']);
  });

  it('shows the newest mention of me, else the newest message, cut to 60 characters', () => {
    const items = [
      msg('m1', 'Alguém sabe se a frequência continua no dia 10?'),
      msg('m2', '<@aaaaaaaaaaaaaaaaaaaaaaaaaa> tens os apontamentos da aula 7? Faltei à segunda parte.', { mentions: [{ memberId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Ana' }] }),
      msg('m3', 'Eu também agradecia!', { author: { ...dev(), memberName: 'Carla Mendes' } }),
    ];
    const rows = unread([data(cls('law'), { chat: { items, unread: 3, mentions: 1 } }), data(cls('bio'))], 'aaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unread: 3, mentions: 1, from: 'Bruno', excerpt: '@Ana tens os apontamentos da aula 7? Faltei à segunda parte.' });
    expect(unread([data(cls('law'), { chat: { items, unread: 1, mentions: 0 } })], 'zz')[0]).toMatchObject({ from: 'Carla', excerpt: 'Eu também agradecia!' });
    expect(excerpt('word '.repeat(15))).toBe(`${'word '.repeat(11).trim()}…`);
    expect(excerpt('a'.repeat(30) + ' ' + 'b'.repeat(40))).toHaveLength(60);
    expect(excerpt('**bold** text')).toBe('bold text');
  });

  it('ticks the checklist from data', () => {
    expect(checklist([])).toEqual({ classes: false, lecture: false, document: false, exam: false });
    expect(checklist([data(cls('a'), { documents: 1 })])).toEqual({ classes: true, lecture: false, document: true, exam: false });
  });
});
