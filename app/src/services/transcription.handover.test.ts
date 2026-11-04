// Mesh (UI-LECTURES, plan §15 follow-up, sync spec §14.8): the transcript owner hand-over. Ana transcribes a lecture
// (she is its transcript owner), Bruno corrects a line, Ana leaves the class before folding it. Bruno's hourly check
// sees the trigger (the owner has no member file), wins a fold claim, rewrites transcript.json as its new writer
// with the correction folded, and Carla accepts the writer change. Fictional people only.
import { describe, expect, it } from 'vitest';
import { itemIdOf, newNonce } from '../core/model/derive';
import type { ClaimFile, LectureFile, TranscriptFile } from '../core/model/files';
import { instant } from '../core/model/time';
import { mulberry32 } from '../core/util/prng';
import { sha256Hex } from '../core/util/sha256';
import { createFakeSpeech, type FakeSpeech } from '../platform/memory/speech';
import type { MemoryMesh } from '../platform/memory/mesh';
import type { ClassStoreImpl } from './classStore';
import type { LectureServiceImpl } from './lectures';
import { dec, meshApp, newMesh, settle, sharedClass, type MeshApp } from './mesh/harness.testutil';
import { HOURLY_CHECK_MS, type TranscriptionQueueImpl } from './transcription';

const DIR = 'Aulas/2026-11-03 1000 Aula 8 — Estado de exceção';
const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9, 9, 9]);

async function device(mesh: MemoryMesh, name: string): Promise<{ app: MeshApp; speech: FakeSpeech }> {
  let clock: { now(): number } | null = null;
  const speech = createFakeSpeech({ now: () => clock?.now() ?? 0, jobMs: 8_000, seed: name.length });
  const platform = mesh.device(name, { speech });
  clock = mesh.clock(name);
  speech.bind(platform);
  const app = await meshApp(mesh, name, platform);
  // Nobody volunteers: only Ana's explicit claim transcribes.
  await app.ctx.prefs.set('speech.volunteerAsked', '1');
  await app.ctx.prefs.set('speech.volunteer', 'off');
  return { app, speech };
}

async function publishLecture(ana: MeshApp, classId: string): Promise<string> {
  const ms = ana.ctx.clock.now() - 2 * 3_600_000;
  const nonce = newNonce(mulberry32(23));
  const id = itemIdOf(ms, ana.deviceId, nonce);
  const lf: LectureFile = {
    format: 'tramado.lecture', version: 1, id, idNonce: nonce, title: 'Aula 8 — Estado de exceção', startedAt: instant(ms), durationMs: 4_680_000,
    mode: 'room', language: 'pt-PT', recordedBy: { memberId: ana.memberId, deviceId: ana.deviceId, name: 'Ana Ribeiro' },
    audio: { file: 'audio.webm', shared: true, codec: 'opus', container: 'webm', sampleRate: 16000, channels: 1, bitrate: 24000, size: AUDIO.length, sha256: sha256Hex(AUDIO) },
    channels: [{ index: 0, speaker: 'lecture' }], pauses: [], consent: [], updatedAt: instant(ms),
  };
  const store = ana.services.forClass(classId).store;
  await store.writeBytes(`${DIR}/audio.webm`, AUDIO, { own: true });
  await store.writeJson(`${DIR}/lecture.json`, lf, { own: true, manifest: true });
  return id;
}

