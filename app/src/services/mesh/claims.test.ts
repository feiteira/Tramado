// Mesh: the claim engine (sync spec §14.9 required tests). A tiny transcription driver stands in for the
// transcription queue (T-LECTURES) and for Rust's heartbeat while a job runs: it claims, heartbeats every 60 s,
// writes transcript.json then `done`, yields onLost, re-claims on re-evaluation, and does the owner duties.
import { describe, expect, it } from 'vitest';
import { itemIdOf, newNonce } from '../../core/model/derive';
import { instant } from '../../core/model/time';
import { mulberry32 } from '../../core/util/prng';
import { HEARTBEAT_MS, SETTLE_MS, STALE_MS } from '../../core/sync/claims';
import type { LectureFile, TranscriptFile } from '../../core/model/files';
import type { ClaimEngineImpl } from '../claims';
import type { ClassStoreImpl } from '../classStore';
import { dec, meshApp, newMesh, settle, sharedClass, type MeshApp } from './harness.testutil';
import type { MemoryMesh } from '../../platform/memory/mesh';

const SHA = 'a'.repeat(64);
const DIR = 'Aulas/2026-11-03 1000 Aula 8';

async function lecture(owner: MeshApp, classId: string): Promise<string> {
  const ms = owner.ctx.clock.now() - 5_000_000;
  const nonce = newNonce(mulberry32(3));
  const id = itemIdOf(ms, owner.deviceId, nonce);
  const lf: LectureFile = {
    format: 'tramado.lecture', version: 1, id, idNonce: nonce, title: 'Aula 8 — Estado de exceção', startedAt: instant(ms), durationMs: 4_680_000,
    mode: 'room', language: 'pt-PT', recordedBy: { memberId: owner.memberId, deviceId: owner.deviceId, name: 'Ana Ribeiro' },
    audio: { file: 'audio.webm', shared: true, codec: 'opus', container: 'webm', sampleRate: 16000, channels: 1, bitrate: 24000, size: 10, sha256: SHA },
    channels: [{ index: 0, speaker: 'lecture' }], pauses: [], consent: [], updatedAt: instant(ms),
  };
  await owner.services.forClass(classId).store.writeJson(`${DIR}/lecture.json`, lf, { own: true, manifest: true });
  return id;
}

function transcriber(app: MeshApp, classId: string, lectureId: string, opts: { jobMs: number; delayMs: number }) {
  const cls = app.services.forClass(classId);
  const engine = cls.claims as ClaimEngineImpl;
  const clock = app.ctx.clock;
  let running: Array<() => void> = [];
  let result: TranscriptFile | null = null;
  const stop = () => {
    running.forEach((c) => c());
    running = [];
  };
  const writeTranscript = async () => {
    result ??= {
      format: 'tramado.transcript', version: 1, lectureId, round: 1, revision: 1, audioSha256: SHA, language: 'pt-PT',
      writer: { deviceId: app.deviceId, memberId: app.memberId }, transcribedBy: { deviceId: app.deviceId, memberId: app.memberId, name: app.name, at: instant(clock.now()) },
      engine: { kind: 'local', name: 'whisper.cpp', modelId: 'turbo' }, speakers: [{ id: 'lecture', label: 'Professora' }],
      segments: [{ id: 's_aaaaa', startMs: 0, endMs: 1000, speaker: 'lecture', text: `por ${app.name}` }], folded: {}, updatedAt: instant(clock.now()),
    };
    await cls.store.writeJson(`${DIR}/transcript.json`, result, { own: true });
    for (const p of cls.store.state.get().index.conflicts.map((c) => c.path)) if (p.startsWith(`${DIR}/transcript.sync-conflict-`)) await cls.store.remove(p).catch(() => undefined);
  };
  const start = () => {
    let progress = 0;
    const beat = () => {
      running.push(clock.setTimeout(() => {
        progress = Math.min(0.99, progress + 0.1);
        void engine.setStatus(lectureId, 'transcribe', { progress }).catch(() => undefined);
        beat();
      }, HEARTBEAT_MS));
    };
    beat();
    running.push(clock.setTimeout(() => {
      stop();
      void (async () => {
        if (engine.winner(lectureId, 'transcribe')?.deviceId !== app.deviceId) return;
        await writeTranscript();
        await engine.setStatus(lectureId, 'transcribe', { status: 'done', transcriptRevision: 1 });
      })();
    }, opts.jobMs));
  };
  const attempt = async () => {
    const r = await engine.tryClaim(lectureId, 'transcribe', { engine: { kind: 'local', model: 'turbo' }, audioSha256: SHA, supersedeStale: true });
    if (r === 'won') start();
    return r;
  };
  engine.onLost(lectureId, stop);
  engine.onReevaluate((l) => {
    if (l === lectureId) running.push(clock.setTimeout(() => void attempt(), opts.delayMs));
  });
  // Owner duties after done (§14.5): a winning done claim whose transcript is someone else's rewrites it.
  const duties = () => {
    const w = engine.winner(lectureId, 'transcribe');
    if (!w?.mine || w.status !== 'done' || !result) return;
    void cls.store.readBytes(`${DIR}/transcript.json`).then(async (b) => {
      if (!b || JSON.parse(dec(b)).writer?.deviceId !== app.deviceId) await writeTranscript();
      else for (const p of cls.store.state.get().index.conflicts.map((c) => c.path)) if (p.startsWith(`${DIR}/transcript.sync-conflict-`)) await cls.store.remove(p).catch(() => undefined);
    });
  };
  engine.claims(lectureId, 'transcribe').subscribe(duties);
  cls.store.onChange(['conflict', 'transcript'], duties);
  return { attempt, engine };
}

