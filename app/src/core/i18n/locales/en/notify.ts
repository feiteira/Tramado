// English source catalog `notify`: UX spec §5.22 verbatim (docs/design/ux-mvp.md).
// English is the source of truth; pt/ and es/ are typed Messages['notify'].

export const notify = {
  mention: '{name} mentioned you in {class}',
  everyone: '{name} to everyone in {class}',
  pin: '{name} pinned a message in {class}',                       // v1.1
  examAdded: 'New exam date in {class}: {title}, {date}',
  examChanged: 'Exam date changed: {title} is now {date}',
  examSoon: '{title} in {class} is {when}',
  transcriptReady: 'The transcript of “{lecture}” is ready',
  transcriptFailed: 'Transcribing “{lecture}” failed on {device}',
  transcriptNobody: 'Nobody has transcribed “{lecture}” yet.',
  joined: '{name} joined {class}',
  wantsToJoin: '{name} wants to join {class}',
  recordingInterrupted: 'A recording of {class} was interrupted',
  modelReady: 'The speech model is ready',
  volunteerOn: 'This computer will help transcribe your classes’ lectures when it’s plugged in.',
  massDelete: '{name}’s computer deleted {n} files from {class}',
  folderMissing: 'Tramado can’t find the folder for {class}',
  backgroundRecording: 'Still recording {class} in the background.',
};
