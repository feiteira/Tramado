// Class `stats`: "Estadística I" (es-ES, only on this computer; UX §7.3). No lectures (the Lectures empty state);
// the Share tab replaces Chat and Members.
import type { DemoClass } from './types';

export const STATS: DemoClass = {
  key: 'stats',
  name: 'Estadística I',
  shortName: 'EST I',
  colour: '#f5a524',
  icon: 'sigma',
  lecturer: null,
  term: null,
  language: 'es-ES',
  shared: false,
  archived: false,
  createdAt: '2026-09-25T11:00',
  members: [],
  organisers: ['ana'],
  consents: [],
  documents: [
    { key: 'apuntes', path: 'Apuntes — Tema 2.pdf', asset: 'apuntes.pdf', mime: 'application/pdf', addedBy: 'ana', addedAt: '2026-10-15T20:30', pages: 3 },
  ],
  lectures: [],
  exams: [
    { key: 'parcial', title: 'Parcial', type: 'midterm', status: 'upcoming', date: '2026-11-24T09:00', importedBy: 'ana', createdAt: '2026-10-01T12:00', questions: [] },
  ],
  chat: [],
  readUpTo: null,
  notes: [],
  ask: [],
};
