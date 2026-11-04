import { describe, expect, it } from 'vitest';
import type { Segment, TranscriptEditLine, TranscriptFile } from '../model/files';
import { labelSpeakerOp, mergeOp, setSpeakerOp, setTextOp, splitOp, splitTime, textBase, validEditLine, type EditStamp } from './edits';
import { effective, findSegment, replay, type EditLog } from './effective';
import { fold } from './fold';
import { sha1Hex } from './sha1';

const ANA = 'AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2';
const BRUNO = 'TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT';
const MEMBER = 'k3q7mzx2v4hbtnw5r6yjc2aefg';
const LECTURE = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';

const seg = (id: string, startMs: number, endMs: number, text: string, extra: Partial<Segment> = {}): Segment => ({ id, startMs, endMs, speaker: 'lecture', text, ...extra });

function transcript(over: Partial<TranscriptFile> = {}): TranscriptFile {
  return {
    format: 'tramado.transcript', version: 1, lectureId: LECTURE, round: 1, revision: 1, audioSha256: 'a'.repeat(64), language: 'pt-PT',
    writer: { deviceId: ANA, memberId: MEMBER }, transcribedBy: { deviceId: ANA, memberId: MEMBER, name: 'Ana', at: '2026-11-03T12:00:00.000Z' },
    engine: { kind: 'local', name: 'whisper.cpp' }, speakers: [{ id: 'lecture', label: 'Professor' }],
    segments: [
      seg('s_aaaaa', 0, 4000, 'Bom dia a todos.'),
      seg('s_bbbbb', 4000, 9000, 'Hoje vamos falar do artigo 483.º do Código Civil.', { words: [{ startMs: 4000, endMs: 4500, text: 'Hoje', p: 1 }, { startMs: 6500, endMs: 7000, text: 'artigo', p: 1 }] }),
      seg('s_ccccc', 9000, 12000, 'É importante.'),
    ],
    folded: {}, updatedAt: '2026-11-03T12:00:00.000Z', ...over,
  };
}

let n = 0;
const hlc = (ms: number, node = 'ab4z76w') => `${String(ms).padStart(15, '0')}-00000-${node}`;
const stamp = (ms: number, t: TranscriptFile = transcript(), node = 'ab4z76w'): EditStamp => ({
  id: `01JBX4Q7Z5W8M2E3C9R6T0Y${String(n++ % 1000).padStart(3, '0')}`.replace(/[ILOU]/g, '0'), hlc: hlc(ms, node), ms, memberId: MEMBER, transcript: t,
});
const log = (deviceId: string, ...lines: TranscriptEditLine[]): EditLog => ({ deviceId, lines });

describe('edit lines (folder spec §8.9)', () => {
  it('builds well-formed lines of each operation', () => {
    const t = transcript();
    const lines = [
      setTextOp(stamp(1), 's_aaaaa', 'Bom dia a todos.', ' Bom dia, a todos. '),
      setSpeakerOp(stamp(2), 's_aaaaa', 'me'),
      splitOp(stamp(3), 's_bbbbb', 18, 6200.4, 's_ddddd'),
      mergeOp(stamp(4), 's_aaaaa', 's_bbbbb'),
      labelSpeakerOp(stamp(5), 'lecture', '  Prof.ª   Marta Reis  '),
    ];
    for (const l of lines) expect(validEditLine(l, t)).toBe(true);
    expect(lines[0]).toMatchObject({ format: 'tramado.transcript-edit', version: 1, lectureId: LECTURE, round: 1, baseRevision: 1, base: sha1Hex('Bom dia a todos.'), text: 'Bom dia, a todos.' });
    expect(lines[2]!.atMs).toBe(6200);
    expect(lines[4]!.label).toBe('Prof.ª Marta Reis');
    expect(validEditLine({ ...lines[0]!, round: 2 }, t)).toBe(false);
    expect(validEditLine({ ...lines[1]!, speaker: 'Teacher' }, t)).toBe(false);
    expect(validEditLine({ ...lines[4]!, label: 'x'.repeat(41) }, t)).toBe(false);
    expect(validEditLine({ ...lines[2]!, newId: 'bad' }, t)).toBe(false);
  });

  it('puts a split at the word after the caret, or by proportion', () => {
    const t = transcript();
    expect(splitTime(t.segments[1]!, 18)).toBe(6500);   // the next word, "artigo", starts at 20 and at 6.5 s
    expect(splitTime(t.segments[0]!, 8)).toBe(2000);    // no words: halfway through 16 characters
  });

  it('knows SHA-1', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('a'.repeat(1000))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba');
    expect(textBase('Código')).toBe(sha1Hex(new TextEncoder().encode('Código')));
  });
});

