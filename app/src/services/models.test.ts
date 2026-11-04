import { describe, expect, it } from 'vitest';
import { createFakeSpeech } from '../platform/memory/speech';
import { createServices } from './index';
import type { ModelsServiceImpl } from './models';
import { createTestContext } from './testing/context';

async function setup(model: 'ready' | 'missing' | 'downloading', cpuOk = true) {
  const speech = createFakeSpeech({ model, cpuOk });
  const t = await createTestContext({ name: 'Ana Ribeiro', speech });
  const services = createServices(t.ctx);
  const models = services.models as ModelsServiceImpl;
  await models.ready();
  return { ...t, speech, services, models };
}

const stateOf = (m: ModelsServiceImpl, id: string) => m.models.get().find((x) => x.id === id)!;

describe('ModelsService', () => {
  it('downloads a model with progress, verifies it and makes it ready', async () => {
    const { models, speech } = await setup('missing');
    expect(models.models.get().map((m) => [m.id, m.state])).toEqual([['turbo', 'absent'], ['small', 'absent'], ['large-v3', 'absent']]);
    expect(models.info.get()).toMatchObject({ cpuOk: true, defaultModel: 'turbo' });
    await models.download('small');
    expect(models.downloads.get().small).toEqual({ done: 0, total: 190_000_000, bytesPerSec: 0 });
    speech.tick(10_000);
    expect(models.downloads.get().small).toEqual({ done: 24_000_000, total: 190_000_000, bytesPerSec: 2_400_000 });
    expect(stateOf(models, 'small')).toMatchObject({ state: 'downloading', bytes: 24_000_000 });
    speech.tick(100_000);
    expect(stateOf(models, 'small')).toMatchObject({ state: 'ready', bytes: 190_000_000, error: null });
    expect(models.downloads.get()).toEqual({});
  });

  it('cancels keeping the partial file, resumes, deletes, imports and sets the active model', async () => {
    const { models, speech, services, platform } = await setup('missing');
    await models.download('turbo');
    speech.tick(5_000);
    await models.cancel('turbo');
    expect(stateOf(models, 'turbo')).toMatchObject({ state: 'partial', bytes: 12_000_000 });
    await models.download('turbo');
    expect(models.downloads.get().turbo!.done).toBe(12_000_000);
    speech.tick(300_000);
    expect(stateOf(models, 'turbo').state).toBe('ready');
    await models.remove('turbo');
    expect(stateOf(models, 'turbo').state).toBe('absent');
    platform.mem.queueDialog({ picks: [{ name: 'ggml-large-v3-q5_0.bin', bytes: new Uint8Array([1]) }] });
    const [pick] = await platform.dialogs.pickFiles({ title: 'Model', filters: [], multiple: false });
    await models.import('large-v3', pick!);
    expect(stateOf(models, 'large-v3').state).toBe('ready');
    await models.setActive('large-v3');
    expect(models.active.get()).toBe('large-v3');
    expect(services.ctx.prefs.get('speech.model')).toBe('large-v3');
  });

  it('re-attaches a download that kept running in Rust (model=downloading)', async () => {
    const { models, speech } = await setup('downloading');
    expect(stateOf(models, 'turbo')).toMatchObject({ state: 'downloading', bytes: 212_000_000 });
    speech.tick(1000);
    expect(models.downloads.get().turbo).toEqual({ done: 214_400_000, total: 574_000_000, bytesPerSec: 2_400_000 });
    speech.tick(200_000);
    expect(stateOf(models, 'turbo').state).toBe('ready');
  });

  it('reports failures and an unsupported processor', async () => {
    const { models, speech } = await setup('missing');
    speech.failNext('download', 'MODEL_INTEGRITY');
    await models.download('small');
    speech.tick(1000);
    expect(stateOf(models, 'small')).toMatchObject({ state: 'failed', error: 'MODEL_INTEGRITY' });
    const old = await setup('missing', false);
    expect(old.models.info.get()!.cpuOk).toBe(false);
    await expect(old.models.download('turbo')).rejects.toMatchObject({ code: 'SPEECH_UNSUPPORTED_CPU' });
    expect(stateOf(old.models, 'turbo')).toMatchObject({ state: 'failed', error: 'SPEECH_UNSUPPORTED_CPU' });
  });

  it('is empty without speech (the demo without speech=fake)', async () => {
    const t = await createTestContext({ name: 'Ana Ribeiro' });
    const models = createServices(t.ctx).models as ModelsServiceImpl;
    await models.ready();
    expect(models.models.get()).toEqual([]);
    expect(models.info.get()).toBeNull();
    await expect(models.download('turbo')).rejects.toMatchObject({ code: 'INVALID' });
  });
});
