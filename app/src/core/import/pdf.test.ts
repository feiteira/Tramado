import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { type PdfJsLike, extractPdfText } from './pdf';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));

/** A text item as pdf.js reports it; width estimated from the length unless given. */
const item = (str: string, x: number, y: number, size = 12, opts: { w?: number; eol?: boolean } = {}) => ({
  str,
  dir: 'ltr',
  transform: [size, 0, 0, size, x, y],
  width: opts.w ?? str.length * size * 0.5,
  height: size,
  fontName: 'F1',
  hasEOL: opts.eol ?? false,
});

/** A stand-in for pdf.js that serves prepared pages, to test the layout logic precisely. */
function fake(pages: unknown[][], fail?: { open?: unknown; page?: unknown }): PdfJsLike & { destroyed: boolean } {
  const f = {
    destroyed: false,
    getDocument: () => ({
      promise: fail?.open
        ? Promise.reject(fail.open)
        : Promise.resolve({
            numPages: pages.length,
            getPage: (n: number) =>
              fail?.page ? Promise.reject(fail.page) : Promise.resolve({ getTextContent: () => Promise.resolve({ items: pages[n - 1]! }), cleanup: () => undefined }),
          }),
      destroy: () => {
        f.destroyed = true;
        return Promise.resolve();
      },
    }),
  };
  return f;
}

/** Lines of body text at 12 pt with 14 pt leading, starting at y = 700. */
const body = (lines: string[], x = 72, top = 700) => lines.map((s, i) => item(s, x, top - i * 14));

describe('extractPdfText with pdf.js', () => {
  it('reads the fixture: heading, hyphenation, paragraphs, a page without text, page breaks', async () => {
    const r = await extractPdfText(fixture('interview.pdf'), pdfjs);
    expect(r.text).toBe(
      [
        'Entrevista com a participante P3',
        'A investigação qualitativa exige muita atenção aos detalhes do contexto social e cultural de cada comunidade.',
        'Segundo parágrafo começa aqui.',
        'Palavra separada',
        '',
        'Página três: \u{201c}aspas\u{201d} \u{2013} fim.',
      ].join('\n'),
    );
    expect(r.pages).toBe(3);
    expect(r.imagePages).toEqual([2]);
    expect(r.warnings).toEqual(['pdf.imagePages:2']);
    expect(r.pageStarts).toEqual([0, r.text.indexOf('\n\n'), r.text.indexOf('Página')]);
  });

  it('warns when no page has text', async () => {
    const r = await extractPdfText(fixture('scanned.pdf'), pdfjs);
    expect(r).toMatchObject({ text: '', pages: 1, imagePages: [1], warnings: ['pdf.noText'] });
  });

  it('reports encrypted and damaged files', async () => {
    await expect(extractPdfText(fixture('encrypted.pdf'), pdfjs)).rejects.toMatchObject({ code: 'ENCRYPTED_PDF', detail: 'password' });
    await expect(extractPdfText(fixture('encrypted.pdf'), pdfjs, { password: 'errada' })).rejects.toMatchObject({ code: 'ENCRYPTED_PDF', detail: 'incorrect-password' });
    await expect(extractPdfText(fixture('damaged.pdf'), pdfjs)).rejects.toMatchObject({ code: 'DAMAGED' });
    await expect(extractPdfText(new TextEncoder().encode('not a pdf at all'), pdfjs)).rejects.toMatchObject({ code: 'DAMAGED' });
  });

  it('opens an encrypted file with its password', async () => {
    const r = await extractPdfText(fixture('encrypted.pdf'), pdfjs, { password: 'segredo' });
    expect(r.text).toBe('Confidencial');
  });

  it('does not detach the caller’s bytes', async () => {
    const bytes = fixture('interview.pdf');
    await extractPdfText(bytes, pdfjs);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x25);
  });
});

