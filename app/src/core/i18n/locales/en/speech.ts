// English source catalog `speech`: UX spec §5.19 verbatim (docs/design/ux-mvp.md), plus the keys UI-LECTURES added in
// wave 2 (marked "UI-LECTURES").
// English is the source of truth; pt/ and es/ are typed Messages['speech'].

export const speech = {
  models: {
    turbo: 'Recommended', turboHint: '{size} · good accuracy, about {speed}× faster than real time here',
    turboHintUnknown: '{size} · good accuracy',
    small: 'Draft', smallHint: '{size} · faster, but rough on Portuguese and Spanish',
    'large-v3': 'Most accurate', 'large-v3Hint': '{size} · slower',
  },
  state: {
    absent: 'Not downloaded',
    partial: '{done} of {total} (paused)',
    downloading: '{done} of {total} · {speed}/s · {left}',
    verifying: 'Checking the download…',
    ready: 'Installed',
    failed: 'The speech model didn’t download correctly. Nothing was installed.',
  },
  actions: { download: 'Download', pause: 'Pause', resume: 'Resume', delete: 'Delete', remove: 'Remove', tryAgain: 'Try again', use: 'Use this one' },
  removeConfirm: { title: 'Remove the {model} speech model?', body: 'It frees {size}. You can download it again later.', confirm: 'Remove' },
  dock: 'Downloading the speech model · {done} of {total} · {left}',
  ready: 'The speech model is ready.',
  prompt: {
    title: 'Transcribing on this computer needs a speech model',
    body: 'It downloads once (from Hugging Face), then works offline. It’s saved in Tramado’s own folder, not in your classes.',
    estimate: 'about {time} for this lecture',
    free: 'Free space: {size}',
    download: 'Download and transcribe',
    classmate: 'Let a classmate do it',
    classmateDone: 'Classmates who help with transcription will see it.',
    cloud: 'Use OpenRouter instead',
    cloudOff: 'Use OpenRouter (turn on in Settings)',
    noDisk: 'The speech model needs {size} free. You have {free}.',
    useDraft: 'Use the Draft model ({size})',
    openStorage: 'Open Storage settings',
    // UI-LECTURES
    choose: 'Speech model',
    turboHint: 'good accuracy',
    smallHint: 'faster, but rough on Portuguese and Spanish',
    largeHint: 'slower',
    noDiskUnknown: 'The speech model needs {size} free, and this disk has less.',
    cpu: 'This computer’s processor can’t run the speech model (it needs AVX2, found in processors since about 2013). A classmate’s computer or OpenRouter can transcribe it instead.',
  },
  // UI-LECTURES
  unavailable: 'Speech models need the Tramado app on your computer.',
  volunteerNeedsModel: 'This starts once a speech model is installed.',
  turnOff: 'Turn off',
  shortcutTaken: 'Another app uses {keys}.',
  left: {
    underMinute: 'less than a minute left',
    minutes: { one: 'about {n} minute left', other: 'about {n} minutes left' },
    hours: 'about {h} h {m} min left',
  },
};
