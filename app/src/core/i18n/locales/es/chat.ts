// Spanish (Spain): NOT TRANSLATED YET — a copy of the English catalog (architecture §14).
// The namespace owner translates it and removes `pending`; catalogs.test.ts skips the
// "identical to English" check while `pending` is exported, and fails with TRAMADO_RELEASE=1.
import type { Messages } from '../en';

export const pending = true;

export const chat: Messages['chat'] = {
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
  },
  examChip: 'Add to Exams: {kind} on {date}?',
  system: {
    thanks: '{a} thanked {b} for transcribing {lecture}.',
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
};