describe('extractPdfText layout', () => {
  it('joins hyphenated words but keeps Portuguese clitics and capitalised compounds', async () => {
    const r = await extractPdfText(new Uint8Array(), fake([body(['A investiga-', 'ção começou. Ele disse-', 'lhe que sim, o Norte-', 'Americano e o anti-', 'inflamatório.'])]));
    expect(r.text).toBe('A investigação começou. Ele disse-lhe que sim, o Norte-Americano e o antiinflamatório.');
  });

  it('removes soft hyphens', async () => {
    const r = await extractPdfText(new Uint8Array(), fake([body(['comuni\u{ad}', 'dade e partici\u{ad}pação'])]));
    expect(r.text).toBe('comunidade e participação');
  });

  it('breaks paragraphs on vertical gaps, indents, short last lines, size changes and list items', async () => {
    const lines = [
      item('Título grande', 72, 760, 20),
      ...body(['Primeira linha de um parágrafo longo que chega à margem direita do texto', 'e termina aqui.'], 72, 720),
      item('Recuado, novo parágrafo que também chega bem à margem direita da página', 90, 692),
      item('e continua.', 72, 678),
      item('Depois de um espaço grande que chega bem perto da margem direita do bloco', 72, 630),
      item('\u{2022} um item', 72, 616),
      item('2. outro item', 72, 602),
    ];
    const r = await extractPdfText(new Uint8Array(), fake([lines]));
    expect(r.text.split('\n')).toEqual([
      'Título grande',
      'Primeira linha de um parágrafo longo que chega à margem direita do texto e termina aqui.',
      'Recuado, novo parágrafo que também chega bem à margem direita da página e continua.',
      'Depois de um espaço grande que chega bem perto da margem direita do bloco',
      '\u{2022} um item',
      '2. outro item',
    ]);
  });

  it('builds lines from separate runs, adding spaces only at real gaps', async () => {
    const runs = [item('Pala', 72, 700, 12, { w: 24 }), item('vra', 96, 700, 12, { w: 18 }), item('seguinte', 120, 700, 12, { w: 48 }), item('1', 168, 704, 7, { w: 4 })];
    const r = await extractPdfText(new Uint8Array(), fake([runs]));
    expect(r.text).toBe('Palavra seguinte1');
  });

  it('ignores text drawn twice for a bold effect', async () => {
    const runs = [item('Negrito', 72, 700), item('Negrito', 72.4, 700.2), item(' fim', 114, 700)];
    expect((await extractPdfText(new Uint8Array(), fake([runs]))).text).toBe('Negrito fim');
  });

  it('keeps columns apart (content-stream order)', async () => {
    const left = body(['Coluna um, linha um.', 'Coluna um, linha dois.'], 72, 700);
    const right = body(['Coluna dois começa.', 'Coluna dois acaba.'], 320, 700);
    const r = await extractPdfText(new Uint8Array(), fake([[...left, ...right]]));
    expect(r.text.split('\n')).toEqual(['Coluna um, linha um. Coluna um, linha dois.', 'Coluna dois começa. Coluna dois acaba.']);
  });

  it('uses end-of-line markers and ignores marked-content items', async () => {
    const items = [{ type: 'beginMarkedContent', id: 'm1' }, item('um', 72, 700, 12, { eol: true }), item('', 0, 0, 12, { eol: true }), item('dois', 72, 686), { type: 'endMarkedContent' }];
    expect((await extractPdfText(new Uint8Array(), fake([items]))).text).toBe('um dois');
  });

  it('treats whitespace-only pages as pages without text', async () => {
    const r = await extractPdfText(new Uint8Array(), fake([[item('   ', 72, 700)], body(['texto'])]));
    expect(r).toMatchObject({ text: 'texto', imagePages: [1], warnings: ['pdf.imagePages:1'], pageStarts: [0, 0] });
  });

  it('canonicalises text (NFC, no control characters)', async () => {
    const r = await extractPdfText(new Uint8Array(), fake([body(['ac\u{327}a\u{303}o\u{0}'])]));
    expect(r.text).toBe('ação');
  });

  it('maps pdf.js errors and always destroys the loading task', async () => {
    const wrong = fake([], { open: Object.assign(new Error('Incorrect Password'), { name: 'PasswordException', code: 2 }) });
    await expect(extractPdfText(new Uint8Array(), wrong)).rejects.toMatchObject({ code: 'ENCRYPTED_PDF', detail: 'incorrect-password' });
    expect(wrong.destroyed).toBe(true);
    const broken = fake([[]], { page: new Error('bad XRef') });
    await expect(extractPdfText(new Uint8Array(), broken)).rejects.toMatchObject({ code: 'DAMAGED', detail: 'pdf' });
    expect(broken.destroyed).toBe(true);
  });

  it('handles many pages quickly', async () => {
    const page = body(Array.from({ length: 45 }, (_, i) => `Linha ${i} de texto corrido que preenche a largura da página toda.`));
    const t0 = performance.now();
    const r = await extractPdfText(new Uint8Array(), fake(Array.from({ length: 300 }, () => page)));
    expect(performance.now() - t0).toBeLessThan(5000); // guards against quadratic time, not a benchmark
    expect(r.pages).toBe(300);
    expect(r.pageStarts).toHaveLength(300);
  });
});
