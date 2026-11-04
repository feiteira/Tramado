// Class `solo` (INT, wave 3): "Direito Fiscal", shared but nobody else has joined yet — the chat's and the members'
// "Just you so far" states (UX §3.10.2, §3.12.1). Seeded only with `class=solo` (UX §7.2), so the other screens keep
// their four classes. Fictional, like every fixture.
import type { DemoClass } from './types';

export const SOLO: DemoClass = {
  key: 'solo',
  name: 'Direito Fiscal',
  shortName: 'DF',
  colour: '#8e4ec6',
  icon: 'gavel',
  lecturer: 'Prof. Tomás Vieira',
  term: '2026/27 · 1.º semestre',
  language: 'pt-PT',
  shared: true,
  archived: false,
  createdAt: '2026-11-02T09:00',
  members: [],
  organisers: ['ana'],
  consents: [],
  documents: [],
  lectures: [],
  exams: [],
  chat: [],
  readUpTo: null,
  notes: [],
  ask: [],
};
