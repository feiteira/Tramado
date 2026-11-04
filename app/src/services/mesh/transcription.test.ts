// Mesh (gate G1): the real TranscriptionQueue (T-LECTURES) over the real ClaimEngine (T-SYNC), two devices with
// a fake speech platform each, one shared lecture. Both volunteer; exactly one transcribes, exactly one
// transcript.json reaches both, and no conflict copy or second working claim is left. Fictional people only.
import { describe, expect, it } from 'vitest';
import { itemIdOf, newNonce } from '../../core/model/derive';
import type { ClaimFile, LectureFile, TranscriptFile } from '../../core/model/files';
import { instant } from '../../core/model/time';
import { mulberry32 } from '../../core/util/prng';
import { sha256Hex } from '../../core/util/sha256';
import { createFakeSpeech, type FakeSpeech } from '../../platform/memory/speech';
import type { MemoryMesh } from '../../platform/memory/mesh';
import type { ClassStoreImpl } from '../classStore';
import type { LectureServiceImpl } from '../lectures';
import type { TranscriptionQueueImpl } from '../transcription';
import { dec, meshApp, newMesh, settle, sharedClass, type MeshApp } from './harness.testutil';

const DIR = 'Aulas/2026-11-03 1000 Aula 8 — Estado de exceção';
const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 7, 7, 7, 7]);

async function device(mesh: MemoryMesh, name: string): Promise<{ app: MeshApp; speech: FakeSpeech }> {
  let clock: { now(): number } | null = null;
  const speech = createFakeSpeech({ now: () => clock?.now() ?? 0, jobMs: 8_000, seed: name.length });
  const platform = mesh.device(name, { speech });
  clock = mesh.clock(name);
  speech.bind(platform);
  // Mains power, so "plugged" volunteers (the memory platform reports 'unknown', which also counts as mains).
  const app = await meshApp(mesh, name, platform);
  await app.ctx.prefs.set('speech.volunteerAsked', '1');
  return { app, speech };
}