const working = (apps: MeshApp[], mesh: MemoryMesh, classId: string, lectureId: string) =>
  apps.filter((a) => mesh.isUp(a.name)).map((a) => (a.services.forClass(classId).claims as ClaimEngineImpl).winner(lectureId, 'transcribe'))
    .filter((w) => w?.mine && w.status === 'working').length;

describe('mesh: transcription claims', () => {
  it('one winner; the winner crashes; exactly one other device takes over (§14.3)', async () => {
    const mesh = newMesh();
    const [ana, bruno, carla] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno'), await meshApp(mesh, 'carla')];
    const apps = [ana, bruno, carla];
    const classId = await sharedClass(mesh, ana, [bruno, carla]);
    const lectureId = await lecture(ana, classId);
    await settle(mesh, apps);
    const t = apps.map((a, i) => transcriber(a, classId, lectureId, { jobMs: 40 * 60_000, delayMs: 60_000 + i * 5_000 }));
    // Everyone claims at once.
    const results = Promise.all(t.map((x) => x.attempt()));
    for (let i = 0; i < 10; i++) {
      await mesh.settle();
      await mesh.advance(SETTLE_MS / 4);
    }
    const r = await results;
    expect(r.filter((x) => x === 'won')).toHaveLength(1);
    const first = apps[r.indexOf('won')]!;
    await settle(mesh, apps);
    expect(working(apps, mesh, classId, lectureId)).toBe(1);
    // The winner's computer dies.
    mesh.crash(first.name);
    first.services.dispose();
    const rest = apps.filter((a) => a !== first);
    for (let elapsed = 0; elapsed < STALE_MS + 200_000; elapsed += 30_000) {
      await mesh.settle();
      await mesh.advance(30_000);
      expect(working(rest, mesh, classId, lectureId)).toBeLessThanOrEqual(1);
    }
    await settle(mesh, rest);
    expect(working(rest, mesh, classId, lectureId)).toBe(1);
  }, 120_000);

  it('a partition lets both finish; after the heal one transcript, no conflict copy, no rewrite loop', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const apps = [ana, bruno];
    const classId = await sharedClass(mesh, ana, [bruno]);
    const lectureId = await lecture(ana, classId);
    await settle(mesh, apps);
    mesh.partition(['ana'], ['bruno']);
    const t = apps.map((a) => transcriber(a, classId, lectureId, { jobMs: 10 * 60_000, delayMs: 60_000 }));
    const both = Promise.all(t.map((x) => x.attempt()));
    for (let i = 0; i < 20; i++) {
      await mesh.settle();
      await mesh.advance(SETTLE_MS);
    }
    expect(await both).toEqual(['won', 'won']);
    for (let i = 0; i < 25; i++) {
      await mesh.settle();
      await mesh.advance(30_000);
    }
    expect(JSON.parse(dec(mesh.files('ana', classId).get(`${DIR}/transcript.json`))).writer.deviceId).toBe(ana.deviceId);
    expect(JSON.parse(dec(mesh.files('bruno', classId).get(`${DIR}/transcript.json`))).writer.deviceId).toBe(bruno.deviceId);
    mesh.heal();
    await settle(mesh, apps, 10);
    const winner = (ana.services.forClass(classId).claims as ClaimEngineImpl).winner(lectureId, 'transcribe');
    expect(winner?.status).toBe('done');
    expect((bruno.services.forClass(classId).claims as ClaimEngineImpl).winner(lectureId, 'transcribe')?.deviceId).toBe(winner?.deviceId);
    const snapshot = () => apps.map((a) => [...mesh.files(a.name, classId)].filter(([p]) => p.startsWith(DIR) || p.startsWith('.tramado/claims')).map(([p, b]) => `${p}:${dec(b)}`).sort().join('\n'));
    const s1 = snapshot();
    for (const a of apps) {
      const files = [...mesh.files(a.name, classId).keys()];
      expect(files.filter((p) => p.includes('sync-conflict'))).toEqual([]);
      expect(JSON.parse(dec(mesh.files(a.name, classId).get(`${DIR}/transcript.json`))).writer.deviceId).toBe(winner?.deviceId);
      expect(files.filter((p) => p.startsWith(`.tramado/claims/${lectureId}/`))).toHaveLength(1);
    }
    for (let i = 0; i < 10; i++) await mesh.flush();
    await settle(mesh, apps, 3);
    expect(snapshot()).toEqual(s1);
    // Readers trust the winner's transcript (the writer change of the same round is accepted).
    const store = bruno.services.forClass(classId).store as ClassStoreImpl;
    const loaded = await store.readJson(`${DIR}/transcript.json`, (raw) => ({ ok: true, value: raw, newer: false, unknown: [] }));
    expect(loaded?.verdict.kind).toBe('trusted');
  }, 120_000);

  it('a done claim whose transcript is still arriving keeps everyone from re-transcribing (in_cluster)', async () => {
    const mesh = newMesh();
    const [ana, bruno] = [await meshApp(mesh, 'ana'), await meshApp(mesh, 'bruno')];
    const apps = [ana, bruno];
    const classId = await sharedClass(mesh, ana, [bruno]);
    const lectureId = await lecture(ana, classId);
    await settle(mesh, apps);
    mesh.holdBytes('bruno', classId, `${DIR}/transcript.json`);
    const ta = transcriber(ana, classId, lectureId, { jobMs: 5 * 60_000, delayMs: 60_000 });
    const tb = transcriber(bruno, classId, lectureId, { jobMs: 5 * 60_000, delayMs: 60_000 });
    const r = ta.attempt();
    for (let i = 0; i < 8; i++) {
      await mesh.settle();
      await mesh.advance(SETTLE_MS);
    }
    expect(await r).toBe('won');
    for (let i = 0; i < 15; i++) {
      await mesh.settle();
      await mesh.advance(30_000);
    }
    expect(mesh.files('bruno', classId).has(`${DIR}/transcript.json`)).toBe(false);
    // More than DONE_TRUST_MS later the done claim still counts, because the cluster has the transcript.
    for (let i = 0; i < 13; i++) {
      await mesh.settle();
      await mesh.advance(300_000);
    }
    await settle(mesh, apps, 2);
    expect(tb.engine.winner(lectureId, 'transcribe')).toMatchObject({ deviceId: ana.deviceId, status: 'done' });
    const again = tb.attempt();
    for (let i = 0; i < 6; i++) {
      await mesh.settle();
      await mesh.advance(SETTLE_MS);
    }
    expect(await again).toBe('lost');
  }, 120_000);
});
