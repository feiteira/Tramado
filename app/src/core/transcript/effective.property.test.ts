// Property tests of the effective transcript and the fold (folder spec §8.9): every reader computes the same
// transcript whatever order the edit logs arrive in, and folding a prefix of the edits (the owner folded, more
// edits came later) gives the same transcript as replaying everything on the unfolded file.
import { describe, expect, it } from 'vitest';
import type { Segment, TranscriptEditLine, TranscriptFile } from '../model/files';
import { mulberry32 } from '../util/prng';
import { labelSpeakerOp, mergeOp, setSpeakerOp, setTextOp, splitOp, type EditStamp } from './edits';
import { effective, type EditLog } from './effective';
import { fold } from './fold';

const RUNS = Number(process.env.TRAMADO_PROPERTY_RUNS ?? 150);
const DEVICES = [
  'AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2',
  'TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT',
  'LGTQI2N-C7CZ54U-LP7HIBQ-VR4TCWO-YY67AJF-SXWTCG5-QLJA5Q4-X4KTTQO',
];
const WORDS = ['artigo', 'dolo', 'culpa', 'nexo', 'dano', 'facto', 'ilícito', 'Código', 'norma', 'lei'];

function base(rand: () => number): TranscriptFile {
  const segments: Segment[] = [];
  let t = 0;
  for (let i = 0; i < 6; i++) {
    const words = Array.from({ length: 3 + Math.floor(rand() * 6) }, () => WORDS[Math.floor(rand() * WORDS.length)]!);
    segments.push({ id: `s_base${i}`, startMs: t, endMs: t + 4000, speaker: 'lecture', text: words.join(' ') });
    t += 4500;
  }
  return {
    format: 'tramado.transcript', version: 1, lectureId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', round: 1, revision: 1, audioSha256: null, language: 'pt-PT',
    writer: { deviceId: DEVICES[0]!, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg' }, transcribedBy: { deviceId: DEVICES[0]!, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', name: 'Ana', at: '2026-11-03T12:00:00.000Z' },
    engine: { kind: 'local', name: 'whisper.cpp' }, speakers: [{ id: 'lecture', label: 'Professor' }], segments, folded: {}, updatedAt: '2026-11-03T12:00:00.000Z',
  };
}

/** A random history: each line is made against the effective transcript its editor saw (sometimes a stale one). */
function history(rand: () => number, t: TranscriptFile): Array<{ deviceId: string; line: TranscriptEditLine }> {
  const out: Array<{ deviceId: string; line: TranscriptEditLine }> = [];
  let ms = 1_793_721_438_000;
  let ids = 0;
  const count = 2 + Math.floor(rand() * 14);
  for (let i = 0; i < count; i++) {
    const d = Math.floor(rand() * DEVICES.length);
    const deviceId = DEVICES[d]!;
    const node = deviceId.slice(0, 7).toLowerCase();
    ms += 1 + Math.floor(rand() * 3);   // HLCs grow; equal ms across devices happen too
    const stamp: EditStamp = { id: `01JBX4Q7Z5W8M2E3C9R6T${String(i).padStart(5, '0')}`, hlc: `${String(ms).padStart(15, '0')}-0000${Math.floor(rand() * 2)}-${node}`, ms, memberId: 'k3q7mzx2v4hbtnw5r6yjc2aefg', transcript: t };
    // A stale view now and then: the editor saw an older state.
    const seen = effective(t, logsOf(rand() < 0.2 ? out.slice(0, Math.floor(rand() * out.length)) : out));
    const segs = seen.segments;
    const s = segs[Math.floor(rand() * segs.length)]!;
    const pick = rand();
    let line: TranscriptEditLine;
    if (pick < 0.35) line = setTextOp(stamp, s.id, s.text, `${s.text} ${WORDS[Math.floor(rand() * WORDS.length)]}`.trim());
    else if (pick < 0.5) line = setSpeakerOp(stamp, s.id, rand() < 0.5 ? 'me' : 'spk_1');
    else if (pick < 0.7) line = splitOp(stamp, s.id, Math.max(1, Math.floor(rand() * s.text.length)), s.startMs + Math.floor((s.endMs - s.startMs) / 2), `s_new${ids++}`);
    else if (pick < 0.9) {
      const next = segs[segs.indexOf(s) + 1] ?? segs[0]!;
      line = mergeOp(stamp, s.id, next.id);
    } else line = labelSpeakerOp(stamp, 'lecture', `Prof ${Math.floor(rand() * 9)}`);
    out.push({ deviceId, line });
  }
  return out;
}

function logsOf(h: Array<{ deviceId: string; line: TranscriptEditLine }>): EditLog[] {
  const by = new Map<string, TranscriptEditLine[]>();
  for (const { deviceId, line } of h) by.set(deviceId, [...(by.get(deviceId) ?? []), line]);
  return [...by].map(([deviceId, lines]) => ({ deviceId, lines }));
}

const shape = (t: TranscriptFile) => ({
  speakers: t.speakers,
  segments: t.segments.map((s) => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, speaker: s.speaker, text: s.text, merged: s.merged ?? [] })),
});

describe('effective transcript properties', () => {
  it('does not depend on the order the logs arrive in', () => {
    for (let run = 0; run < RUNS; run++) {
      const rand = mulberry32(1000 + run);
      const t = base(rand);
      const logs = logsOf(history(rand, t));
      const want = shape(effective(t, logs));
      const shuffled = [...logs].sort(() => rand() - 0.5);
      expect(shape(effective(t, shuffled)), `run ${run}`).toEqual(want);
    }
  });

  it('folding the first edits and replaying the later ones gives the same transcript', () => {
    for (let run = 0; run < RUNS; run++) {
      const rand = mulberry32(5000 + run);
      const t = base(rand);
      const h = history(rand, t);
      const sorted = [...h].sort((a, b) => (a.line.hlc < b.line.hlc ? -1 : a.line.hlc > b.line.hlc ? 1 : a.deviceId < b.deviceId ? -1 : 1));
      const k = Math.floor(rand() * (sorted.length + 1));
      // The owner saw the lines up to the k-th (in HLC order) when it folded; each log is a prefix of its file.
      const cut = sorted.slice(0, k);
      const prefix = logsOf(h.filter((x) => cut.includes(x)));
      const folded = fold(t, prefix, { at: '2026-11-03T13:00:00.000Z' })?.transcript ?? t;
      const all = logsOf(h);
      expect(shape(effective(folded, all)), `run ${run}, k ${k}`).toEqual(shape(effective(t, all)));
      expect(fold(fold(t, all, { at: 'x' })?.transcript ?? t, all, { at: 'y' })).toBeNull();
    }
  });
});
