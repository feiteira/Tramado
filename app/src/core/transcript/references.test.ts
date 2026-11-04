import { describe, expect, it } from 'vitest';
import type { Segment } from '../model/files';
import { legalRefs, normalizeCode } from './references';

const seg = (id: string, startMs: number, text: string): Segment => ({ id, startMs, endMs: startMs + 3000, speaker: 'lecture', text });
const said = (refs: ReturnType<typeof legalRefs>, t: { segments: Segment[] }) =>
  refs.map((r) => [t.segments.find((s) => s.id === r.segmentId)!.text.slice(r.start, r.end), r.article, r.code]);

describe('legal references (product-ux §9.3)', () => {
  it('finds Portuguese articles with their code', () => {
    const t = {
      segments: [
        seg('s_00001', 0, 'Nos termos do art. 122.º do CC; o artigo 125.º, n.º 1, alínea a) e os arts. 240.º a 243.º do Código Civil.'),
        seg('s_00002', 4000, 'O art. 13.º da CRP e o artigo 483.º-A do CC.'),
        seg('s_00003', 8000, 'Artigo 18.º, n.º 3, da Constituição.'),
      ],
    };
    expect(said(legalRefs(t, 'pt-PT'), t)).toEqual([
      ['art. 122.º do CC', '122.º', 'CC'],
      ['artigo 125.º, n.º 1, alínea a)', '125.º', null],
      ['arts. 240.º a 243.º do Código Civil', '240.º', 'CC'],
      ['art. 13.º da CRP', '13.º', 'CRP'],
      ['artigo 483.º-A do CC', '483.º-A', 'CC'],
      ['Artigo 18.º, n.º 3', '18.º', null],
    ]);
  });

  it('finds Spanish and English articles, and nothing in other languages', () => {
    const es = { segments: [seg('s_00001', 0, 'Según el artículo 1902 del Código Civil y el art. 24.2 CE, y el art. 10 bis de la LEC.')] };
    expect(said(legalRefs(es, 'es'), es)).toEqual([
      ['artículo 1902 del Código Civil', '1902', 'CC'],
      ['art. 24.2 CE', '24', 'CE'],
      ['art. 10 bis de la LEC', '10 bis', 'LEC'],
    ]);
    const en = { segments: [seg('s_00001', 0, 'Under section 3(1) of the Human Rights Act 1998 and Article 8 ECHR.')] };
    expect(said(legalRefs(en, 'en'), en)).toEqual([
      ['section 3(1) of the Human Rights Act 1998', '3', 'Human Rights Act 1998'],
      ['Article 8 ECHR', '8', 'ECHR'],
    ]);
    expect(legalRefs(en, 'de')).toEqual([]);
  });

  it('normalises codes said in full', () => {
    expect(normalizeCode('Código de Processo Civil', 'pt')).toBe('CPC');
    expect(normalizeCode('Constitución Española', 'es')).toBe('CE');
    expect(normalizeCode(undefined, 'pt')).toBeNull();
  });
});
