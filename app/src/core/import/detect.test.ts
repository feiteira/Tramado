import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPPORTED, formatOf, mimeOf, sniffFormat, supportedExtensions } from './detect';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('formatOf', () => {
  it('recognises every fixture', () => {
    const cases: [string, string][] = [
      ['plain-utf8.txt', 'txt'], ['plain-utf16le.txt', 'txt'], ['plain-utf16be.txt', 'txt'], ['plain-cp1252.txt', 'txt'],
      ['notes.md', 'md'], ['page.html', 'html'], ['hand.rtf', 'rtf'], ['word.rtf', 'rtf'], ['report.docx', 'docx'],
      ['otter.docx', 'docx'], ['notes.odt', 'odt'], ['interview.pdf', 'pdf'], ['encrypted.pdf', 'pdf'],
      ['interview.vtt', 'vtt'], ['teams.vtt', 'vtt'], ['zoom.srt', 'srt'], ['subtitles.srt', 'srt'],
    ];
    for (const [file, format] of cases) expect([file, formatOf(file, fixture(file))]).toEqual([file, format]);
  });

  it('sniffs a text file opening with many comments in linear time', () => {
    const enc = new TextEncoder();
    const comments = '<!-- nota -->\n'.repeat(200);
    const t0 = performance.now();
    expect(formatOf('notas.txt', enc.encode(`${comments}Entrevista com a participante.\n`))).toBe('txt');
    expect(formatOf('notas', enc.encode(`${'<!--a-->'.repeat(400)}x`))).toBe('txt');
    expect(formatOf('notas.txt', enc.encode(`<!-- ${'-'.repeat(3000)} sem fim`))).toBe('txt');
    expect(performance.now() - t0).toBeLessThan(50);
    expect(formatOf('pagina.txt', enc.encode(`${comments}<!DOCTYPE html><p>x</p>`))).toBe('html');
  });

  it('trusts the bytes over a wrong extension', () => {
    expect(formatOf('entrevista.doc', fixture('word.rtf'))).toBe('rtf');
    expect(formatOf('relatorio.zip', fixture('report.docx'))).toBe('docx');
    expect(formatOf('notas.docx', fixture('notes.odt'))).toBe('odt');
    expect(sniffFormat('dados', fixture('survey.xlsx'))).toEqual({ format: null, hint: 'xlsx' }); // Tramado drops tables
    expect(formatOf('legendas.txt', fixture('interview.vtt'))).toBe('vtt');
    expect(formatOf('legendas.txt', fixture('zoom.srt'))).toBe('srt');
    expect(formatOf('pagina.txt', fixture('page.html'))).toBe('html');
    expect(formatOf('scan', fixture('interview.pdf'))).toBe('pdf');
    expect(formatOf('notes.vtt', fixture('zoom.srt'))).toBe('srt');
  });

  it('accepts a PDF header after some junk', () => {
    const junk = new Uint8Array([...utf8('\n\n garbage '), ...fixture('interview.pdf')]);
    expect(formatOf('x.bin', junk)).toBe('pdf');
  });

  it('keeps explicit text formats and reads unknown text as plain text', () => {
    expect(formatOf('a.md', utf8('<html><body>quoted</body></html>'))).toBe('md');
    expect(formatOf('notes.log', utf8('Só texto.'))).toBe('txt');
    expect(formatOf('NOTAS', utf8('Só texto.'))).toBe('txt');
    expect(formatOf('a.rtf', utf8('not really rtf'))).toBe('txt');
  });

  it('keeps a damaged binary format so its importer reports the damage', () => {
    expect(formatOf('broken.docx', fixture('not-a-zip.docx'))).toBe('docx');
    expect(formatOf('broken.pdf', utf8('no header here'))).toBe('pdf');
  });

  it('says what an unsupported file seems to be', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    expect(sniffFormat('old.doc', ole)).toEqual({ format: null, hint: 'doc' });
    expect(sniffFormat('old.xls', ole)).toEqual({ format: null, hint: 'xls' });
    expect(sniffFormat('foto.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toEqual({ format: null, hint: 'image' });
    expect(sniffFormat('a.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ format: null, hint: 'image' });
    expect(sniffFormat('a.mp3', new Uint8Array([0x49, 0x44, 0x33, 3, 0]))).toEqual({ format: null, hint: 'media' });
    expect(sniffFormat('a.mp3', new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toEqual({ format: null, hint: 'media' });
    expect(sniffFormat('a.m4a', new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d]))).toEqual({ format: null, hint: 'media' });
    expect(sniffFormat('a.wav', utf8('RIFF\u{0}\u{0}\u{0}\u{0}WAVEfmt '))).toEqual({ format: null, hint: 'media' });
    expect(sniffFormat('a.bin', new Uint8Array([1, 2, 3, 0, 5, 6, 0, 0, 200, 201]))).toEqual({ format: null, hint: 'binary' });
  });

  it('identifies other zip-based formats', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const pptx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'ppt/presentation.xml': strToU8('<p/>') });
    expect(sniffFormat('slides.pptx', pptx)).toEqual({ format: 'pptx', hint: null });
    const ods = zipSync({ mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }], 'content.xml': strToU8('<x/>') });
    expect(sniffFormat('folha.ods', ods)).toEqual({ format: null, hint: 'ods' });
    const plain = zipSync({ 'a.txt': strToU8('a') });
    expect(sniffFormat('arquivo.zip', plain)).toEqual({ format: null, hint: 'zip' });
  });

  it('decides empty files by extension', () => {
    expect(formatOf('empty.docx', new Uint8Array())).toBe('docx');
    expect(formatOf('empty', new Uint8Array())).toBe('txt');
  });
});

describe('SUPPORTED', () => {
  it('lists extensions for file dialogs, by group', () => {
    expect(supportedExtensions()).toEqual(expect.arrayContaining(['docx', 'odt', 'pdf', 'rtf', 'txt', 'md', 'html', 'htm', 'vtt', 'srt']));
    expect(supportedExtensions('table')).toEqual([]);
    expect(supportedExtensions('transcript')).toEqual(['vtt', 'srt']);
    expect(new Set(SUPPORTED.flatMap((s) => s.extensions)).size).toBe(SUPPORTED.flatMap((s) => s.extensions).length);
    expect(mimeOf('pdf')).toBe('application/pdf');
  });
});
