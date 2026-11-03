import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeRtfBytes, isRtf, rtfToText } from './rtf';

const fixture = (name: string) => decodeRtfBytes(new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url))));
const rtf = (body: string, header = '\\ansi\\ansicpg1252\\deff0') => rtfToText(`{\\rtf1${header} ${body}}`).text;

describe('rtfToText', () => {
  it('reads a hand-written file', () => {
    const r = rtfToText(fixture('hand.rtf'));
    expect(r.warnings).toEqual([]);
    expect(r.text).toBe(
      [
        'A participante disse: \u{201c}não sei\u{201d}.',
        'Coração \u{1f600} e café {chavetas} \\ barra',
        'Col1\tCol2',
        'nova linha\u{a0}fimx-y',
        'Polską źtrodło', // \fcharset238: Central European code page
        'Fim.',
      ].join('\n'),
    );
  });

  it('reads a Word-style file: upr/ud, list text, fields, tables, footnotes, hidden and deleted text', () => {
    expect(rtfToText(fixture('word.rtf')).text).toBe(
      [
        'Título da entrevista',
        'Ela respondeu que a escola era \u{2018}boa\u{2019}.[1]',
        '\u{2022}\tPrimeiro item',
        'uma ligação',
        'Nome\tIdade',
        'Rita\t41',
        'Visível.',
        '[1] Nota de rodapé fictícia.',
      ].join('\n'),
    );
  });

  it('skips \\ucN fallback characters, including hex escapes and per-group values', () => {
    expect(rtf("a\\u233\\'e9b \\uc2\\u8364XYc {\\uc0\\u233}d \\u8364\\'80e")).toBe('aéb €c éd €');
    // \uc0 inside the group does not leak out: the next \u skips 2 again (uc2 from before).
    expect(rtf('\\uc2 {\\uc0 \\u233}\\u233xy!')).toBe('éé!');
  });

  it('stops skipping fallback characters at a group boundary', () => {
    expect(rtf('{\\u233}x')).toBe('éx');
  });

  it('handles control symbols', () => {
    expect(rtf('a\\~b\\-c\\_d\\{\\}\\\\\\tab e\\emdash\\endash\\bullet\\lquote\\rquote\\ldblquote\\rdblquote')).toBe(
      'a\u{a0}bc-d{}\\\te\u{2014}\u{2013}\u{2022}\u{2018}\u{2019}\u{201c}\u{201d}',
    );
  });

  it('treats an escaped line break as \\par and ignores raw line breaks', () => {
    expect(rtf('um\\\ndois\r\ntrês')).toBe('um\ndoistrês');
  });

  it('decodes other code pages', () => {
    expect(rtf("\\'e0\\'e1", '\\ansi\\ansicpg1251')).toBe('аб');
    expect(rtf("\\'8e\\'96", '\\mac')).toBe('éñ');
    expect(rtf("\\'87\\'a4", '\\pca')).toBe('çñ');
    // Shift-JIS double-byte characters arrive as consecutive \'hh pairs.
    expect(rtf("\\'82\\'a0\\'82\\'a2", '\\ansi\\ansicpg932')).toBe('あい');
  });

  it('follows the font code page', () => {
    const src = "{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}{\\f1\\fcharset204 Arial Cyr;}{\\f2\\cpg1253 Greek;}}\\f0 \\'e9 {\\f1 \\'e9}{\\f2 \\'e1} \\plain \\'e9}";
    expect(rtfToText(src).text).toBe('é йα é');
  });

  it('reads raw 8-bit bytes as the code page (non-conforming but common)', () => {
    expect(rtfToText(decodeRtfBytes(new Uint8Array([...new TextEncoder().encode('{\\rtf1\\ansi '), 0xe3, 0x6f, 0x7d]))).text).toBe('ão');
  });

  it('warns about a code page it cannot decode and falls back to 1252', () => {
    const r = rtfToText("{\\rtf1\\ansi\\ansicpg12345 \\'e9}");
    expect(r.text).toBe('é');
    expect(r.warnings).toEqual(['rtf.codePage:12345']);
  });

  it('skips \\bin data and unknown starred destinations', () => {
    const src = `{\\rtf1 a{\\*\\unknowndest secret}{\\pict\\bin5 {}}\\x}b}`;
    expect(rtfToText(src).text).toBe('ab');
  });

  it('survives unbalanced braces and truncated input', () => {
    expect(rtfToText('{\\rtf1 aberto {\\b negrito').text).toBe('aberto negrito');
    expect(rtfToText('{\\rtf1 fecho}}} extra}').text).toBe('fecho extra');
    expect(rtfToText('{\\rtf1 fim\\').text).toBe('fim');
    expect(rtfToText("{\\rtf1 \\'z1ok}").text).toBe('ok');
  });

  it('drops empty paragraphs and keeps table rows apart', () => {
    expect(rtf('a\\par\\par\\par b\\par')).toBe('a\nb');
    expect(rtf('\\trowd\\intbl x\\par y\\cell z\\cell\\row\\pard depois')).toBe('x y\tz\ndepois');
  });

  it('handles empty documents', () => {
    expect(rtfToText('{\\rtf1}').text).toBe('');
    expect(rtfToText('').text).toBe('');
  });

  it('is fast on a large document', () => {
    const para = "\\pard\\f0\\fs24 Uma frase com acentua\\'e7\\'e3o e \\u8364? euros.\\par\n";
    const src = `{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}${para.repeat(80_000)}}`;
    expect(src.length).toBeGreaterThan(5_000_000);
    const t0 = performance.now();
    const { text } = rtfToText(src);
    expect(performance.now() - t0).toBeLessThan(5000); // guards against quadratic time, not a benchmark
    expect(text.split('\n')).toHaveLength(80_000);
    expect(text.split('\n')[0]).toBe('Uma frase com acentuação e € euros.');
  });
});

describe('isRtf', () => {
  it('recognises the header, with or without a BOM', () => {
    expect(isRtf('{\\rtf1 x}')).toBe(true);
    expect(isRtf('\u{feff}  {\\rtf1 x}')).toBe(true);
    expect(isRtf('\u{ef}\u{bb}\u{bf}{\\rtf1 x}')).toBe(true);
    expect(isRtf('plain')).toBe(false);
  });
});
