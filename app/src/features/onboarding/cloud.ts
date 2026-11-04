// Onboarding helpers (UX §3.1) that need no DOM: the cloud-synced folder check (G15) and the default
// computer name.

const CLOUD: ReadonlyArray<[RegExp, string]> = [
  [/(^|[\\/])OneDrive( - [^\\/]+)?([\\/]|$)/i, 'OneDrive'],
  [/(^|[\\/])Dropbox( \([^\\/]+\))?([\\/]|$)/i, 'Dropbox'],
  [/(^|[\\/])iCloud Drive([\\/]|$)/i, 'iCloud Drive'],
  [/(^|[\\/])Mobile Documents([\\/]|$)/i, 'iCloud Drive'],
  [/(^|[\\/])Google Drive([\\/]|$)/i, 'Google Drive'],
  [/(^|[\\/])GoogleDrive-[^\\/]+([\\/]|$)/i, 'Google Drive'],
];

/** The cloud sync service whose folder holds `path` (OneDrive, Dropbox, iCloud Drive, Google Drive), or null. */
export function cloudServiceOf(path: string): string | null {
  for (const [re, name] of CLOUD) if (re.test(path)) return name;
  return null;
}

/** The first word of a name ("Ana Ribeiro" → "Ana"); the whole trimmed name when it has one word. */
export function firstName(name: string): string {
  const t = name.trim();
  return t.split(/\s+/)[0] ?? t;
}

/** Initials for an avatar: the first letters of the first and last word (UX §2.11 Avatar). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? [...(words[words.length - 1] ?? '')][0] ?? '' : '';
  return (first + last).toLocaleUpperCase();
}
