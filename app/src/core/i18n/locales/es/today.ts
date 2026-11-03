// Spanish (Spain): NOT TRANSLATED YET — a copy of the English catalog (architecture §14).
// The namespace owner translates it and removes `pending`; catalogs.test.ts skips the
// "identical to English" check while `pending` is exported, and fails with TRAMADO_RELEASE=1.
import type { Messages } from '../en';

export const pending = true;

export const today: Messages['today'] = {
  title: 'Today',
  greeting: { morning: 'Good morning, {name}', afternoon: 'Good afternoon, {name}', evening: 'Good evening, {name}' },
  checklist: {
    title: 'Getting started',
    classes: 'Create or join a class',
    lecture: 'Record or add a lecture',
    document: 'Add a document',
    exam: 'Add an exam date',
    dismiss: 'Hide the checklist',
    whichClass: 'In which class?',
  },
  exams: {
    title: 'Coming up',
    today: 'Today, {time}',
    tomorrow: 'Tomorrow, {time}',
    inDays: { one: 'In {n} day · {date}', other: 'In {n} days · {date}' },
    practise: 'Practise ({n})',
  },
  transcriptions: {
    title: 'Transcriptions',
    idle: 'This computer: idle',
    local: 'This computer: {lecture} · {percent} %',
    other: '{device} · {lecture} · {percent} %',
    waiting: { one: '{n} waiting for a transcriber', other: '{n} waiting for a transcriber' },
    here: 'Transcribe it here',
  },
  lectures: { title: 'Recent lectures' },
  unread: {
    title: 'Unread',
    summary: { one: '{n} message', other: '{n} messages' },
    pins: { one: '{n} new pin', other: '{n} new pins' },
    mentions: { one: '{n} mention', other: '{n} mentions' },
  },
  empty: {
    title: 'Welcome, {name}.',
    body: 'A class holds one subject’s lectures, documents, exams and notes, and can be shared with classmates.',
    create: 'Create a class',
    join: 'Join a class',
  },
  clear: { title: 'All clear for today.', body: 'No exams in the next 3 weeks and nothing waiting.' },
};
