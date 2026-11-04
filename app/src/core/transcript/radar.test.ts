import { describe, expect, it } from 'vitest';
import type { Segment } from '../model/files';
import { examRadar, radarLang } from './radar';

const seg = (id: string, startMs: number, text: string, speaker = 'lecture'): Segment => ({ id, startMs, endMs: startMs + 3000, speaker, text });

describe('exam radar (product-ux §9.3)', () => {
  it('finds the phrases of the transcript language only', () => {
    const t = {
      segments: [
        seg('s_00001', 0, 'Atenção: isto costuma sair no exame, tomem nota.'),
        seg('s_00002', 3500, 'O exame foi ontem.'),
        seg('s_00003', 7000, 'Esta matéria vai sair de certeza no teste.'),
        seg('s_00004', 20_000, 'This will come up on the exam.'),
      ],
    };
    expect(examRadar(t, 'pt-PT')).toEqual([{ segmentId: 's_00001', atMs: 0 }, { segmentId: 's_00003', atMs: 7000 }]);
    expect(examRadar(t, 'en')).toEqual([{ segmentId: 's_00004', atMs: 20_000 }]);
    expect(examRadar(t, 'fr')).toEqual([]);
    expect(examRadar(t, 'auto')).toEqual([]);
  });

  it('finds a phrase that runs across two segments of one paragraph, at the segment where it starts', () => {
    const t = { segments: [seg('s_00001', 0, 'E isto'), seg('s_00002', 3100, 'entra seguro en el examen.')] };
    expect(examRadar(t, 'es')).toEqual([]);
    const pt = { segments: [seg('s_00001', 0, 'Reparem, isto'), seg('s_00002', 3100, 'vai sair no exame.')] };
    expect(examRadar(pt, 'pt')).toEqual([{ segmentId: 's_00001', atMs: 0 }]);
    const es = { segments: [seg('s_00001', 0, 'Bien.'), seg('s_00002', 3100, 'Esto entra seguro en el examen.')] };
    expect(examRadar(es, 'es-ES')).toEqual([{ segmentId: 's_00002', atMs: 3100 }]);
  });

  it('maps languages', () => {
    expect(radarLang('pt-BR')).toBe('pt');
    expect(radarLang('es')).toBe('es');
    expect(radarLang('en-GB')).toBe('en');
    expect(radarLang('de')).toBeNull();
  });
});