async function run(mesh: MemoryMesh, devices: Array<{ app: MeshApp; speech: FakeSpeech }>, classId: string, ms: number, step = 2_500) {
  for (let t = 0; t < ms; t += step) {
    await mesh.advance(step);
    for (const d of devices) {
      if (!mesh.isUp(d.app.name)) continue;
      d.speech.tick(step);
    }
    await mesh.settle();
    for (const d of devices) {
      if (!mesh.isUp(d.app.name)) continue;
      try {
        await (d.app.services.forClass(classId).store as ClassStoreImpl).idle();
      } catch {
        // the class left this device
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}

const lecturesOf = (a: MeshApp, classId: string) => a.services.forClass(classId).lectures as LectureServiceImpl;
const transcriptOn = (mesh: MemoryMesh, name: string, classId: string) => {
  const b = mesh.files(name, classId).get(`${DIR}/transcript.json`);
  return b ? (JSON.parse(dec(b)) as TranscriptFile) : null;
};

describe('mesh: transcript owner hand-over (sync spec §14.8)', () => {
  it('a member with unfolded corrections takes over from an owner who left; the others accept the new writer', async () => {
    const mesh = newMesh();
    const a = await device(mesh, 'ana');
    const b = await device(mesh, 'bruno');
    const c = await device(mesh, 'carla');
    const devices = [a, b, c];
    const apps = devices.map((d) => d.app);
    const classId = await sharedClass(mesh, a.app, [b.app, c.app]);
    const lectureId = await publishLecture(a.app, classId);
    await settle(mesh, apps);

    // Ana transcribes it: she becomes the transcript owner.
    const claimed = a.app.services.transcription.claim(classId, lectureId, 'local');
    await run(mesh, devices, classId, 60_000, 1_000);
    expect(await claimed).toBe('won');
    await run(mesh, devices, classId, 60_000);
    await settle(mesh, apps);
    for (const d of apps) await lecturesOf(d, classId).refresh();
    const t1 = transcriptOn(mesh, 'carla', classId)!;
    expect(t1).toMatchObject({ revision: 1, writer: { deviceId: a.app.deviceId } });
    const first = t1.segments[0]!;

    // Bruno corrects the first line. Ana is the owner, but nothing has folded it yet.
    await lecturesOf(b.app, classId).edit.setText(lectureId, first.id, 'Bom dia a todos, corrigido.');
    await settle(mesh, apps);
    for (const d of apps) await lecturesOf(d, classId).refresh();
    expect(lecturesOf(c.app, classId).list.get()[0]!.transcription).toMatchObject({ kind: 'done', pendingEdits: 1 });

    // While the owner is still a member, the hourly check does nothing.
    expect(await (b.app.services.transcription as TranscriptionQueueImpl).hourly()).toEqual([]);

    // Ana leaves the class before her fold ran (her member file is deleted; her transcript stays).
    (a.app.services.transcription as TranscriptionQueueImpl).dispose();
    await a.app.services.sync.leave(classId, { afterwards: 'trash', deleteMyNotes: false });
    await settle(mesh, apps, 8);
    expect(mesh.files('bruno', classId).has(`.tramado/members/${a.app.deviceId}.json`)).toBe(false);
    await lecturesOf(b.app, classId).refresh();

    // Bruno's hourly check: the trigger fires, he wins the fold claim and folds as the new writer.
    const handOver = (b.app.services.transcription as TranscriptionQueueImpl).hourly();
    await run(mesh, [b, c], classId, 30_000, 1_000);
    expect(await handOver).toEqual([{ classId, lectureId, revision: 2 }]);
    await settle(mesh, [b.app, c.app], 8);

    for (const name of ['bruno', 'carla']) {
      const t = transcriptOn(mesh, name, classId)!;
      expect(t, name).toMatchObject({ revision: 2, writer: { deviceId: b.app.deviceId }, transcribedBy: { deviceId: a.app.deviceId } });
      expect(t.segments[0]!.text).toBe('Bom dia a todos, corrigido.');
      expect(t.folded[b.app.deviceId]).toBeDefined();
      const files = mesh.files(name, classId);
      expect([...files.keys()].filter((p) => p.includes('sync-conflict'))).toEqual([]);
      const fold = files.get(`.tramado/claims/${lectureId}.fold/${b.app.deviceId}.json`);
      expect(fold && (JSON.parse(dec(fold)) as ClaimFile)).toMatchObject({ kind: 'fold', status: 'done', transcriptRevision: 2 });
      expect(dec(files.get(`${DIR}/transcript.md`))).toContain('Bom dia a todos, corrigido.');
    }
    // Carla's view accepts the new writer: the corrected text, no pending correction, not untrusted.
    await lecturesOf(c.app, classId).refresh();
    const view = lecturesOf(c.app, classId).list.get()[0]!;
    expect(view.untrustedTranscript).toBe(false);
    expect(view.transcription).toMatchObject({ kind: 'done', revision: 2, pendingEdits: 0 });
    const detail = lecturesOf(c.app, classId).open(lectureId);
    await lecturesOf(c.app, classId).refresh();
    expect(detail.get()!.transcript!.segments[0]!.text).toBe('Bom dia a todos, corrigido.');
    // Bruno is now the owner: a later correction is folded by him (debounced), not taken over again.
    expect(lecturesOf(b.app, classId).open(lectureId).get()?.isOwner ?? (await lecturesOf(b.app, classId).refresh(), lecturesOf(b.app, classId).open(lectureId).get()!.isOwner)).toBe(true);
    expect(await (b.app.services.transcription as TranscriptionQueueImpl).hourly()).toEqual([]);
    for (const d of devices) (d.app.services.transcription as TranscriptionQueueImpl).dispose();
  }, 180_000);

  it('checks every hour once started', () => {
    expect(HOURLY_CHECK_MS).toBe(3_600_000);
  });
});
