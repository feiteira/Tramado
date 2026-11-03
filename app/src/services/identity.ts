// config/identity.json (architecture §13.3): who this person is on this computer. The person key itself
// never leaves Rust (person_init creates it on first call). Frozen after M0.
import { PlatformError } from '../core/errors';
import { isColourHex, isMemberId } from '../core/model/ids';
import { memberIdOf } from '../core/model/derive';
import { fromBase64Url } from '../core/model/sig';
import { instant } from '../core/model/time';
import type { IdentityFile } from '../core/model/files';
import type { Platform } from '../platform/types';
import type { Identity } from './context';
import { Store, type ReadableStore } from './store';

/** Parses identity.json; null when absent, malformed or not bound to its own key. */
export function parseIdentity(raw: string | null): Identity | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<IdentityFile>;
    if (f.format !== 'tramado.identity' || typeof f.version !== 'number') return null;
    if (!isMemberId(f.memberId) || typeof f.name !== 'string' || typeof f.personPub !== 'string') return null;
    if (memberIdOf(fromBase64Url(f.personPub)) !== f.memberId) return null;
    return {
      memberId: f.memberId,
      name: f.name,
      deviceName: typeof f.deviceName === 'string' ? f.deviceName : '',
      colour: isColourHex(f.colour) ? f.colour : null,
      personPub: f.personPub,
      createdAt: typeof f.createdAt === 'string' ? f.createdAt : instant(0),
    };
  } catch {
    return null;
  }
}

export interface IdentityService {
  identity: ReadableStore<Identity | null>;
  /** Onboarding: creates the person key (Rust) and writes identity.json. */
  create(input: { name: string; deviceName: string; colour?: string | null }, nowMs: number): Promise<Identity>;
  /** Settings › Profile: name, device name, colour. */
  update(patch: Partial<Pick<Identity, 'name' | 'deviceName' | 'colour'>>): Promise<Identity>;
}

function toFile(i: Identity): IdentityFile {
  return { format: 'tramado.identity', version: 1, memberId: i.memberId, name: i.name, deviceName: i.deviceName, colour: i.colour, personPub: i.personPub, createdAt: i.createdAt };
}

const clean = (s: string, max: number) => s.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);

export async function createIdentityService(platform: Pick<Platform, 'appFiles' | 'person'>): Promise<IdentityService> {
  const store = new Store<Identity | null>(parseIdentity(await platform.appFiles.read('identity.json')));
  const save = async (i: Identity) => {
    await platform.appFiles.write('identity.json', JSON.stringify(toFile(i), null, 2) + '\n');
    store.set(i);
    return i;
  };
  return {
    identity: store,
    async create(input, nowMs) {
      const name = clean(input.name, 64);
      if (!name) throw new PlatformError('INVALID', 'name required');
      const person = await platform.person.init();
      return save({
        memberId: person.memberId, personPub: person.pub, name, deviceName: clean(input.deviceName, 64) || name,
        colour: input.colour && isColourHex(input.colour) ? input.colour : null, createdAt: instant(nowMs),
      });
    },
    async update(patch) {
      const cur = store.get();
      if (!cur) throw new PlatformError('NOT_FOUND', 'no identity yet');
      const next: Identity = {
        ...cur,
        ...(patch.name !== undefined ? { name: clean(patch.name, 64) || cur.name } : {}),
        ...(patch.deviceName !== undefined ? { deviceName: clean(patch.deviceName, 64) || cur.deviceName } : {}),
        ...(patch.colour !== undefined ? { colour: patch.colour && isColourHex(patch.colour) ? patch.colour : null } : {}),
      };
      return save(next);
    },
  };
}
