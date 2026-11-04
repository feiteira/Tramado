// English source catalog `chat`: UX spec §5.12 verbatim (docs/design/ux-mvp.md).
// English is the source of truth; pt/ and es/ are typed Messages['chat'].

export const chat = {
  label: 'Class chat',
  placeholder: 'Message {class}…',
  send: 'Send',
  attach: 'Attach a file',
  attachNotice: 'Files you send in chat are also kept in Documents, so they don’t get lost.',
  replyingTo: 'Replying to {name}: “{excerpt}”',
  cancelReply: 'Cancel reply',
  loadingEarlier: 'Loading earlier messages…',
  edited: '(edited)',
  deleted: 'Message deleted',
  hidden: 'Hidden by an organiser',
  showHidden: 'Show',
  pending: 'Saved — will send when a classmate is online',
  sent: 'Sent',
  sentTooltip: 'At least one classmate’s computer has it.',
  actions: { label: 'Message actions', reply: 'Reply', pin: 'Pin for the class', unpin: 'Unpin', copy: 'Copy text', edit: 'Edit', delete: 'Delete', hide: 'Hide for everyone', unhide: 'Show for everyone' },
  deleteConfirm: { title: 'Delete this message for everyone?', confirm: 'Delete' },
  hideConfirm: { title: 'Hide this message for everyone?', body: 'Organisers can still see it.', confirm: 'Hide' },
  pins: { all: 'All pins', none: 'No pinned messages.' },
  mention: { label: 'Mention', ai: 'AI', aiHint: 'Ask Tramado AI with your key', everyone: 'everyone', everyoneHint: 'Notify everyone in the class' },
  ai: {
    author: 'Tramado AI',
    header: 'asked by {name} · {model}',
    working: 'Looking through {lectures} and {documents}…',
    noKey: 'To ask @AI, set up AI in Settings. Classmates’ keys are never shared.',
    off: 'AI is off on this computer.',
    setUp: 'Set up AI',
    askedBy: 'asked by {name}',                                   // G2 (UI-GROUP): the AiCard header part
    failed: 'Tramado AI couldn’t answer this time.',
  },
  examChip: 'Add to Exams: {kind} on {date}?',
  system: {
    thanks: '{a} thanked {b} for transcribing {lecture}.',
    thanksYou: '{a} thanked you for transcribing {lecture}.',                // G2 (UI-GROUP)
    joined: '{name} joined the class.',
    left: '{name} left the class.',
    pinned: '{name} pinned a message.',
    examAdded: '{name} added {title} on {date}.',
  },
  empty: {
    aloneTitle: 'Just you so far.',
    aloneBody: 'Invite classmates to chat, share documents and split the transcription work.',
    invite: 'Invite classmates',
    quiet: 'No messages yet. Say hello to the class.',
  },
  find: 'Find in chat',
  newMessage: '{name}: {text}',
  // ── G2 (UI-GROUP) ──
  loadEarlier: 'Show earlier messages',
  findCount: '{n} of {total}',
  unverifiedAuthor: 'Unverified ({device})',
  newerLines: {
    one: '{n} message was written with a newer Tramado. Update Tramado to see it.',
    other: '{n} messages were written with a newer Tramado. Update Tramado to see them.',
  },
  aLecture: 'a lecture',
  editHint: 'Enter saves · Esc cancels',
  attachmentMeta: '{size} · in {folder}',
  link: { title: 'Open this link?', body: 'It opens {host} in your browser.', open: 'Open link' },
};
