import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyPath, classPathProblem, isValidClassPath, parseConflictName, validateClassPath, writerFromPath } from './paths';

const V = JSON.parse(readFileSync(new URL('../../../../test-vectors/class-paths.json', import.meta.url), 'utf8')) as {
  valid: string[];
  invalid: Array<{ path: string; why: string }>;
  tsOnly: Array<{ path: string; normalised: string }>;
};
const DEV = 'WSGDTBE-PYLFPIJ-JSGOJZC-CJC6O2N-ARA52TT-HKVPG6S-UVZH2AZ-RUULKAI';
const LECTURE = '01JBX4Q7Z5W8M2E3C9R6T0YH2K';

describe('class paths (test-vectors/class-paths.json)', () => {
  it('accepts every valid path', () => {
    for (const p of V.valid) expect(classPathProblem(p), p).toBeNull();
  });
  it('refuses every invalid path', () => {
    for (const c of V.invalid) {
      expect(isValidClassPath(c.path), `${JSON.stringify(c.path)} (${c.why})`).toBe(false);
      expect(() => validateClassPath(c.path)).toThrow();
    }
  });
  it('normalises NFD to NFC (TS only)', () => {
    for (const c of V.tsOnly) expect(validateClassPath(c.path)).toBe(c.normalised);
  });
});

describe('classifyPath', () => {
  it('names the writer of per-device machine files', () => {
    expect(classifyPath('.tramado/class.json').kind).toBe('classFile');
    expect(classifyPath(`.tramado/meta/${DEV}.json`)).toEqual({ kind: 'meta', deviceId: DEV });
    expect(classifyPath(`.tramado/members/${DEV}.json`).kind).toBe('members');
    expect(classifyPath(`.tramado/consent/${DEV}.jsonl`).kind).toBe('consent');
    expect(classifyPath(`.tramado/chat/${DEV}/2026-11.jsonl`)).toEqual({ kind: 'chat', deviceId: DEV, month: '2026-11' });
    expect(classifyPath(`.tramado/claims/${LECTURE}/${DEV}.json`)).toEqual({ kind: 'claims', deviceId: DEV, objectId: LECTURE, fold: false });
    expect(classifyPath(`.tramado/claims/${LECTURE}.fold/${DEV}.json`).fold).toBe(true);
    expect(classifyPath(`.tramado/edits/${LECTURE}/${DEV}.jsonl`)).toEqual({ kind: 'edits', deviceId: DEV, objectId: LECTURE });
    expect(classifyPath(`.tramado/exam-edits/${LECTURE}/${DEV}.jsonl`).kind).toBe('examEdits');
    expect(classifyPath(`.tramado/answers/${LECTURE}/${DEV}.json`).kind).toBe('answers');
    expect(classifyPath(`.tramado/markers/${LECTURE}/${DEV}.json`).kind).toBe('markers');
    expect(classifyPath(`.tramado/bans/${DEV}.json`).kind).toBe('bans');
    expect(classifyPath(`.tramado/mod/${DEV}.jsonl`).kind).toBe('mod');
    expect(writerFromPath(`.tramado/presence/${DEV}.json`)).toBe(DEV);
    expect(classifyPath('.tramado/meta/not-a-device.json').kind).toBe('tramadoOther');
    expect(classifyPath(`.tramado/chat/${DEV}/2026-13.jsonl`).kind).toBe('tramadoOther');
    expect(classifyPath('.tramado/tmp/a.part').kind).toBe('skipped');
  });

  it('finds manifests, conflicts and skipped names anywhere', () => {
    expect(classifyPath('Renamed/whatever/lecture.json').kind).toBe('lectureManifest');
    expect(classifyPath('Aulas/x/transcript.vtt').kind).toBe('transcriptVtt');
    expect(classifyPath('Aulas/x/audio.webm').kind).toBe('audio');
    expect(classifyPath('Exames/y/exam.json').kind).toBe('examManifest');
    expect(classifyPath('Notas/shared.sync-conflict-20261103-155644-TKBNV23.md')).toEqual({ kind: 'conflictCopy', conflictOf: 'Notas/shared.md' });
    expect(classifyPath('Docs/a.tmp').kind).toBe('skipped');
    expect(classifyPath('.stversions/a.pdf').kind).toBe('skipped');
    expect(classifyPath('Documentos/Código Civil.pdf').kind).toBe('content');
    expect(parseConflictName('a.sync-conflict-20261103-155644-TKBNV23')).toEqual({ original: 'a', date: '20261103', time: '155644', by: 'TKBNV23' });
  });
});
