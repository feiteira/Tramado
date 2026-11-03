import { describe, expect, it } from 'vitest';
import {
  fold,
  foldWithMap,
  isWordCharAt,
  lineIndex,
  lineSpans,
  originalSpan,
  paragraphAt,
  paragraphs,
  sentenceAt,
  sentences,
  tokenize,
} from './text';

const slice = (t: string, s: { start: number; end: number } | null) => (s ? t.slice(s.start, s.end) : null);

describe('paragraphs', () => {
  it('splits on newlines, trims, and skips blank lines', () => {
    const t = '  First one. \n\n\t\nSecond\n   \nThird  ';
    expect(paragraphs(t).map((p) => t.slice(p.start, p.end))).toEqual(['First one.', 'Second', 'Third']);
  });

  it('handles empty text and text without newlines', () => {
    expect(paragraphs('')).toEqual([]);
    expect(paragraphs('   ')).toEqual([]);
    expect(paragraphs('one')).toEqual([{ start: 0, end: 3 }]);
    expect(lineSpans('')).toEqual([{ start: 0, end: 0 }]);
    expect(lineSpans('a\n')).toEqual([{ start: 0, end: 1 }, { start: 2, end: 2 }]);
  });

  it('finds the paragraph at a position', () => {
    const t = 'Ana: I trust my GP.\nRui: Me too.\n\nAna: Good.';
    expect(slice(t, paragraphAt(t, 0))).toBe('Ana: I trust my GP.');
    expect(slice(t, paragraphAt(t, 19))).toBe('Ana: I trust my GP.'); // the '\n' ends line 0
    expect(slice(t, paragraphAt(t, 20))).toBe('Rui: Me too.');
    expect(paragraphAt(t, 33)).toBeNull(); // the blank line
    expect(slice(t, paragraphAt(t, t.length))).toBe('Ana: Good.');
    expect(paragraphAt(t, -1)).toBeNull();
    expect(paragraphAt(t, t.length + 1)).toBeNull();
    expect(paragraphAt('\nabc', 0)).toBeNull();
    expect(slice('\nabc', paragraphAt('\nabc', 1))).toBe('abc');
  });

  it('indexes lines for fast lookups', () => {
    const t = 'ab\ncd\n\nef';
    const li = lineIndex(t);
    expect(li.count).toBe(4);
    expect([0, 1, 2, 3, 5, 6, 7, 8, 9].map((p) => li.lineOf(p))).toEqual([0, 0, 0, 1, 1, 2, 3, 3, 3]);
    expect(li.span(1)).toEqual({ start: 3, end: 5 });
    expect(li.span(2)).toEqual({ start: 6, end: 6 });
    expect(li.span(3)).toEqual({ start: 7, end: 9 });
    expect(lineIndex('').lineOf(0)).toBe(0);
  });
});

describe('sentences', () => {
  it('splits on terminal punctuation followed by a capital', () => {
    const t = 'I moved in 2019. Then my mother fell ill! Did you help? Yes… a lot.';
    expect(sentences(t).map((s) => t.slice(s.start, s.end))).toEqual([
      'I moved in 2019.',
      'Then my mother fell ill!',
      'Did you help?',
      'Yes… a lot.',
    ]);
  });

  it('keeps abbreviations, initials, decimals and lower-case continuations together', () => {
    const t = 'Dr. Silva saw J. Costa at 3.5 km, e.g. near the river. The Sra. Dra. Lopes agreed.';
    expect(sentences(t).map((s) => t.slice(s.start, s.end))).toEqual([
      'Dr. Silva saw J. Costa at 3.5 km, e.g. near the river.',
      'The Sra. Dra. Lopes agreed.',
    ]);
  });

  it('includes closing quotes and handles Portuguese and Spanish', () => {
    const t = 'Ela disse: "Não volto." Depois saiu. ¿Y usted? Nunca.';
    expect(sentences(t).map((s) => t.slice(s.start, s.end))).toEqual(['Ela disse: "Não volto."', 'Depois saiu.', '¿Y usted?', 'Nunca.']);
  });

  it('never crosses a line', () => {
    const t = 'No full stop here\nNext line. Two';
    expect(sentences(t).map((s) => t.slice(s.start, s.end))).toEqual(['No full stop here', 'Next line.', 'Two']);
  });

  it('finds the sentence at a position', () => {
    const t = 'One two. Three four.\nFive.';
    expect(slice(t, sentenceAt(t, 0))).toBe('One two.');
    expect(slice(t, sentenceAt(t, 8))).toBe('One two.'); // the space after belongs to it
    expect(slice(t, sentenceAt(t, 9))).toBe('Three four.');
    expect(slice(t, sentenceAt(t, 20))).toBe('Three four.'); // the newline
    expect(slice(t, sentenceAt(t, 21))).toBe('Five.');
    expect(sentenceAt('', 0)).toBeNull();
    expect(sentenceAt('a\n\nb', 2)).toBeNull();
  });
});

