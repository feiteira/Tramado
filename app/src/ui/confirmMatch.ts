/**
 * Whether what was typed into a "type the name to confirm" box matches. Spacing at the ends and
 * runs of spaces do not count, nor do Unicode composition differences (a name typed on another
 * keyboard layout); letter case does, so it is a deliberate act.
 */
export function typedMatches(typed: string, expected: string): boolean {
  const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
  const want = norm(expected);
  return want.length > 0 && norm(typed) === want;
}
