// File names that cannot be saved on Windows computers (UX §3.15.9, sync spec §22.4): reserved characters, reserved
// device names, a trailing dot or space, and names that differ only by case from a sibling (case-insensitive file
// systems). Pure; used by the Windows file-name notice wherever a class's files are listed.
const RESERVED_CHARS = /[<>:"\\|?*\u0000-\u001f]/;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;

/** Why one path segment can't be saved on Windows, or null. */
export function windowsProblem(segment: string): 'chars' | 'reserved' | 'trailing' | null {
  if (RESERVED_CHARS.test(segment)) return 'chars';
  if (RESERVED_NAMES.test(segment)) return 'reserved';
  if (/[. ]$/.test(segment)) return 'trailing';
  return null;
}

/** The paths (class-relative, "/"-separated) that can't be saved on Windows computers, in input order. */
export function windowsNameProblems(paths: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const p of paths) {
    const segs = p.split('/');
    if (segs.some((s) => windowsProblem(s) !== null)) {
      out.push(p);
      continue;
    }
    const folded = p.normalize('NFC').toLowerCase();
    const other = seen.get(folded);
    if (other !== undefined && other !== p) out.push(p);
    else seen.set(folded, p);
  }
  return out;
}
