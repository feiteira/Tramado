import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baseName, canonicalize, decodeText, decodeTextWithInfo, docName, extensionOf, tidy, tidyPlain } from './text';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('decodeText', () => {
  it('reads UTF-8 with and without a byte-order mark', () => {
    expect(decodeText(fixture('plain-utf8.txt'))).toContain('coração, niño, señal \u{1f600}');
    const bom = decodeTextWithInfo(fixture('plain-utf8-bom-crlf.txt'));
    expect(bom.encoding).toBe('utf-8');
    expect(bom.text.startsWith('Primeira')).toBe(true);
  });

  it('reads UTF-16 LE and BE with a BOM, emoji included', () => {
    for (const f of ['plain-utf16le.txt', 'plain-utf16be.txt']) {
      const d = decodeTextWithInfo(fixture(f));
      expect(d.encoding).toBe(f.includes('le') ? 'utf-16le' : 'utf-16be');
      expect(d.text).toBe('Entrevista sobre habitação\nCanção \u{1f3b5}\n');
    }
  });

  it('recognises UTF-16 without a BOM', () => {
    const s = 'Olá, mundo. Isto é UTF-16 sem marca.';
    const le = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) le[i * 2] = s.charCodeAt(i) & 255, (le[i * 2 + 1] = s.charCodeAt(i) >> 8);
    expect(decodeTextWithInfo(le)).toEqual({ text: s, encoding: 'utf-16le' });
    const be = le.slice();
    for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1]!, be[i]!];
    expect(decodeTextWithInfo(be)).toEqual({ text: s, encoding: 'utf-16be' });
  });

  it('falls back to Windows-1252 for bytes that are not UTF-8', () => {
    const d = decodeTextWithInfo(fixture('plain-cp1252.txt'));
    expect(d.encoding).toBe('windows-1252');
    expect(d.text).toBe('Avó disse: \u{201c}não há pão\u{201d} \u{2013} España\r\n');
  });

  it('handles empty input', () => {
    expect(decodeTextWithInfo(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8' });
  });

  it('decodes 5 MB quickly', () => {
    const big = utf8('Linha de teste com acentuação e ñ.\n'.repeat(150_000));
    expect(big.length).toBeGreaterThan(5_000_000);
    let best = Infinity;
    let text = '';
    for (let k = 0; k < 3; k++) {
      // Best of three, so a busy machine does not fail the speed requirement.
      const t0 = performance.now();
      text = canonicalize(decodeText(big));
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(1000);
    expect(text.length).toBe(35 * 150_000);
  });
});

describe('canonicalize', () => {
  it('turns every line break into LF', () => {
    expect(canonicalize('a\r\nb\rc\u{85}d\u{2028}e\u{2029}f\u{b}g\u{c}h')).toBe('a\nb\nc\nd\ne\nf\ng\nh');
  });

  it('removes BOMs and control characters but keeps tabs and newlines', () => {
    expect(canonicalize('\u{feff}a\u{0}b\u{7}c\td\ne\u{7f}f\u{9f}g\u{feff}')).toBe('abc\td\nefg');
  });

  it('normalises to NFC', () => {
    const decomposed = 'ac\u{0327}a\u{0303}o'; // ç and ã written with combining marks
    expect(canonicalize(decomposed)).toBe('ação'.normalize('NFC'));
    expect(canonicalize(decomposed).length).toBe(4);
  });

  it('replaces unpaired surrogates and keeps pairs', () => {
    expect(canonicalize('a\u{d83d}b')).toBe('a\u{fffd}b');
    expect(canonicalize('a\u{de00}b')).toBe('a\u{fffd}b');
    expect(canonicalize('\u{1f600}')).toBe('\u{1f600}');
  });

  it('is idempotent', () => {
    const s = '\u{feff}Linha\r\n\u{0}com\u{2028}coisas e\u{301}stranhas';
    expect(canonicalize(canonicalize(s))).toBe(canonicalize(s));
  });
});

describe('tidy', () => {
  it('trims line ends, collapses blank runs and trims the ends', () => {
    expect(tidy('\n\na  \nb\t\n\n\n\nc\u{a0}\n\n')).toBe('a\nb\n\nc');
    expect(tidyPlain('\n a  \n\n\n b \n')).toBe(' a\n\n\n b');
  });
});

describe('names', () => {
  it('takes the file name without folders and extension', () => {
    expect(baseName('C:\\Users\\ana\\Entrevista 3.final.docx')).toBe('Entrevista 3.final');
    expect(baseName('/tmp/notas.txt')).toBe('notas');
    expect(baseName('.bashrc')).toBe('.bashrc');
    expect(baseName('sem extensão')).toBe('sem extensão');
    expect(extensionOf('a/B.DOCX')).toBe('docx');
    expect(extensionOf('README')).toBe('');
  });

  it('keeps document names to one line of at most 200 characters', () => {
    expect(docName('  a\nb  ')).toBe('a b');
    const long = docName('palavra '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith('\u{2026}')).toBe(true);
    const emoji = docName('\u{1f600}'.repeat(150));
    expect(emoji.length).toBeLessThanOrEqual(200);
    expect(canonicalize(emoji)).toBe(emoji); // no broken surrogate at the cut
  });
});

describe('long runs of whitespace', () => {
  // End-anchored patterns used to rescan a run from every position inside it: minutes for a
  // file with a long run of spaces in the middle of a line.
  const fast = (f: () => unknown) => {
    const t0 = Date.now();
    f();
    return Date.now() - t0;
  };
  const run = ' '.repeat(100_000);

  it('tidies a 100 000-space run in the middle of a line quickly', () => {
    expect(fast(() => expect(tidyPlain(`a${run}b`)).toBe(`a${run}b`))).toBeLessThan(100);
    expect(fast(() => expect(tidy(`a${run}b`)).toBe(`a${run}b`))).toBeLessThan(100);
    expect(fast(() => tidy(`a${'\u{a0}'.repeat(100_000)}b`))).toBeLessThan(100);
    expect(fast(() => expect(tidyPlain(`a${'\n'.repeat(100_000)}b`)).toBe(`a${'\n'.repeat(100_000)}b`))).toBeLessThan(100);
    expect(fast(() => tidyPlain(`a${'\t'.repeat(100_000)}b`))).toBeLessThan(100);
  });

  it('still removes trailing spaces and blank lines at both ends', () => {
    expect(tidyPlain('\n\n a  \t\nb \n\n')).toBe(' a\nb');
    expect(tidy('\n\nx \u{a0}\n\n\n\ny\t\n\n')).toBe('x\n\ny');
  });
});