/** Ana records and publishes the lecture (lecture.json + audio.webm, as RecordingService does). */
async function publishLecture(ana: MeshApp, classId: string): Promise<string> {
  const ms = ana.ctx.clock.now() - 2 * 3_600_000;
  const nonce = newNonce(mulberry32(11));
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

/**
 * Advances every clock and every fake speech platform by `ms`, in steps, letting the mesh and the class stores
 * settle. The queues are not awaited here: a claim round waits on mesh time (§14.5 settle), which only moves on.
 */
async function run(mesh: MemoryMesh, devices: Array<{ app: MeshApp; speech: FakeSpeech }>, classId: string, ms: number, step = 2_500) {
  for (let t = 0; t < ms; t += step) {
    await mesh.advance(step);
    for (const d of devices) d.speech.tick(step);
    await mesh.settle();
    for (const d of devices) await (d.app.services.forClass(classId).store as ClassStoreImpl).idle();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('mesh: transcription queue over the claim engine (G1)', () => {
  it('two volunteers, one lecture: exactly one transcript, one done claim, no conflict copy', async () => {
    const mesh = newMesh();
    const a = await device(mesh, 'ana');
    const b = await device(mesh, 'bruno');
    const devices = [a, b];
    const apps = devices.map((d) => d.app);
    const classId = await sharedClass(mesh, a.app, [b.app]);
    const lectureId = await publishLecture(a.app, classId);
    await settle(mesh, apps);
    for (const d of devices) await d.app.services.transcription.start();
    await settle(mesh, apps, 2);

    // Both devices see an eligible, unclaimed lecture and start their capability delays (60 s + ≤ 15 s jitter).
    for (const d of devices) {
      expect(d.app.services.transcription.state.get()).toMatchObject({ volunteerEffective: 'plugged' });
      expect(d.app.services.transcription.state.get().lectures).toEqual([expect.objectContaining({ lectureId, eligible: true })]);
    }

    // The delays run out, the claim round settles, the winner's job runs and publishes.
    await run(mesh, devices, classId, 6 * 60_000);
    await settle(mesh, apps);

    const claimsOf = (d: MeshApp) =>
      [...mesh.files(d.name, classId)].filter(([p]) => p.startsWith(`.tramado/claims/${lectureId}/`)).map(([, bytes]) => JSON.parse(dec(bytes)) as ClaimFile);
    for (const d of apps) {
      const files = mesh.files(d.name, classId);
      const transcript = files.get(`${DIR}/transcript.json`);
      expect(transcript, `${d.name} has transcript.json`).toBeDefined();
      expect(files.has(`${DIR}/transcript.md`) && files.has(`${DIR}/transcript.vtt`)).toBe(true);
      expect([...files.keys()].filter((p) => p.includes('sync-conflict'))).toEqual([]);
      const claims = claimsOf(d);
      expect(claims.filter((c) => c.status === 'done')).toHaveLength(1);
      expect(claims.filter((c) => c.status === 'working' || c.status === 'claimed')).toEqual([]);
    }
    // The same bytes everywhere, written by the device whose claim is done.
    const [ta, tb] = apps.map((d) => dec(mesh.files(d.name, classId).get(`${DIR}/transcript.json`)));
    expect(ta).toBe(tb);
    const t = JSON.parse(ta!) as TranscriptFile;
    const done = claimsOf(a.app).find((c) => c.status === 'done')!;
    expect(t).toMatchObject({ lectureId, round: 1, revision: 1, audioSha256: sha256Hex(AUDIO), writer: { deviceId: done.deviceId } });
    // Exactly one device ran a job.
    expect(devices.map((d) => d.speech.requests.transcribe.length).sort()).toEqual([0, 1]);
    // Both lecture lists show it as transcribed, and no queue still offers it.
    for (const d of apps) {
      expect((d.services.forClass(classId).lectures as LectureServiceImpl).list.get().find((l) => l.id === lectureId)!.transcription).toMatchObject({ kind: 'done' });
      expect(d.services.transcription.state.get().job).toBeNull();
      expect(d.services.transcription.state.get().lectures.filter((l) => l.lectureId === lectureId)).toEqual([]);
    }
    for (const d of devices) (d.app.services.transcription as TranscriptionQueueImpl).dispose();
  }, 120_000);

  it('both press "Transcribe" at once: one wins the round, the other\'s job never starts', async () => {
    const mesh = newMesh();
    const a = await device(mesh, 'ana');
    const b = await device(mesh, 'bruno');
    const devices = [a, b];
    const apps = devices.map((d) => d.app);
    const classId = await sharedClass(mesh, a.app, [b.app]);
    const lectureId = await publishLecture(a.app, classId);
    await settle(mesh, apps);
    for (const d of apps) {
      await (d.services.forClass(classId).lectures as LectureServiceImpl).refresh();
      await (d.services.transcription as TranscriptionQueueImpl).evaluate();
    }
    const both = Promise.all(apps.map((d) => d.services.transcription.claim(classId, lectureId, 'local')));
    await run(mesh, devices, classId, 60_000, 1_000);
    const outcomes = await both;
    expect([...outcomes].sort()).toEqual(['lost', 'won']);
    await run(mesh, devices, classId, 60_000);
    await settle(mesh, apps);
    expect(devices.map((d) => d.speech.requests.transcribe.length).sort()).toEqual([0, 1]);
    const [ta, tb] = apps.map((d) => mesh.files(d.name, classId).get(`${DIR}/transcript.json`));
    expect(ta && tb && dec(ta) === dec(tb)).toBe(true);
    const winner = apps[outcomes.indexOf('won')]!;
    expect((JSON.parse(dec(ta)) as TranscriptFile).writer.deviceId).toBe(winner.deviceId);
    for (const d of apps) expect([...mesh.files(d.name, classId).keys()].filter((p) => p.includes('sync-conflict'))).toEqual([]);
    for (const d of devices) (d.app.services.transcription as TranscriptionQueueImpl).dispose();
  }, 120_000);
});
