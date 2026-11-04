// English source catalog `privacy`: UX spec §5.18 verbatim (docs/design/ux-mvp.md).
// English is the source of truth; pt/ and es/ are typed Messages['privacy'].

export const privacy = {
  title: 'What leaves this computer',
  intro: 'Tramado has no server and no account. This is everything that ever leaves your computer, and when.',
  columns: { when: 'When', what: 'What is sent', to: 'To whom' },
  rows: {
    nothing: { when: 'Nothing set up', what: 'Nothing. Tramado makes no connection of its own.', to: '—' },
    sharing: { when: 'You share or join a class', what: 'Class files, chat and your name and computer’s name, encrypted between your classmates’ computers. Your computer’s ID and IP address go to Syncthing’s discovery and relay servers, and are announced on your local network, so classmates can find you. (Settings › Sharing › Local network only turns the servers off.)', to: 'Your classmates’ computers; Syncthing’s public discovery, relay and STUN servers' },
    keyCheck: { when: 'You saved an OpenRouter key and AI is on', what: 'Your key, to check how many free requests are left (when Tramado starts, when you come back to it after a while, when you test the key), and once a day a request for the list of models. No questions or class content.', to: 'OpenRouter (USA)' },
    ai: { when: 'You ask the AI (Ask, @AI, Explain, exam answers, summaries)', what: 'Your question and the passages it needs (with their file names and timestamps). Never whole folders, private notes (unless you include My notes), chat history or other classes.', to: 'OpenRouter (USA) and the company running the model' },
    ocr: { when: 'You read a scanned exam or document with AI', what: 'The page images', to: 'OpenRouter and the model’s provider' },
    cloudSpeech: { when: 'You transcribe with OpenRouter', what: 'The recording, in pieces of up to 30 seconds', to: 'OpenRouter and the speech model’s provider' },
    customAi: { when: 'You use another AI service (Settings › AI › Another service)', what: 'The same as for OpenRouter above: your question and the passages it needs, page images to read, recordings to transcribe.', to: 'The address you entered (your computer, your network or your school’s server)' },
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
    clearConfirm: { title: 'Clear the AI activity log?', body: 'The list of AI requests made from this computer is removed. Nothing else changes: your answers, notes and classes stay.' },
    cleared: 'The AI activity log is empty.',
  },
  where: { title: 'Where your data is', classes: 'Open the classes folder', private: 'Open the private data folder', models: 'Open the models folder', cache: 'Open the cache folder' },
  whereBody: 'Your classes are ordinary folders where you chose to keep them (Settings › Storage). Tramado’s private data (your own notes, highlights, practice and the AI activity log), the speech models and the cache are in its own folders on this computer and are never shared.',
};
