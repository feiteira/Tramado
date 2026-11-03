import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeEntities } from './entities';
import { decodeHtml, htmlToParagraphs, htmlToText } from './html';
import { markdownInline, markdownToText } from './md';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;&nbsp;&eacute;&ccedil;&atilde;&ntilde;&euro;&hellip;')).toBe('&<>"\'\u{a0}éçãñ€\u{2026}');
    expect(decodeEntities('&#233;&#xE9;&#x1F600;&#128512;')).toBe('éé\u{1f600}\u{1f600}');
  });

  it('maps C1 references to Windows-1252 and rejects impossible code points', () => {
    expect(decodeEntities('&#147;sim&#148; &#150;')).toBe('\u{201c}sim\u{201d} \u{2013}');
    expect(decodeEntities('&#0;&#xD800;&#x110000;')).toBe('\u{fffd}\u{fffd}\u{fffd}');
  });

  it('accepts legacy names without a semicolon and leaves unknown ones alone', () => {
    expect(decodeEntities('A &amp B &copy 2024')).toBe('A & B © 2024');
    expect(decodeEntities('&eacute sem ponto; &naoexiste; R&D')).toBe('&eacute sem ponto; &naoexiste; R&D');
  });
});

describe('htmlToText', () => {
  it('reads the fixture page', () => {
    expect(htmlToText(decodeHtml(fixture('page.html')).text)).toBe(
      [
        'Diário de campo',
        'Primeiro parágrafo com quebra de linha no código & uma entidade é é \u{1f600}.',
        'Linha um',
        'Linha dois',
        '\u{2022} Item A',
        '\u{2022} Item B',
        'Nome\tIdade',
        'Ana\t34',
        '  código',
        '    indentado',
      ].join('\n'),
    );
  });

  it('drops scripts, styles, titles, comments and SVG', () => {
    const html = '<title>T</title><script>if (a < b) document.write("<p>x</p>")</script><style>p{}</style><!-- <p>c</p> --><p>Fica</p><svg><text>no</text><svg><g/></svg></svg><p>Também</p>';
    expect(htmlToText(html)).toBe('Fica\nTambém');
  });

  it('copes with tag soup: unclosed paragraphs, list items and cells, stray "<"', () => {
    expect(htmlToText('<p>Um<p>Dois<ul><li>a<li>b</ul>Três < quatro')).toBe('Um\nDois\n\u{2022} a\n\u{2022} b\nTrês < quatro');
    expect(htmlToText('<table><tr><td>a<td>b<tr><td><td>d</table>')).toBe('a\tb\n\td');
    expect(htmlToText('<p class="x" title=\'a > b\'>citação</p>')).toBe('citação');
    expect(htmlToText('<p>texto <b')).toBe('texto');
  });

  it('numbers ordered lists from their start and keeps nested lists flat', () => {
    expect(htmlToText('<ol start="3"><li>c</li><li>d<ul><li>x</li></ul></li></ol>')).toBe('3. c\n4. d\n\u{2022} x');
  });

  it('keeps a list marker for an item whose text is in a paragraph', () => {
    expect(htmlToText('<ul><li><p>Primeiro</p><p>continua</p></li></ul>')).toBe('\u{2022} Primeiro\ncontinua');
  });

  it('puts table cell paragraphs on one line and nested tables inside the cell', () => {
    expect(htmlToText('<table><tr><td><p>a</p><p>b</p></td><td><table><tr><td>x</td><td>y</td></tr></table></td></tr></table>')).toBe('a b\tx y');
  });

  it('collapses whitespace but keeps <pre> and treats <br> as a paragraph break', () => {
    expect(htmlToText('<div>  muitos \n\t espaços </div><p>a<br/>b<br><br>c</p><pre>\n  x\n\ty</pre>')).toBe('muitos espaços\na\nb\nc\n  x\n\ty');
  });

  it('keeps spaces and tabs when asked (mammoth output)', () => {
    expect(htmlToParagraphs('<p> a\tb  c\nd </p>', { literal: true })).toEqual(['a\tb  c d']);
    expect(htmlToParagraphs('<p>a\tb  c</p>')).toEqual(['a b c']);
  });

  it('turns mammoth footnotes into "[n] text" without the back links', () => {
    const html =
      '<p>Texto<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup>.</p>' +
      '<ol><li id="footnote-1"><p> A nota. <a href="#footnote-ref-1">\u{2191}</a></p></li><li id="endnote-2"><p>Fim <a href="#endnote-ref-2">\u{2191}</a></p></li></ol>';
    expect(htmlToText(html)).toBe('Texto[1].\n[1] A nota.\n[2] Fim');
  });

  it('returns nothing for empty or markup-only input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText('<html><head></head><body> </body></html>')).toBe('');
  });

  it('handles many scripts in linear time', () => {
    const html = '<script>var a = 1;</script><p>x</p>'.repeat(50_000);
    const t0 = performance.now();
    expect(htmlToText(html).split('\n')).toHaveLength(50_000);
    expect(performance.now() - t0).toBeLessThan(5000); // guards against quadratic time, not a benchmark
  });

  it('handles a large page in linear time', () => {
    const html = '<p>Parágrafo com <b>negrito</b> &amp; entidades.</p>\n'.repeat(60_000);
    const t0 = performance.now();
    const text = htmlToText(html);
    expect(performance.now() - t0).toBeLessThan(5000); // guards against quadratic time, not a benchmark
    expect(text.split('\n').length).toBe(60_000);
  });
});