describe('tokenize', () => {
  it('reads Unicode words with internal apostrophes and hyphens', () => {
    const t = "Don't — l'école, well-being; disse-lhe: “coração” 'quoted' -dash- naïve Ελλάδα 東京 2024";
    expect(tokenize(t).map((x) => x.word)).toEqual([
      "Don't", "l'école", 'well-being', 'disse-lhe', 'coração', 'quoted', 'dash', 'naïve', 'Ελλάδα', '東京', '2024',
    ]);
  });

  it('keeps offsets exact, including astral characters and combining marks', () => {
    const t = '𝒜bc café x';
    const toks = tokenize(t);
    expect(toks.map((x) => t.slice(x.start, x.end))).toEqual(toks.map((x) => x.word));
    expect(toks.map((x) => x.word)).toEqual(['𝒜bc', 'café', 'x']);
  });

  it('handles empty and punctuation-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' ,.;— ')).toEqual([]);
  });

  it('tells word characters apart', () => {
    expect(isWordCharAt('aé1', 0)).toBe(true);
    expect(isWordCharAt('aé1', 1)).toBe(true);
    expect(isWordCharAt('a b', 1)).toBe(false);
    expect(isWordCharAt('𝒜', 1)).toBe(true);
    expect(isWordCharAt('a', 5)).toBe(false);
  });
});

describe('fold', () => {
  it('folds case and accents by default', () => {
    expect(fold('Coração ÁGUA Straße Œuvre Ångström')).toBe('coracao agua strasse oeuvre angstrom');
    expect(fold('ﬁnal')).toBe('final');
    expect(fold('ΣΟΦΟΣ')).toBe('σοφοσ');
    expect(fold('it’s')).toBe("it's");
  });

  it('honours case and accent sensitivity', () => {
    expect(fold('Coração', { caseSensitive: true })).toBe('Coracao');
    expect(fold('Coração', { accentSensitive: true })).toBe('coração');
    expect(fold('Coração', { caseSensitive: true, accentSensitive: true })).toBe('Coração');
    // A decomposed query matches the NFC text when accents count.
    expect(fold('coração', { accentSensitive: true })).toBe('coração');
  });

  it('maps folded spans back to the original text', () => {
    const t = 'A Straße é ﬁna, İstanbul';
    const f = foldWithMap(t);
    expect(f.folded).toBe('a strasse e fina, istanbul');
    const at = (w: string) => {
      const i = f.folded.indexOf(w);
      const s = originalSpan(f, i, i + w.length);
      return t.slice(s.start, s.end);
    };
    expect(at('strasse')).toBe('Straße');
    expect(at('ss')).toBe('ß');
    expect(at(' e ')).toBe(' é ');
    expect(at('fi')).toBe('ﬁ');
    expect(at('fina')).toBe('ﬁna');
    expect(at('istanbul')).toBe('İstanbul');
    expect(f.map[f.folded.length]).toBe(t.length);
  });

  it('maps decomposed input (combining marks dropped) and expansions in accent-sensitive mode', () => {
    const t = 'café bar';
    const f = foldWithMap(t);
    expect(f.folded).toBe('cafe bar');
    expect(originalSpan(f, 0, 4)).toEqual({ start: 0, end: 5 }); // includes the mark
    const g = foldWithMap('İx', { accentSensitive: true });
    expect(g.folded).toBe('i̇x');
    expect(originalSpan(g, 0, 1)).toEqual({ start: 0, end: 1 });
    expect(originalSpan(g, 2, 3)).toEqual({ start: 1, end: 2 });
    expect(originalSpan(g, 1, 1)).toEqual({ start: 0, end: 0 });
  });

  it('keeps surrogate pairs whole', () => {
    const t = 'a😀B';
    const f = foldWithMap(t);
    expect(f.folded).toBe('a😀b');
    expect(originalSpan(f, 1, 3)).toEqual({ start: 1, end: 3 });
    expect(originalSpan(f, 3, 4)).toEqual({ start: 3, end: 4 });
  });

  it('handles empty and very long text', () => {
    expect(foldWithMap('').folded).toBe('');
    expect(foldWithMap('').map.length).toBe(1);
    const long = 'Ação '.repeat(200_000);
    const f = foldWithMap(long);
    expect(f.folded.length).toBe(long.length);
    expect(f.folded.startsWith('acao acao')).toBe(true);
    expect(f.map[f.folded.length]).toBe(long.length);
  });
});
