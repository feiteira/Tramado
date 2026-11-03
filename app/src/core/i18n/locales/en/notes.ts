// English source catalog `notes`: UX spec §5.10 verbatim (docs/design/ux-mvp.md).
// English is the source of truth; pt/ and es/ are typed Messages['notes'].

export const notes = {
  new: 'New note',
  newClass: 'New class note',
  filter: 'Filter notes',
  mine: 'My notes · only you',
  class: 'Class notes · shared with the class',
  edited: 'edited {when}',
  editing: '{name} is editing',
  status: { saving: 'Saving…', saved: 'Saved', failed: 'Couldn’t save: {reason}' },
  subtitleMine: 'Only you',
  subtitleClass: { one: 'Shared with the class · {n} member', other: 'Shared with the class · {n} members' },
  toolbar: {
    label: 'Formatting',
    bold: 'Bold', italic: 'Italic', heading: 'Heading', bullets: 'Bulleted list', checklist: 'Checklist', link: 'Link',
    insertTime: 'Insert a link to a lecture moment', insertDoc: 'Insert a link to a document page', preview: 'Preview',
  },
  insertTime: { title: 'Link to a lecture moment', lecture: 'Lecture', time: 'Time' },
  insertDoc: { title: 'Link to a document', document: 'Document', page: 'Page' },
  more: { toClass: 'Move to class notes…', toMine: 'Make private…', delete: 'Delete…', showInFolder: 'Show in folder' },
  toClass: { title: 'Share this note with everyone in {class}?', body: 'Classmates can read and edit it.', confirm: 'Share it' },
  toMine: { title: 'Move this note out of the class?', body: 'It’s removed for everyone else in {class}.', confirm: 'Make private' },
  deleteConfirm: { title: 'Delete “{title}”?', bodyMine: 'This can’t be undone.', bodyClass: 'It’s deleted for everyone in {class}. You can restore it for 30 days from Recently deleted.' },
  presence: '{name} is editing this note. Changes you both make at the same time may conflict.',
  conflict: {
    notice: 'Two versions of “{title}” were edited at the same time. Both are kept.',
    compare: 'Compare',
    title: 'Two versions of “{title}”',
    mine: 'This computer’s version',
    theirs: '{name}’s version',
    theirsUnknown: 'The other version',
    keepMine: 'Keep this one',
    keepTheirs: 'Keep the other',
    keepBoth: 'Keep both',
    copyName: '{title} ({name}’s copy)',
  },
  empty: {
    title: 'Your notes for {class}.',
    body: 'My notes are only on this computer. Class notes are shared with everyone in the class.',
  },
  lectureNoteTitle: 'Notes — {lecture}',
};
