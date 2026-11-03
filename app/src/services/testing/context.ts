// A test AppContext over the memory platform (Vitest): manual clock, seeded rand, inline hosts.
import { mulberry32 } from '../../core/util/prng';
import { hlcNodeOf, shortIdOf } from '../../core/model/ids';
import { createMemoryPlatform, type MemoryPlatform, type MemoryPlatformOptions } from '../../platform/memory';
import { createInlineExtractHost, createInlineHost } from '../../workers/hosts';
import { createManualClock, type AppContext } from '../context';
import { createIdentityService } from '../identity';
import { createPlatformHlcClock } from '../hlcClock';
import { createPrefsStore } from '../prefs';
import { Store } from '../store';

export async function createTestContext(opts: MemoryPlatformOptions & { startMs?: number; name?: string } = {}): Promise<{
  ctx: AppContext; platform: MemoryPlatform; clock: ReturnType<typeof createManualClock>;
}> {
  const clock = createManualClock(opts.startMs ?? 1_793_721_438_157);
  const platform = createMemoryPlatform({ ...opts, clock });
  const prefs = await createPrefsStore(platform);
  const ids = await createIdentityService(platform);
  if (opts.name !== undefined) await ids.create({ name: opts.name, deviceName: `${opts.name}'s laptop` }, clock.now());
  const deviceId = platform.mem.deviceId;
  const ctx: AppContext = {
    platform, info: await platform.info(), clock, rand: mulberry32(42), prefs, identity: ids.identity,
    device: new Store({ deviceId, shortId: shortIdOf(deviceId) }),
    hlc: await createPlatformHlcClock(platform, hlcNodeOf(deviceId), () => clock.now()),
    imagePrep: { prepare: async () => ({ jpeg: new Uint8Array(), width: 0, height: 0 }) },
    pdfRender: { pages: async () => 0, renderJpeg: async () => new Uint8Array() },
    indexHost: createInlineHost(), extractHost: createInlineExtractHost(),
    log: () => undefined,
  };
  return { ctx, platform, clock };
}
