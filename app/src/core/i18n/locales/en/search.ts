// English source catalog `search`: UX spec §5.16 verbatim (docs/design/ux-mvp.md).
// English is the source of truth; pt/ and es/ are typed Messages['search'].

export const search = {
  placeholder: 'Search your classes, or type a command…',
  label: 'Search and commands',
  scopeClass: 'In {class}',
  scopeAll: 'All classes',
  includeArchived: 'Include archived classes',
  groups: { lectures: 'Lectures', documents: 'Documents', notes: 'Notes', exams: 'Exams', chat: 'Chat', commands: 'Commands', recent: 'Recent', recentSearches: 'Recent searches' },
  showAll: 'Show all {n}',
  askAi: 'Ask AI: “{q}” in {scope}',
  askAiAll: 'Ask AI: “{q}” in all classes',
  askAiOff: 'Ask AI (set up AI first)',
  indexing: { one: 'Still reading {n} file; results may be incomplete.', other: 'Still reading {n} files; results may be incomplete.' },
  none: { title: 'Nothing found for “{q}”.', body: 'Try fewer words, or search all classes.', all: 'Search all classes', ask: 'Ask AI' },
  result: '{kind}: {title}, {where}. {snippet}',
  kinds: { lecture: 'Lecture', document: 'Document', note: 'Note', exam: 'Exam question', chat: 'Message', command: 'Command' },
  chatWhere: '{name}, {date}',
};
