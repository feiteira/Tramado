// Names Tramado creates or imports (folder spec §5.4), so a class syncs between Windows, macOS and
// Linux members without errors.

const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;

function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Seg) return Array.from(s);
  return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
}

/** Cuts `s` to at most `max` UTF-8 bytes on a grapheme boundary. */
function cutBytes(s: string, max: number): string {
  if (bytes(s) <= max) return s;
  let out = '';
  for (const g of graphemes(s)) {
    if (bytes(out + g) > max) break;
    out += g;
  }
  return out;
}

/** Splits "name.ext" at the last dot (no extension for ".hidden" or "name."). */
function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

/** `sanitize(name, fallback)` of folder spec §5.4, steps 1–9. */
export function sanitize(name: string, fallback: string): string {
  let s = name.normalize('NFC');                                         // 1
  s = s.replace(FORBIDDEN, '-');                                         // 2
  s = s.replace(/[\s\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g, ' ');                       // 3 (Unicode White_Space)
  s = s.trim().replace(/[. ]+$/, '');                                    // 4
  if (s.startsWith('.')) s = '_' + s.slice(1);                           // 5
  {
    const dot = s.indexOf('.');                                          // 6
    const base = dot < 0 ? s : s.slice(0, dot);
    if (RESERVED.test(base)) s = base + '_' + (dot < 0 ? '' : s.slice(dot));
  }
  {
    const lower = s.toLowerCase();                                       // 7
    const misread =
      /\.(tmp|part|crdownload)$/.test(lower) ||
      s.startsWith('~$') || s.startsWith('.~lock.') || s.startsWith('.syncthing.') || s.startsWith('~syncthing~') ||
      lower.includes('.sync-conflict-');
    if (misread) {
      const [b, e] = splitExt(s);
      s = e ? `${b}_${e}` : `${s}_`;
    }
  }
  if (bytes(s) > 120) {                                                  // 8
    const [b, e] = splitExt(s);
    const ext = e && bytes(e) <= 16 ? e : '';
    const base = ext ? b : s;
    s = cutBytes(base, 120 - bytes(ext)).replace(/[. ]+$/, '') + ext;
  }
  return s === '' ? fallback : s;                                        // 9
}

const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFC');

/** `unique(dir, name)`: inserts " (2)", " (3)", … before the extension until no sibling matches (NFC + case fold). */
export function unique(siblings: Iterable<string>, name: string): string {
  const taken = new Set(Array.from(siblings, fold));
  if (!taken.has(fold(name))) return name;
  const [b, e] = splitExt(name);
  for (let n = 2; ; n++) {
    const candidate = `${b} (${n})${e}`;
    if (!taken.has(fold(candidate))) return candidate;
  }
}

/** "YYYY-MM-DD HHmm" of an instant in an IANA time zone (the recorder's local time). */
export function localStamp(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}${get('minute')}`;
}

/** A lecture directory name: `<YYYY-MM-DD HHmm> <sanitised title>` (folder spec §5.2). */
export function lectureDirName(startedAtMs: number, title: string, tz: string, fallback = 'Untitled'): string {
  return `${localStamp(startedAtMs, tz)} ${sanitize(title, fallback)}`;
}

/**
 * `dir/name` within 200 UTF-16 units: shortens the name (keeping its extension) when the whole path
 * would be too long. Returns null when even a one-character name does not fit.
 */
export function fitClassPath(dir: string, name: string, max = 200): string | null {
  const prefix = dir ? `${dir}/` : '';
  if ((prefix + name).length <= max) return prefix + name;
  const [b, e] = splitExt(name);
  const room = max - prefix.length - e.length;
  if (room < 1) return null;
  let cut = '';
  for (const g of graphemes(b)) {
    if ((cut + g).length > room) break;
    cut += g;
  }
  cut = cut.replace(/[. ]+$/, '');
  return cut ? prefix + cut + e : null;
}
