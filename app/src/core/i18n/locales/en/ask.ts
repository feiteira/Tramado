// English source catalog `ask`: UX spec §5.13 verbatim (docs/design/ux-mvp.md).
// English is the source of truth; pt/ and es/ are typed Messages['ask'].

export const ask = {
  threads: 'Conversations',
  new: 'New',
  renameThread: 'Rename', deleteThread: 'Delete',
  deleteThreadConfirm: 'Delete this conversation? It’s only on this computer.',
  scope: { label: 'Sources', all: 'All', lectures: 'Lectures', documents: 'Documents', exams: 'Exams', mine: 'My notes', mineHint: 'Includes your private notes in what is sent to the AI.', lecture: 'This lecture: {title}', document: 'This document: {name}', allClasses: 'All classes' },
  general: 'Allow general knowledge',
  generalHint: 'Sentences not found in your materials are marked as unverified.',
  placeholder: 'Ask about {class}…',
  placeholderAll: 'Ask about all your classes…',
  you: 'You',
  // UI-EXAMS additions
  send: 'Send',
  screenTitle: 'Ask AI',
  postPrivate: 'Answers that use your private notes can’t be posted',
  postOther: 'Answers that cite more than one class can’t be posted to a class chat',
  sent: { one: 'Sent: your question and {n} passage.', other: 'Sent: your question and {n} passages.' },
  seeSent: 'See what was sent',
  post: 'Post to class chat',
  postConfirm: { title: 'Post this answer to {class} chat?', body: 'Classmates will see your question and the answer.', confirm: 'Post' },
  posted: 'Posted to {class} chat.',
  copy: 'Copy with sources',
  saveNote: 'Save as note',
  saved: 'Saved to your notes.',
  empty: {
    title: 'Ask anything about {class}.',
    titleAll: 'Ask anything about your classes.',
    summarise: 'Summarise {lecture}',
    quiz: 'Quiz me on {exam}',
    topics: 'What are the main topics so far?',
  },
  off: {
    title: 'Ask your classes with AI.',
    body: 'Set up OpenRouter with your own key (free models work), or a local AI service. Search works without AI.',
    setUp: 'Set up AI',
    search: 'Search instead',
  },
  // INT (wave 3)
  threadsShow: 'Show conversations',
  threadsHide: 'Hide conversations',
};