describe('effective transcript (folder spec §8.9)', () => {
  it('set_text replaces the text (last writer wins) and drops stale word times', () => {
    const t = transcript();
    const e = effective(t, [log(ANA, setTextOp(stamp(10), 's_bbbbb', t.segments[1]!.text, 'Hoje: artigo 483.º do Código Civil.'))]);
    const s = findSegment(e, 's_bbbbb')!;
    expect(s.text).toBe('Hoje: artigo 483.º do Código Civil.');
    expect(s.words).toBeUndefined();
    expect(s.editHlc).toEqual({ text: hlc(10) });
    expect(e.concurrent).toEqual([]);
    expect(e.unfolded).toBe(1);
    // An older line arriving later loses; ties are broken by device ID, then line order.
    const older = setTextOp(stamp(5, t, 'tkbnv23'), 's_bbbbb', t.segments[1]!.text, 'Older.');
    const both = effective(t, [log(BRUNO, older), log(ANA, setTextOp(stamp(10), 's_bbbbb', t.segments[1]!.text, 'Newer.'))]);
    expect(findSegment(both, 's_bbbbb')!.text).toBe('Newer.');
  });

  it('flags two corrections made from the same text, until someone corrects the current one', () => {
    const t = transcript();
    const base = t.segments[2]!.text;
    const a = setTextOp(stamp(10), 's_ccccc', base, 'É muito importante.');
    const b = setTextOp(stamp(11, t, 'tkbnv23'), 's_ccccc', base, 'Isto é importante.');
    const e = effective(t, [log(ANA, a), log(BRUNO, b)]);
    expect(findSegment(e, 's_ccccc')!.text).toBe('Isto é importante.');
    expect(e.concurrent).toEqual(['s_ccccc']);
    const keep = setTextOp(stamp(12), 's_ccccc', 'Isto é importante.', 'Isto é importante.');
    expect(effective(t, [log(ANA, a, keep), log(BRUNO, b)]).concurrent).toEqual([]);
  });

  it('set_speaker changes the speaker and lists a new speaker id with its default label', () => {
    const t = transcript();
    const e = effective(t, [log(ANA, setSpeakerOp(stamp(10), 's_aaaaa', 'spk_1'))]);
    expect(findSegment(e, 's_aaaaa')!.speaker).toBe('spk_1');
    expect(e.speakers).toEqual([{ id: 'lecture', label: 'Professor' }, { id: 'spk_1', label: 'Orador 1' }]);
  });

  it('split cuts the text at a UTF-16 offset, the time at atMs, and splits word times', () => {
    const t = transcript();
    const e = effective(t, [log(ANA, splitOp(stamp(10), 's_bbbbb', 20, 6500, 's_ddddd'))]);
    expect(e.segments.map((s) => [s.id, s.startMs, s.endMs, s.text])).toEqual([
      ['s_aaaaa', 0, 4000, 'Bom dia a todos.'],
      ['s_bbbbb', 4000, 6500, 'Hoje vamos falar do'],
      ['s_ddddd', 6500, 9000, 'artigo 483.º do Código Civil.'],
      ['s_ccccc', 9000, 12000, 'É importante.'],
    ]);
    expect(findSegment(e, 's_bbbbb')!.words!.map((w) => w.text)).toEqual(['Hoje']);
    expect(findSegment(e, 's_ddddd')!.words!.map((w) => w.text)).toEqual(['artigo']);
    // A split at the edge, or with an id already used, is dropped.
    const { info } = replay(t, [log(ANA, splitOp(stamp(11), 's_aaaaa', 0, 10, 's_eeeee'), splitOp(stamp(12), 's_aaaaa', 4, 10, 's_ccccc'))]);
    expect(info.dropped.map((d) => d.reason)).toEqual(['invalid split', 'invalid split']);
  });

  it('merge joins the following segment and redirects its id', () => {
    const t = transcript();
    const { transcript: e, info } = replay(t, [log(ANA, mergeOp(stamp(10), 's_bbbbb', 's_ccccc'))]);
    expect(e.segments.map((s) => s.id)).toEqual(['s_aaaaa', 's_bbbbb']);
    const b = findSegment(e, 's_ccccc')!;
    expect(b.id).toBe('s_bbbbb');
    expect(b).toMatchObject({ endMs: 12000, text: 'Hoje vamos falar do artigo 483.º do Código Civil. É importante.', merged: ['s_ccccc'] });
    expect(b.words).toBeUndefined();   // only one side had word times
    expect(info.redirects).toEqual({ s_ccccc: 's_bbbbb' });
  });

  it('follows merged redirects for later edits, also across merges written in the file', () => {
    const t = transcript();
    t.segments[0]!.merged = ['s_zzzzz'];
    const e = effective(t, [log(ANA,
      mergeOp(stamp(10), 's_aaaaa', 's_bbbbb'),
      setTextOp(stamp(11), 's_bbbbb', 'whatever', 'Corrigido.'),     // targets the merged-away id
      setSpeakerOp(stamp(12), 's_zzzzz', 'me'),                       // targets an id merged before the file was written
    )]);
    const a = findSegment(e, 's_aaaaa')!;
    expect(a.text).toBe('Corrigido.');
    expect(a.speaker).toBe('me');
    expect(a.merged).toEqual(['s_zzzzz', 's_bbbbb']);
    expect(e.concurrent).toEqual(['s_aaaaa']);   // the editor did not see the merged text
  });

  it('label_speaker renames a speaker (last writer wins)', () => {
    const t = transcript();
    const e = effective(t, [log(BRUNO, labelSpeakerOp(stamp(12, t, 'tkbnv23'), 'lecture', 'Prof.ª Reis')), log(ANA, labelSpeakerOp(stamp(10), 'lecture', 'Marta'))]);
    expect(e.speakers).toEqual([{ id: 'lecture', label: 'Prof.ª Reis' }]);
  });

  it('ignores other rounds, folded lines, other lectures and malformed lines', () => {
    const t = transcript({ round: 2, folded: { [ANA]: hlc(20) } });
    const t1 = transcript({ round: 1 });
    const lines = [
      setTextOp(stamp(30, t1), 's_aaaaa', 'x', 'Round one.'),                     // round 1
      setTextOp(stamp(15, t), 's_aaaaa', 'x', 'Already folded.'),                 // ≤ folded[ANA]
      { ...setTextOp(stamp(31, t), 's_aaaaa', 'x', 'Other lecture.'), lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2Z' },
      { ...setTextOp(stamp(32, t), 's_aaaaa', 'x', 'Bad.'), segment: 'nope' },
    ];
    const e = effective(t, [log(ANA, ...lines)]);
    expect(findSegment(e, 's_aaaaa')!.text).toBe('Bom dia a todos.');
    expect(e.unfolded).toBe(0);
    // The same lines count for another device's log only if they are above that device's folded mark.
    expect(effective(t, [log(BRUNO, setTextOp(stamp(15, t, 'tkbnv23'), 's_aaaaa', 'Bom dia a todos.', 'Bruno.'))]).segments[0]!.text).toBe('Bruno.');
  });

  it('drops a line whose segment is gone, reports stale audio and newer files', () => {
    const t = transcript();
    const { transcript: e, info } = replay(t, [log(ANA, setTextOp(stamp(10), 's_qqqqq', '', 'x'))], { audioSha256: 'b'.repeat(64) });
    expect(info.dropped).toEqual([{ deviceId: ANA, id: expect.any(String), op: 'set_text', reason: 'segment missing' }]);
    expect(e.stale).toBe(true);
    expect(effective(t, [], { audioSha256: null }).stale).toBe(false);
    expect(effective(t, [log(ANA, setTextOp(stamp(10), 's_aaaaa', '', 'x'))], { newer: true })).toMatchObject({ newer: true, unfolded: 0 });
  });

  it('tells which devices touched which segments', () => {
    const t = transcript();
    const { info } = replay(t, [
      log(ANA, setTextOp(stamp(10), 's_aaaaa', 'Bom dia a todos.', 'Bom dia.')),
      log(BRUNO, setSpeakerOp(stamp(11, t, 'tkbnv23'), 's_aaaaa', 'me'), mergeOp(stamp(12, t, 'tkbnv23'), 's_bbbbb', 's_ccccc')),
    ]);
    expect(info.touched).toEqual({ s_aaaaa: [ANA, BRUNO].sort(), s_bbbbb: [BRUNO] });
    expect(info.foldedTo).toEqual({ [ANA]: hlc(10), [BRUNO]: hlc(12, 'tkbnv23') });
  });
});

describe('fold (owner only)', () => {
  it('writes the effective transcript as revision + 1 with the folded marks, idempotently', () => {
    const t = { ...transcript(), futureField: { keep: true } } as TranscriptFile;
    const logs = [
      log(ANA, setTextOp(stamp(10), 's_aaaaa', 'Bom dia a todos.', 'Bom dia, turma.')),
      log(BRUNO, splitOp(stamp(11, t, 'tkbnv23'), 's_bbbbb', 20, 6500, 's_ddddd'), labelSpeakerOp(stamp(12, t, 'tkbnv23'), 'lecture', 'Prof.ª Reis')),
    ];
    const r = fold(t, logs, { at: '2026-11-03T13:00:00.000Z' })!;
    const f = r.transcript;
    expect(f).toMatchObject({ revision: 2, folded: { [ANA]: hlc(10), [BRUNO]: hlc(12, 'tkbnv23') }, updatedAt: '2026-11-03T13:00:00.000Z', speakers: [{ id: 'lecture', label: 'Prof.ª Reis' }] });
    expect((f as unknown as { futureField: unknown }).futureField).toEqual({ keep: true });
    expect(f.segments.map((s) => s.text)).toEqual(['Bom dia, turma.', 'Hoje vamos falar do', 'artigo 483.º do Código Civil.', 'É importante.']);
    expect(JSON.stringify(f)).not.toContain('concurrent');
    // Replaying the same logs on the folded file changes nothing, and there is nothing left to fold.
    expect(effective(f, logs).segments).toEqual(f.segments);
    expect(fold(f, logs, { at: '2026-11-03T14:00:00.000Z' })).toBeNull();
    // A later line still applies on top.
    const more = [...logs, log(ANA, setTextOp(stamp(20), 's_ddddd', 'artigo 483.º do Código Civil.', 'o artigo 483.º.'))];
    expect(findSegment(effective(f, more), 's_ddddd')!.text).toBe('o artigo 483.º.');
  });

  it('lets a new owner take the transcript over (fold claim, sync spec §14.8)', () => {
    const t = transcript();
    const r = fold(t, [], { at: '2026-11-03T13:00:00.000Z', writer: { deviceId: BRUNO, memberId: 'b6xq2l4p7vjk3m5n2c7hzr4wte' } })!;
    expect(r.transcript.writer).toEqual({ deviceId: BRUNO, memberId: 'b6xq2l4p7vjk3m5n2c7hzr4wte' });
    expect(r.transcript.revision).toBe(2);
    expect(r.transcript.transcribedBy.deviceId).toBe(ANA);
  });
});
