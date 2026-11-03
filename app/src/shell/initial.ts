/**
 * The first character of a name, for a project's or coder's mark: a whole grapheme (an accented
 * letter typed as two code points, an emoji), upper-cased. Empty for a blank name.
 */
export function initial(name: string): string {
  const s = name.trim().normalize('NFC');
  if (!s) return '';
  let first: string | undefined;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next().value?.segment;
  }
  first ??= [...s][0];
  return (first ?? '').toLocaleUpperCase();
}
