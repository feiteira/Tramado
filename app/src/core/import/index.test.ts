import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { type ImportedDoc, type ImportResult, ImportError, canonicalize, importFile, parseWarning, warning } from './index';

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Best of three runs, so a busy machine does not fail a speed requirement. */
async function bestTime(f: () => Promise<unknown>): Promise<number> {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    await f();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

async function one(name: string, data = bytes(name), opts = {}): Promise<ImportedDoc> {
  const r: ImportResult = await importFile(name, data, { pdfjs, ...opts });
  expect(r).toHaveLength(1);
  const doc = r[0]!;
  // Every document honours the canonical-text contract.
  expect(canonicalize(doc.text)).toBe(doc.text);
  expect(doc.text).not.toMatch(/[\r\u{feff}]/u);
  for (const s of doc.sync) expect(s.pos).toBeLessThanOrEqual(doc.text.length);
  for (const sp of doc.speakers) for (const span of sp.spans) expect(span.end).toBeLessThanOrEqual(doc.text.length);
  return doc;
}

describe('importFile', () => {
  it('imports plain text in any common encoding to the same canonical text', async () => {
    const le = await one('plain-utf16le.txt');
    const be = await one('plain-utf16be.txt');
    expect(le.text).toBe('Entrevista sobre habitação\nCanção \u{1f3b5}');
    expect(be.text).toBe(le.text);
    expect(le).toMatchObject({ name: 'plain-utf16le', kind: 'text', sync: [], speakers: [], warnings: [], source: { filename: 'plain-utf16le.txt', format: 'txt' } });
    expect(le.original).toBeUndefined();
    expect((await one('plain-utf8-bom-crlf.txt')).text).toBe('Primeira linha\nSegunda linha \u{2014} ñandú');
    const cp = await one('plain-cp1252.txt');
    expect(cp.text).toBe('Avó disse: \u{201c}não há pão\u{201d} \u{2013} España');
    expect(cp.warnings).toEqual(['text.legacyEncoding']);
  });

  it('a stray invalid byte in a UTF-8 file becomes one U+FFFD, not mojibake of every accented letter', async () => {
    const text = 'Entrevistadora: Como é a horta?\nParticipante: É ótima, ação coletiva e união.';
    const damaged = new Uint8Array([...utf8(text), 0x96, 0x0a]);
    const doc = await one('e.txt', damaged);
    expect(doc.text).toBe(`${text}\uFFFD`);
    expect(doc.warnings).toEqual(['text.damagedUtf8:1']);
    expect((await one('e.md', damaged)).warnings).toEqual(['text.damagedUtf8:1']);
    // A U+FFFD written in the file is a character, not damage; a BOM still comes off.
    expect((await one('f.txt', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('a \uFFFD b é'), 0xff]))).text).toBe('a \uFFFD b é\uFFFD');
    // Mostly not UTF-8: still Windows-1252, with that warning.
    const cp = await one('w.txt', new Uint8Array([...'Avó, não, pão, ação'].map((c) => c.charCodeAt(0))));
    expect(cp.text).toBe('Avó, não, pão, ação');
    expect(cp.warnings).toEqual(['text.legacyEncoding']);
  });

  it('keeps blank lines of plain text but trims the ends', async () => {
    expect((await one('n.txt', utf8('\n\nUm\n\n\nDois  \n\n'))).text).toBe('Um\n\n\nDois');
  });

  it('imports Word files with the original kept', async () => {
    const doc = await one('report.docx');
    expect(doc.kind).toBe('text');
    expect(doc.text.split('\n')[0]).toBe('Relatório de campo');
    expect(doc.original?.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(doc.original?.bytes).toEqual(bytes('report.docx'));
    expect((await one('report.docx', bytes('report.docx'), { keepOriginal: false })).original).toBeUndefined();
  });

  it('reads an Otter export in Word as a transcript, unless told not to', async () => {
    const doc = await one('otter.docx');
    expect(doc.kind).toBe('transcript');
    expect(doc.text).toBe('Entrevista 4 \u{2014} Otter\nSpeaker 1: Olá, obrigado por ter vindo.\nAna Sousa: Obrigada eu. É um prazer.\nSpeaker 1: Vamos então começar.\nAna Sousa: Sim.');
    expect(doc.sync.map((s) => s.ms)).toEqual([1000, 7000, 75_000, 80_000]);
    expect(doc.speakers.map((s) => s.name)).toEqual(['Speaker 1', 'Ana Sousa']);
    const renamed = await one('otter.docx', bytes('otter.docx'), { speakers: { rename: { 'speaker 1': 'Entrevistadora' } } });
    expect(renamed.speakers.map((s) => s.name)).toEqual(['Entrevistadora', 'Ana Sousa']);
    const plain = await one('otter.docx', bytes('otter.docx'), { transcript: 'never' });
    expect(plain.kind).toBe('text');
    expect(plain.text).toContain('Speaker 1  0:01');
  });

  it('reads text transcripts and forces one when asked', async () => {
    const doc = await one('transcript-brackets.txt');
    expect(doc.kind).toBe('transcript');
    expect(doc.speakers.map((s) => s.name)).toEqual(['Entrevistador', 'Inês']);
    const forced = await one('nota.txt', utf8('Ana: uma linha só'), { transcript: 'always' });
    expect(forced).toMatchObject({ kind: 'transcript', speakers: [{ name: 'Ana', spans: [{ start: 5, end: 17 }] }] });
    expect((await one('nota.txt', utf8('Ana: uma linha só'))).kind).toBe('text');
  });

  it('reads subtitle-like text (older Teams exports in Word) as cues', async () => {
    const text = 'Reunião\n0:0:0.0 --> 0:0:3.410\nMarta Gil\nOlá a todos.\n\n0:0:4.0 --> 0:0:6.2\nTomás Reis\nBom dia.\n\n0:0:7.0 --> 0:0:9.0\nMarta Gil\nVamos lá.\n\n0:0:9.5 --> 0:0:10.0\nTomás Reis\nSim.';
    const doc = await one('teams.txt', utf8(text));
    expect(doc.kind).toBe('transcript');
    expect(doc.text).toBe('Marta Gil: Olá a todos.\nTomás Reis: Bom dia.\nMarta Gil: Vamos lá.\nTomás Reis: Sim.');
    expect(doc.sync.map((s) => s.ms)).toEqual([0, 4000, 7000, 9500]);
  });

  it('imports subtitles as transcripts', async () => {
    const vtt = await one('interview.vtt');
    expect(vtt).toMatchObject({ kind: 'transcript', source: { format: 'vtt' } });
    expect(vtt.sync[0]).toEqual({ pos: 0, ms: 1000 });
    const srt = await one('zoom.srt');
    expect(srt.speakers.map((s) => s.name)).toEqual(['Carmen Ruiz', 'Javier Ortega']);
    expect((await one('zoom.srt', bytes('zoom.srt'), { syncEveryCue: false })).sync).toHaveLength(2);
  });

  it('imports HTML, Markdown, RTF and ODT', async () => {
    expect((await one('page.html')).text.split('\n')[0]).toBe('Diário de campo');
    expect((await one('notes.md')).text.split('\n')[0]).toBe('Notas da observação');
    expect((await one('hand.rtf')).text.split('\n')[0]).toBe('A participante disse: \u{201c}não sei\u{201d}.');
    expect((await one('word.rtf')).original).toBeUndefined();
    const odt = await one('notes.odt');
    expect(odt.warnings).toEqual(['doc.commentsSkipped:1']);
  });

  it('imports PDFs with page warnings and the original kept', async () => {
    const doc = await one('interview.pdf');
    expect(doc).toMatchObject({ kind: 'pdf', warnings: ['pdf.imagePages:2'], original: { mime: 'application/pdf' } });
    const scanned = await one('scanned.pdf');
    expect(scanned).toMatchObject({ kind: 'pdf', text: '', warnings: ['pdf.noText'] });
    await expect(importFile('x.pdf', bytes('encrypted.pdf'), { pdfjs })).rejects.toMatchObject({ code: 'ENCRYPTED_PDF' });
    const opened = await one('x.pdf', bytes('encrypted.pdf'), { password: 'segredo' });
    expect(opened.text).toBe('Confidencial');
    // Only read as a transcript when the researcher says so.
    expect((await one('interview.pdf', bytes('interview.pdf'), { transcript: 'always' })).kind).toBe('transcript');
  });

  it('needs pdf.js for PDFs (a programming error, not a damaged file)', async () => {
    await expect(importFile('x.pdf', bytes('interview.pdf'))).rejects.toThrow('pdfjs option');
  });

  it('reports typed errors', async () => {
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof ImportError ? `${e.code}:${e.detail ?? ''}` : `raw:${String(e)}`));
    expect(await code(importFile('empty.txt', bytes('empty.txt')))).toBe('EMPTY:');
    expect(await code(importFile('blank.txt', utf8(' \n\t\n')))).toBe('EMPTY:');
    expect(await code(importFile('empty.docx', bytes('empty.docx')))).toBe('EMPTY:');
    expect(await code(importFile('broken.docx', bytes('not-a-zip.docx')))).toBe('DAMAGED:docx');
    expect(await code(importFile('broken.pdf', bytes('damaged.pdf'), { pdfjs }))).toBe('DAMAGED:pdf');
    expect(await code(importFile('broken.odt', new Uint8Array([0x50, 0x4b, 3, 4, 1, 2])))).toBe('DAMAGED:zip');
    expect(await code(importFile('foto.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])))).toBe('UNSUPPORTED:image');
    expect(await code(importFile('old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))).toBe('UNSUPPORTED:doc');
    expect(await code(importFile('x.rtf', utf8('{\\rtf1 ok}'), { format: 'txt' }))).toBe('ok');
    expect(await code(importFile('x.txt', utf8('plain'), { format: 'rtf' }))).toBe('DAMAGED:rtf');
  });

  it('refuses text longer than a document may be', async () => {
    const huge = new Uint8Array(20_000_001).fill(0x61);
    await expect(importFile('huge.txt', huge)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('imports a 5 MB text file in under a second', async () => {
    const text = 'Entrevistadora disse que a participação foi boa, com emoção e ñ.\n'.repeat(80_000);
    const data = utf8(text);
    expect(data.length).toBeGreaterThan(5_000_000);
    expect(await bestTime(() => importFile('grande.txt', data))).toBeLessThan(1000);
    const doc = await one('grande.txt', data);
    expect(doc.text.length).toBe(text.length - 1);
  });

  it('imports a 5 MB transcript in under a second', async () => {
    const lines: string[] = [];
    const line = (i: number) => `[${String(Math.floor(i / 3600) % 100).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}] ${i % 2 ? 'Participante' : 'Entrevistadora'}: Uma fala com acentuação e algum comprimento para encher.`;
    for (let i = 0; i < 60_000; i++) lines.push(line(i));
    const data = utf8(lines.join('\n'));
    expect(data.length).toBeGreaterThan(5_000_000);
    expect(await bestTime(() => importFile('longa.txt', data))).toBeLessThan(1000);
    const doc = await one('longa.txt', data);
    expect(doc.kind).toBe('transcript');
    expect(doc.sync).toHaveLength(60_000);
  });
});

describe('warnings', () => {
  it('round-trip through warning and parseWarning', () => {
    expect(warning('pdf.imagePages', '1,3')).toBe('pdf.imagePages:1,3');
    expect(parseWarning('pdf.imagePages:1,3')).toEqual({ code: 'pdf.imagePages', arg: '1,3' });
    expect(parseWarning('pdf.noText')).toEqual({ code: 'pdf.noText', arg: null });
  });
});

describe('long whitespace runs do not hang an importer', () => {
  const sp = ' '.repeat(60_000);
  const cases: [string, string][] = [
    ['run.txt', `a${sp}b\n${'\n'.repeat(60_000)}c`],
    ['run.md', `# Title${sp}x\n\n|-${sp}x\n\nline${sp}x\n\n# C#${'#'.repeat(60_000)}x`],
    ['run.html', `<p>a${'&nbsp;'.repeat(60_000)}b</p><pre>a${sp}b</pre>`],
    ['run.rtf', `{\\rtf1\\ansi a${sp}b\\par c${'\\~'.repeat(20_000)}d}`],
  ];
  for (const [name, text] of cases) {
    it(`imports ${name} quickly`, async () => {
      expect(await bestTime(() => importFile(name, utf8(text)))).toBeLessThan(1000);
    });
  }

  it('keeps ATX headings as before: closing hashes go, "C#" stays', async () => {
    const doc = await one('h.md', utf8('# Title ##\n\n## C#\n\n### Spaced   ###   \n\nText'));
    expect(doc.text).toBe('Title\nC#\nSpaced\nText');
  });
});
