import { describe, expect, it } from 'vitest';
import type { Segment, TranscriptEditLine, TranscriptFile } from '../model/files';
import { approxFind, mapOffset, quoteOf, reanchor, remapThroughEdit, segmentAt, type SegmentLocator } from './anchors';
import { mergeOp, setTextOp, splitOp, type EditStamp } from './edits';
import { replay } from './effective';

const ANA = 'AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2';
const seg = (id: string, startMs: number, endMs: number, text: string): Segment => ({ id, startMs, endMs, speaker: 'lecture', text });
const T = (segments: Segment[]): Pick<TranscriptFile, 'segments'> => ({ segments });

const base = T([
  seg('s_aaaaa', 0, 4000, 'Bom dia a todos.'),
  seg('s_bbbbb', 4000, 9000, 'Hoje vamos falar do artigo 483.º do Código Civil.'),
  seg('s_ccccc', 9000, 12000, 'É importante para o exame.'),
]);
/** A highlight on "artigo 483.º" in s_bbbbb. */
const anchor = (): { locator: SegmentLocator; quote: ReturnType<typeof quoteOf> } => {
  const text = base.segments[1]!.text;
  const s = text.indexOf('artigo 483.º');
  return { locator: { type: 'segment', segmentId: 's_bbbbb', startMs: 6000, endMs: 7500, charStart: s, charEnd: s + 12 }, quote: quoteOf(text, s, s + 12) };
};

const transcript = (segments: Segment[]): TranscriptFile => ({
  format: 'tramado.transcript', version: 1, lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', round: 1, revision: 1, audioSha256: null, language: 'pt-PT',
  writer: { deviceId: ANA, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg' }, transcribedBy: { deviceId: ANA, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', name: 'Ana', at: '2026-11-03T12:00:00.000Z' },
  engine: { kind: 'local', name: 'whisper.cpp' }, speakers: [{ id: 'lecture', label: 'Professor' }], segments, folded: {}, updatedAt: '2026-11-03T12:00:00.000Z',
});
let n = 0;
const stamp = (ms: number): EditStamp => ({ id: `01JBX4Q7Z5W8M2E3C9R6T0Y${String(n++).padStart(3, '0')}`, hlc: `${String(ms).padStart(15, '0')}-00000-ab4z76w`, ms, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', transcript: { lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', round: 1, revision: 1 } });
const apply = (...lines: TranscriptEditLine[]) => replay(transcript(base.segments.map((s) => ({ ...s }))), [{ deviceId: ANA, lines }]);