describe('decodeHtml', () => {
  it('uses UTF-8 when valid, else the declared charset, else Windows-1252', () => {
    expect(decodeHtml(new TextEncoder().encode('<p>ação</p>'))).toEqual({ text: '<p>ação</p>', legacy: false });
    const latin2 = new Uint8Array([...new TextEncoder().encode('<meta charset="iso-8859-2"><p>'), 0xb1, ...new TextEncoder().encode('</p>')]);
    expect(decodeHtml(latin2).text).toContain('<p>\u{105}</p>');
    const cp1252 = new Uint8Array([...new TextEncoder().encode('<p>'), 0xe7, 0x93, ...new TextEncoder().encode('</p>')]);
    expect(decodeHtml(cp1252)).toEqual({ text: '<p>ç\u{201c}</p>', legacy: true });
  });
});

describe('markdownToText', () => {
  it('reads the fixture notes', () => {
    expect(markdownToText(new TextDecoder().decode(fixture('notes.md')))).toBe(
      [
        'Notas da observação',
        'Este é um parágrafo com negrito, itálico e um link. Continua na linha seguinte.',
        'Lista',
        '\u{2022} primeiro ponto',
        '\u{2022} segundo ponto com código',
        '1. numerado',
        'Uma citação.',
        'Coluna A\tColuna B',
        '1\t2',
        'Fim_do_ficheiro com snake_case.',
      ].join('\n'),
    );
  });

  it('strips inline markup but not literal characters', () => {
    expect(markdownInline('***ambos*** **negrito *itálico*** __sub__ _it_ ~~riscado~~')).toBe('ambos negrito itálico sub it riscado');
    expect(markdownInline('2 * 3 * 4 e a_b_c e \\*literal\\* e `**código**`')).toBe('2 * 3 * 4 e a_b_c e *literal* e **código**');
    expect(markdownInline('![foto](a.png) [texto](http://x.org/a_(b) "t") [ref][1] <https://x.org> <ana@example.org>')).toBe(
      'foto texto ref https://x.org ana@example.org',
    );
  });

  it('handles headings, setext headings, rules, quotes, fences and reference definitions', () => {
    const md = 'Título\n======\n\nSub\n---\n\n***\n\n> > citação *dupla*\n\n```js\nconst a = **1**;\n```\n\n[1]: https://example.org\n# Fim #';
    expect(markdownToText(md)).toBe('Título\nSub\ncitação dupla\nconst a = **1**;\nFim');
  });

  it('keeps hard line breaks', () => {
    expect(markdownToText('linha um  \nlinha dois\\\nlinha três\nmesmo parágrafo')).toBe('linha um\nlinha dois\nlinha três mesmo parágrafo');
  });

  it('handles CRLF, BOM and empty input', () => {
    expect(markdownToText('\u{feff}# T\r\n\r\ncorpo\r\n')).toBe('T\ncorpo');
    expect(markdownToText('')).toBe('');
  });
});
