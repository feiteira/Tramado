// Portuguese (Portugal): NOT TRANSLATED YET — a copy of the English catalog (architecture §14).
// The namespace owner translates it and removes `pending`; catalogs.test.ts skips the
// "identical to English" check while `pending` is exported, and fails with TRAMADO_RELEASE=1.
import type { Messages } from '../en';

export const pending = true;

export const search: Messages['search'] = {
  placeholder: 'Search your classes, or type a command…',
  label: 'Search and commands',
  scopeClass: 'In {class}',
  scopeAll: 'All classes',
  includeArchived: 'Include archived classes',
  groups: { lectures: 'Lectures', documents: 'Documents', notes: 'Notes', exams: 'Exams', chat: 'Chat', commands: 'Commands', recent: 'Recent', recentSearches: 'Recent searches' },
  showAll: 'Show all {n}',
  askAi: 'Ask AI: “{q}” in {scope}',
  askAiOff: 'Ask AI (set up AI first)',
  indexing: { one: 'Still reading {n} file; results may be incomplete.', other: 'Still reading {n} files; results may be incomplete.' },
  none: { title: 'Nothing found for “{q}”.', body: 'Try fewer words, or search all classes.', all: 'Search all classes', ask: 'Ask AI' },
  result: '{kind}: {title}, {where}. {snippet}',
  kinds: { lecture: 'Lecture', document: 'Document', note: 'Note', exam: 'Exam question', chat: 'Message', command: 'Command' },
  chatWhere: '{name}, {date}',
};