describe('anchors survive corrections (audio-pipeline §5.5)', () => {
  it('stays exact when nothing changed', () => {
    const a = anchor();
    expect(reanchor(base, a.locator, a.quote)).toMatchObject({ status: 'exact', locator: a.locator });
  });

  it('moves with a set_text that changed the text before it', () => {
    const a = anchor();
    const { transcript: t } = apply(setTextOp(stamp(1), 's_bbbbb', base.segments[1]!.text, 'Hoje falamos do artigo 483.º do Código Civil.'));
    const r = reanchor(t, a.locator, a.quote);
    expect(r.status).toBe('moved');
    expect(r.locator.segmentId).toBe('s_bbbbb');
    expect(t.segments[1]!.text.slice(r.locator.charStart, r.locator.charEnd)).toBe('artigo 483.º');
    expect([r.locator.startMs, r.locator.endMs]).toEqual([6000, 7500]);   // the audio did not change
  });

  it('follows a split into the new segment', () => {
    const a = anchor();
    const { transcript: t, info } = apply(splitOp(stamp(1), 's_bbbbb', 20, 6500, 's_ddddd'));
    const r = reanchor(t, a.locator, a.quote, { splitFrom: info.splitFrom });
    expect(r).toMatchObject({ status: 'moved', locator: { segmentId: 's_ddddd', charStart: 0, charEnd: 12 } });
    // Also without the replay's hints: the time finds it.
    expect(reanchor(t, a.locator, a.quote).locator.segmentId).toBe('s_ddddd');
  });

  it('follows a merge into the absorbing segment', () => {
    const quote = quoteOf(base.segments[2]!.text, 2, 12);   // "importante"
    const locator: SegmentLocator = { type: 'segment', segmentId: 's_ccccc', startMs: 9000, endMs: 12000, charStart: 2, charEnd: 12 };
    const { transcript: t } = apply(mergeOp(stamp(1), 's_bbbbb', 's_ccccc'));
    const r = reanchor(t, locator, quote);
    expect(r.status).toBe('moved');
    expect(r.locator.segmentId).toBe('s_bbbbb');
    expect(t.segments[1]!.text.slice(r.locator.charStart, r.locator.charEnd)).toBe('importante');
  });

  it('picks the occurrence whose context matches', () => {
    const t = T([seg('s_aaaaa', 0, 9000, 'o dolo e o dolo eventual; o dolo directo')]);
    const quote = { exact: 'o dolo', prefix: 'eventual; ', suffix: ' directo' };
    const r = reanchor(t, { type: 'segment', segmentId: 's_aaaaa', startMs: 0, endMs: 9000, charStart: 28, charEnd: 34 }, quote);
    expect(r.locator.charStart).toBe(26);
  });

  it('finds a quote whose accents or case were corrected, then an approximate one', () => {
    const a = anchor();
    const { transcript: t1 } = apply(setTextOp(stamp(1), 's_bbbbb', base.segments[1]!.text, 'Hoje vamos falar do Artigo 483.º do Código Civil.'));
    const r1 = reanchor(t1, a.locator, a.quote);
    expect(r1.status).toBe('approximate');
    expect(t1.segments[1]!.text.slice(r1.locator.charStart, r1.locator.charEnd)).toBe('Artigo 483.º');
    const { transcript: t2 } = apply(setTextOp(stamp(1), 's_bbbbb', base.segments[1]!.text, 'Hoje vamos falar do artigo 438.º do Código Civil.'));
    const r2 = reanchor(t2, a.locator, a.quote);
    expect(r2.status).toBe('approximate');
    expect(t2.segments[1]!.text.slice(r2.locator.charStart, r2.locator.charEnd)).toBe('artigo 438.º');
  });

  it('falls back to the time, and is lost only without any segment', () => {
    const a = anchor();
    const { transcript: t } = apply(setTextOp(stamp(1), 's_bbbbb', base.segments[1]!.text, 'Completely different words now.'));
    const r = reanchor(t, a.locator, a.quote);
    expect(r).toMatchObject({ status: 'approximate', locator: { segmentId: 's_bbbbb' } });
    expect(r.locator.charStart).toBeUndefined();
    expect(reanchor(T([]), a.locator, a.quote).status).toBe('lost');
    expect(segmentAt(base, 10_500)!.id).toBe('s_ccccc');
    expect(segmentAt(base, 99_000)!.id).toBe('s_ccccc');
  });

  it('whole-segment anchors (citations without a quote) follow the id', () => {
    const loc: SegmentLocator = { type: 'segment', segmentId: 's_ccccc', startMs: 9000, endMs: 12000 };
    expect(reanchor(base, loc, null).status).toBe('exact');
    const { transcript: t } = apply(mergeOp(stamp(1), 's_bbbbb', 's_ccccc'));
    expect(reanchor(t, loc, null)).toMatchObject({ status: 'moved', locator: { segmentId: 's_bbbbb', startMs: 9000, endMs: 12000 } });
    expect(reanchor(t, { ...loc, segmentId: 's_zzzzz', startMs: 1000, endMs: 2000 }, null)).toMatchObject({ status: 'approximate', locator: { segmentId: 's_aaaaa' } });
  });
});

describe("the editor's own edits map anchors at once", () => {
  it('maps offsets through one changed region', () => {
    expect(mapOffset('abc def ghi', 'abc DEFX ghi', 0)).toBe(0);
    expect(mapOffset('abc def ghi', 'abc DEFX ghi', 8)).toBe(9);
    expect(mapOffset('abc def ghi', 'abc DEFX ghi', 5, 'start')).toBe(4);
    expect(mapOffset('abc def ghi', 'abc DEFX ghi', 5, 'end')).toBe(8);
  });

  it('remaps through set_text, split and merge', () => {
    const a = anchor();
    const text = base.segments[1]!.text;
    const st = remapThroughEdit(base, setTextOp(stamp(1), 's_bbbbb', text, 'Hoje falamos do artigo 483.º do Código Civil.'), a.locator);
    expect('Hoje falamos do artigo 483.º do Código Civil.'.slice(st.charStart, st.charEnd)).toBe('artigo 483.º');
    const sp = remapThroughEdit(base, splitOp(stamp(1), 's_bbbbb', 20, 6500, 's_ddddd'), a.locator);
    expect(sp).toMatchObject({ segmentId: 's_ddddd', charStart: 0, charEnd: 12 });
    const before = remapThroughEdit(base, splitOp(stamp(1), 's_bbbbb', 30, 7000, 's_ddddd'), { ...a.locator, charStart: 0, charEnd: 4 });
    expect(before).toMatchObject({ segmentId: 's_bbbbb', charStart: 0, charEnd: 4 });
    const loc: SegmentLocator = { type: 'segment', segmentId: 's_ccccc', startMs: 9000, endMs: 12000, charStart: 2, charEnd: 12 };
    const mg = remapThroughEdit(base, mergeOp(stamp(1), 's_bbbbb', 's_ccccc'), loc);
    const merged = `${text} ${base.segments[2]!.text}`;
    expect(merged.slice(mg.charStart, mg.charEnd)).toBe('importante');
  });

  it('matches approximately', () => {
    expect(approxFind('o artigo 438 do codigo', 'artigo 483', 2)).toEqual({ start: 2, end: 12, errors: 2 });
    expect(approxFind('nothing alike', 'artigo 483', 2)).toBeNull();
  });
});
