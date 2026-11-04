// Mesh test harness: one full AppServices per mesh device (memory platform + simulated Syncthing), with the device's
// fake clock, and helpers that let the mesh, the timers and the class stores settle. Fictional people only.
import { mulberry32 } from '../../core/util/prng';
import { hlcNodeOf, shortIdOf, type ClassId } from '../../core/model/ids';
import { createMemoryMesh, type MemoryMesh, type MeshOptions } from '../../platform/memory/mesh';
import type { MemoryPlatform } from '../../platform/memory';
import { createInlineExtractHost, createInlineHost } from '../../workers/hosts';
import type { AppContext } from '../context';
import { createIdentityService } from '../identity';
import { createPlatformHlcClock } from '../hlcClock';
import { createPrefsStore } from '../prefs';
import { createServices, type AppServicesImpl } from '../index';
import { Store } from '../store';
import type { ClassServiceImpl } from '../class';
import type { ClassStoreImpl } from '../classStore';

export interface MeshApp {
  name: string;
  platform: MemoryPlatform;
  ctx: AppContext;
  services: AppServicesImpl;
  deviceId: string;
  memberId: string;
}

const PEOPLE: Record<string, string> = { ana: 'Ana Ribeiro', bruno: 'Bruno Costa', carla: 'Carla Mendes', diogo: 'Diogo Santos', jamie: 'Jamie Lee', eva: 'Eva Lopes' };

export function newMesh(opts: Partial<MeshOptions> = {}): MemoryMesh {
  return createMemoryMesh({ seed: 7, ...opts });
}

/** Builds (or rebuilds after a crash) the app of a device: prefs, identity, HLC, services, library, sync boot. */
export async function meshApp(mesh: MemoryMesh, name: string, platform?: MemoryPlatform): Promise<MeshApp> {
  const p = platform ?? mesh.device(name);
  const clock = mesh.clock(name);
  const prefs = await createPrefsStore(p);
  const ids = await createIdentityService(p);
  if (!ids.identity.get()) {
    const full = PEOPLE[name] ?? name;
    await ids.create({ name: full, deviceName: `${full.split(' ')[0]}’s laptop` }, clock.now());
  }
  const deviceId = p.mem.deviceId;
  const ctx: AppContext = {
    platform: p, info: await p.info(), clock, rand: mulberry32(name.length * 7919 + name.charCodeAt(0)), prefs, identity: ids.identity,
    device: new Store({ deviceId, shortId: shortIdOf(deviceId) }),
    hlc: await createPlatformHlcClock(p, hlcNodeOf(deviceId), () => clock.now()),
    imagePrep: { prepare: async () => ({ jpeg: new Uint8Array(), width: 0, height: 0 }) },
    pdfRender: { pages: async () => 0, renderJpeg: async () => new Uint8Array() },
    indexHost: createInlineHost(), extractHost: createInlineExtractHost(),
    log: () => undefined,
  };
  const services = createServices(ctx);
  await services.library.load();
  await services.sync.boot();
  return { name, platform: p, ctx, services, deviceId, memberId: ids.identity.get()!.memberId };
}

/** Lets everything settle: mesh rounds, timers (store coalescing, policy debounce), class stores. */
export async function settle(mesh: MemoryMesh, apps: MeshApp[], rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await mesh.settle();
    await mesh.advance(1200);
    for (const a of apps) {
      if (!mesh.isUp(a.name)) continue;
      for (const v of a.services.library.classes.get()) {
        try {
          await (a.services.forClass(v.id).store as ClassStoreImpl).idle();
          await (a.services.forClass(v.id).info as ClassServiceImpl).reload();
        } catch {
          // the class left
        }
      }
    }
    await mesh.settle();
    await new Promise((r) => setTimeout(r, 1));
  }
}

export const info = (a: MeshApp, classId: ClassId) => a.services.forClass(classId).info as ClassServiceImpl;

/** Creates a shared class on `owner` and lets `others` join it with the invite. */
export async function sharedClass(mesh: MemoryMesh, owner: MeshApp, others: MeshApp[], name = 'Direito Constitucional I'): Promise<ClassId> {
  const classId = await owner.services.library.create({ name, colour: '#12a594', icon: 'scale', language: 'pt-PT', share: true, lecturer: 'Prof.ª Marta Reis' });
  await settle(mesh, [owner], 2);
  for (const o of others) {
    const { code } = await owner.services.sync.invite(classId);
    const preview = await o.services.sync.parseCode(code);
    await o.services.sync.join(preview, { includeAudio: true });
    await settle(mesh, [owner, ...others]);
  }
  await settle(mesh, [owner, ...others]);
  return classId;
}

export const enc = (s: string) => new TextEncoder().encode(s);
export const dec = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : '');
