// Spanish (Spain): NOT TRANSLATED YET — a copy of the English catalog (architecture §14).
// The namespace owner translates it and removes `pending`; catalogs.test.ts skips the
// "identical to English" check while `pending` is exported, and fails with TRAMADO_RELEASE=1.
import type { Messages } from '../en';

export const pending = true;

export const speech: Messages['speech'] = {
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
  },
  left: {
    underMinute: 'less than a minute left',
    minutes: { one: 'about {n} minute left', other: 'about {n} minutes left' },
    hours: 'about {h} h {m} min left',
  },
};
