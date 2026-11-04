// Class `bio`: "Biology 101" (en, shared with Jamie; UX §7.3). Fictional people, readings and lectures.
import { B3_KEY } from './content/transcripts';
import type { DemoClass } from './types';

const GEMMA = 'google/gemma-4-31b-it:free';

export const BIO: DemoClass = {
  key: 'bio',
  name: 'Biology 101',
  shortName: 'BIO 101',
  colour: '#30a46c',
  icon: 'dna',
  lecturer: 'Dr. Sam Okafor',
  term: 'Fall 2026',
  language: 'en',
  shared: true,
  archived: false,
  createdAt: '2026-09-23T17:30',
  members: [{ key: 'jamie', device: 0, joinedAt: '2026-09-24T10:12' }],
  organisers: ['ana'],
  consents: [
    { by: 'ana', at: '2026-10-29T13:58' },
    { by: 'jamie', at: '2026-11-02T13:56' },
  ],
  documents: [
    { key: 'primer', path: 'Readings/Cell Biology Primer (fictional).pdf', asset: 'primer.pdf', mime: 'application/pdf', addedBy: 'ana', addedAt: '2026-09-28T19:45', pages: 12 },
    { key: 'slides3', path: 'Slides/Lecture 3 — Membranes.pptx', asset: 'slides3.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', addedBy: 'jamie', addedAt: '2026-10-29T17:02', pages: null },
    { key: 'lab2', path: 'Lab/Lab 2 — Osmosis worksheet.docx', asset: 'lab2.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', addedBy: 'jamie', addedAt: '2026-10-30T09:20', pages: null },
    { key: 'cell', path: 'Images/Plant cell diagram.png', asset: 'cell.png', mime: 'image/png', addedBy: 'ana', addedAt: '2026-10-31T16:05', pages: null },
  ],
  lectures: [
    {
      key: 'b3', title: 'Lecture 3 — Cell membranes', startedAt: '2026-10-29T14:00', durationMs: 3_120_000, mode: 'online', language: 'en',
      recordedBy: 'ana', speakers: [{ id: 'me', label: 'Me' }, { id: 'class', label: 'Class' }],
      channels: [{ index: 0, speaker: 'me' }, { index: 1, speaker: 'class' }],
      transcript: { by: 'ana', device: 0, model: 'turbo', at: '2026-10-29T15:21', revision: 1, keySegments: B3_KEY, filler: { lang: 'en', speaker: 'class', seed: 3 } },
      claim: { by: 'ana', device: 0, status: 'done', heartbeat: 18 },
      markers: [
        { at: '0:07:15', kind: 'important' },
        { at: '0:18:40', kind: 'exam' },
      ],
    },
    {
      key: 'b4', title: 'Lecture 4 — Osmosis and diffusion', startedAt: '2026-11-02T14:00', durationMs: 2_880_000, mode: 'room', language: 'en',
      recordedBy: 'jamie', speakers: [{ id: 'lecture', label: 'Lecturer' }], channels: [{ index: 0, speaker: 'lecture' }],
      transcript: null, claim: null, markers: [],
    },
  ],
  exams: [
    { key: 'quiz1', title: 'Quiz 1', type: 'quiz', status: 'upcoming', date: '2026-11-05T14:00', durationMin: 30, room: 'Lab B', coversText: 'Lectures 1–4', importedBy: 'ana', createdAt: '2026-10-21T18:10', questions: [] },
    {
      key: 'pquiz', title: 'Practice quiz — Membranes', type: 'practice', status: 'paper', date: '2026-10-30T09:00', scale: { max: 10, unit: 'points' },
      importedBy: 'ana', createdAt: '2026-10-30T19:30', extraction: { method: 'typed', at: '2026-10-30T19:30', reviewedAt: '2026-10-30T19:36' },
      questions: [
        {
          key: '1', id: 'q_pq1000', number: '1', parent: null, group: null, kind: 'multiple_choice', points: 1,
          text: 'Which molecules cross the lipid bilayer most easily?',
          options: [{ key: 'a', text: 'glucose' }, { key: 'b', text: 'oxygen' }, { key: 'c', text: 'sodium ions' }, { key: 'd', text: 'proteins' }],
          answer: {
            by: 'ana', at: '2026-10-30T19:40', model: GEMMA, requestedModel: GEMMA, scope: 'materials', choice: 'b',
            text: '(b) oxygen: small non-polar molecules diffuse directly across the bilayer [S1] [S2].',
            citations: [
              { ref: 'S1', source: { kind: 'document', doc: 'primer', locator: { type: 'page', page: 4 } }, quote: 'Small non-polar molecules such as oxygen and carbon dioxide diffuse directly across the lipid bilayer' },
              { ref: 'S2', source: { kind: 'lecture', lecture: 'b3', segment: 's_b3b00' }, quote: 'small non-polar molecules cross the bilayer easily' },
            ],
          },
          mine: { inPractice: true },
        },
        { key: '2', id: 'q_pq2000', number: '2', parent: null, group: null, kind: 'short', points: 2, text: 'What does “fluid mosaic” mean?', mine: { inPractice: true } },
        {
          key: '3', id: 'q_pq3000', number: '3', parent: null, group: null, kind: 'short', points: 2, text: 'What happens to a red blood cell placed in a hypotonic solution?',
          answer: {
            by: 'ana', at: '2026-10-30T19:41', model: GEMMA, requestedModel: GEMMA, scope: 'materials',
            text: 'Water moves into the cell by osmosis, so it swells and may burst [S1].',
            citations: [{ ref: 'S1', source: { kind: 'document', doc: 'primer', locator: { type: 'page', page: 7 } }, quote: 'water moves into the cell by osmosis and the cell swells' }],
          },
          mine: { inPractice: true },
        },
        { key: '4', id: 'q_pq4000', number: '4', parent: null, group: null, kind: 'essay', points: 5, text: 'Compare passive and active transport across the membrane.' },
      ],
    },
  ],
  chat: [
    { n: 1, at: '2026-11-02T16:00', by: 'jamie', kind: 'message', text: 'Is the quiz open book?' },
    { n: 2, at: '2026-11-02T16:05', by: 'ana', kind: 'message', text: 'No, closed book.' },
    { n: 3, at: '2026-11-02T16:06', by: 'jamie', kind: 'message', text: 'Thanks!' },
  ],
  readUpTo: 3,
  notes: [],
  ask: [],
};
