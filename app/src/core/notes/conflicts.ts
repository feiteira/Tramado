// Class-note conflict copies (folder spec §8.21, sync spec §16): Syncthing keeps the other version
// as `<base>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<ShortId>.<ext>` next to the note. Copies are grouped
// per note; the ShortId is NOT the author of the losing text (§16.4), so nothing here names one.
// "Keep both" renames a copy to `<base> (2).md` (sanitised, unique among the siblings).
import { parseConflictName } from '../model/paths';
import { sanitize, unique } from '../model/sanitize';

export interface ConflictCopy { path: string; date: string; time: string }

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** The note a conflict copy belongs to, or null when the path is not a conflict copy. */
export function conflictOriginal(path: string): string | null {
  const c = parseConflictName(nameOf(path));
  return c ? join(dirOf(path), c.original) : null;
}

/** Conflict copies grouped by the note they belong to (oldest copy first). */
export function groupConflicts(paths: Iterable<string>): Map<string, ConflictCopy[]> {
  const out = new Map<string, ConflictCopy[]>();
  for (const p of paths) {
    const c = parseConflictName(nameOf(p));
    if (!c) continue;
    const of = join(dirOf(p), c.original);
    const list = out.get(of) ?? [];
    list.push({ path: p, date: c.date, time: c.time });
    out.set(of, list);
  }
  for (const list of out.values()) list.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`) || a.path.localeCompare(b.path));
  return out;
}

/**
 * Where a kept conflict copy goes: `<base> (2).<ext>` next to the note, sanitised and unique among
 * `siblings` (the names in that directory).
 */
export function keepBothPath(notePath: string, siblings: Iterable<string>): string {
  const name = nameOf(notePath);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '.md';
  // `unique` inserts " (2)", " (3)", … before the extension: the note itself is taken, so the copy
  // gets the first free number from 2.
  const taken = [...siblings, name];
  return join(dirOf(notePath), unique(taken, sanitize(`${base}${ext}`, `Note${ext}`)));
}

/** The title of a note: its first `# ` heading, else the file name without `.md`. */
export function noteTitle(path: string, text: string | null): string {
  if (text) {
    for (const line of text.split('\n', 200)) {
      const m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) return m[1]!;
    }
  }
  return nameOf(path).replace(/\.md$/i, '');
}
