// English source catalog `common`: UX spec §5.1 verbatim (docs/design/ux-mvp.md).
// English is the source of truth; pt/ and es/ are typed Messages['common'].

export const common = {
  appName: 'Tramado',
  ok: 'OK', cancel: 'Cancel', save: 'Save', close: 'Close', delete: 'Delete', remove: 'Remove', rename: 'Rename',
  edit: 'Edit', add: 'Add', create: 'Create', back: 'Back', next: 'Next', continue: 'Continue', done: 'Done',
  skip: 'Skip', change: 'Change', undo: 'Undo', redo: 'Redo', search: 'Search', filter: 'Filter', clear: 'Clear',
  copy: 'Copy', copied: 'Copied', open: 'Open', more: 'More', none: 'None', all: 'All', yes: 'Yes', no: 'No',
  tryAgain: 'Try again', retrying: 'Retrying…', loading: 'Loading…', working: 'Working…', saving: 'Saving…', saved: 'Saved',
  untitled: 'Untitled', optional: 'optional', you: 'you', youObject: 'you', youSuffix: '{name} (you)', show: 'Show', hide: 'Hide',
  dismiss: 'Dismiss', showInFolder: 'Show in folder', openWithSystem: 'Open with the system app', paste: 'Paste',
  chooseFile: 'Choose a file…', chooseFolder: 'Choose a folder…', learnMore: 'Why this matters',
  onlyYou: 'Only you', sharedWithClass: 'Shared with the class', onlyThisComputer: 'Only on this computer',
  arriving: 'Arriving…', arrivingPercent: 'Arriving… {percent} %',
  unknownError: 'Something went wrong: {message}',
  size: { b: '{n} B', kb: '{n} KB', mb: '{n} MB', gb: '{n} GB' },
  duration: { hm: '{h} h {m} min', m: '{m} min', s: '{s} s' },
  count: {
    files: { one: '{n} file', other: '{n} files' },
    pages: { one: '{n} page', other: '{n} pages' },
    slides: { one: '{n} slide', other: '{n} slides' },
    members: { one: '{n} member', other: '{n} members' },
    requests: { one: '{n} request', other: '{n} requests' },
    questions: { one: '{n} question', other: '{n} questions' },
    lectures: { one: '{n} lecture', other: '{n} lectures' },
    documents: { one: '{n} document', other: '{n} documents' },
  },
  relative: {
    today: 'today', tomorrow: 'tomorrow', yesterday: 'yesterday',
    inDays: { one: 'in {n} day', other: 'in {n} days' },
    daysAgo: { one: '{n} day ago', other: '{n} days ago' },
    minAgo: { one: '{n} min ago', other: '{n} min ago' },
  },
};
