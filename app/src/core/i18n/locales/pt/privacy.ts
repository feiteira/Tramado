// Portuguese (Portugal): NOT TRANSLATED YET — a copy of the English catalog (architecture §14).
// The namespace owner translates it and removes `pending`; catalogs.test.ts skips the
// "identical to English" check while `pending` is exported, and fails with TRAMADO_RELEASE=1.
import type { Messages } from '../en';

export const pending = true;

export const privacy: Messages['privacy'] = {
  title: 'What leaves this computer',
  intro: 'Tramado has no server and no account. This is everything that ever leaves your computer, and when.',
  columns: { when: 'When', what: 'What is sent', to: 'To whom' },
  rows: {
    nothing: { when: 'Nothing set up', what: 'Nothing. Tramado makes no connection of its own.', to: '—' },
    sharing: { when: 'You share or join a class', what: 'Class files, chat and your name and computer’s name, encrypted between your classmates’ computers. Your computer’s ID and IP address go to Syncthing’s discovery and relay servers so classmates can find you.', to: 'Your classmates’ computers; Syncthing’s public discovery and relay servers' },
    ai: { when: 'You ask the AI (Ask, @AI, Explain, exam answers, summaries)', what: 'Your question and the passages it needs (with their file names and timestamps). Never whole folders, private notes (unless you include My notes), chat history or other classes.', to: 'OpenRouter (USA) and the company running the model' },
    ocr: { when: 'You read a scanned exam or document with AI', what: 'The page images', to: 'OpenRouter and the model’s provider' },
    cloudSpeech: { when: 'You transcribe with OpenRouter', what: 'The recording, in pieces of up to 30 seconds', to: 'OpenRouter and the speech model’s provider' },
    model: { when: 'You download a speech model', what: 'A download request', to: 'Hugging Face' },
    never: { when: 'Never', what: 'No account, no telemetry, no analytics, no crash reports. Syncthing’s usage reporting is off.', to: '—' },
  },
  log: {
    title: 'AI activity on this computer',
    intro: 'A private list of AI requests made from this computer. It is never sent anywhere.',
    columns: { time: 'Time', class: 'Class', action: 'Action', model: 'Model', passages: 'Passages sent', requests: 'Requests' },
    actions: { ask: 'Ask', chat: '@AI in chat', explain: 'Explain', summary: 'Summary', terms: 'Key terms', annotate: 'Annotate transcript', studyNotes: 'Study notes', examExtract: 'Exam: find questions', examOcr: 'Exam: read pages', examAnswer: 'Exam: answer', hint: 'Hint', deep: 'Deep answer', title: 'Lecture title', describe: 'Describe image', docOcr: 'Read a scan', cloudSpeech: 'Cloud transcription', keyCheck: 'Key check', catalog: 'Model list' },
    clear: 'Clear the log',
    empty: 'No AI requests yet.',
  },
  where: { title: 'Where your data is', classes: 'Open the classes folder', private: 'Open the private data folder', models: 'Open the models folder', cache: 'Open the cache folder' },
};
