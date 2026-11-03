import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { odtToText } from './odt';
import { ImportError } from './types';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const odt = (body: string) =>
  zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:body><office:text>${body}</office:text></office:body></office:document-content>`),
  });

describe('odtToText', () => {
  it('reads the fixture: headings, spaces, tabs, breaks, notes, lists, tables; no comments or deletions', () => {
    const r = odtToText(fixture('notes.odt'));
    expect(r.text).toBe(
      [
        'Notas de observação',
        'Dois espaços e   quatro.\tTab.',
        'Quebra.',
        'Nota aqui[1] e segue.',
        'Item um',
        'Item dois',
        'Sub-item',
        'Nome\tCidade',
        'Luís\tÉvora',
        'Com comentário \u{1f389}',
        'Fim & adeus.',
        '[1] Texto da nota \u{2014} ñ.',
      ].join('\n'),
    );
    expect(r.warnings).toEqual(['doc.commentsSkipped:1']);
  });

  it('collapses XML layout whitespace but keeps typed spaces', () => {
    expect(odtToText(odt('<text:p>\n   a\n   b  <text:s text:c="2"/>c </text:p>')).text).toBe('a b   c');
    expect(odtToText(odt('<text:p><text:s text:c="4"/>recuo</text:p>')).text).toBe('    recuo');
  });

  it('reads text boxes and counts images', () => {
    const body =
      '<text:p>Antes <draw:frame><draw:text-box><text:p>na caixa</text:p></draw:text-box></draw:frame> depois</text:p>' +
      '<text:p><draw:frame><draw:image/></draw:frame>legenda</text:p>';
    const r = odtToText(odt(body));
    expect(r.text).toBe('Antes na caixa depois\nlegenda');
    expect(r.warnings).toEqual(['doc.imagesSkipped:1']);
  });

  it('keeps note citations that are not numbers', () => {
    expect(odtToText(odt('<text:p>a<text:note><text:note-citation>*</text:note-citation><text:note-body><text:p>nota</text:p></text:note-body></text:note></text:p>')).text).toBe(
      'a[*]\n[*] nota',
    );
  });

  it('skips the table of contents', () => {
    expect(odtToText(odt('<text:table-of-content><text:index-body><text:p>Índice 1</text:p></text:index-body></text:table-of-content><text:p>Corpo</text:p>')).text).toBe('Corpo');
  });

  it('reports damaged files', () => {
    expect(() => odtToText(new Uint8Array([1, 2, 3]))).toThrow(ImportError);
    expect(() => odtToText(zipSync({ 'other.xml': strToU8('<a/>') }))).toThrow(expect.objectContaining({ code: 'DAMAGED' }));
    expect(() => odtToText(zipSync({ 'content.xml': strToU8('<office:document-content') }))).toThrow(expect.objectContaining({ code: 'DAMAGED' }));
  });

  it('returns empty text for an empty document', () => {
    expect(odtToText(odt('')).text).toBe('');
  });
});
