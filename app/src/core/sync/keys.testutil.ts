// Test helpers for core/sync: real Ed25519 device and person keys (WebCrypto), fake certificates holding exactly one
// Ed25519 SPKI (the device ID is SHA-256 of the DER, as for Syncthing), and signed records. Fictional data only.
import { formatHlc } from '../hlc';
import { toBase64 } from '../bytes';
import { memberIdOf } from '../model/derive';
import { deviceIdOfCert, personProofMessage, signedMessage, toBase64Url } from '../model/sig';
import { hlcNodeOf, type ClassId, type DeviceId, type Hlc, type MemberId } from '../model/ids';
import type { BansFile, MemberFile, MetaFile, Sig } from '../model/files';
import { revokeMessage } from './members';

const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

async function keyPair() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { pub, sign: async (m: Uint8Array) => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, m as BufferSource)) };
}

export interface TestDevice {
  deviceId: DeviceId;
  cert: Uint8Array;
  node: string;
  sign(classId: ClassId, path: string, record: Record<string, unknown>): Promise<Sig>;
}
export interface TestPerson { memberId: MemberId; pub: Uint8Array; sign(m: Uint8Array): Promise<Uint8Array> }

export async function testDevice(label = 'dev'): Promise<TestDevice> {
  const k = await keyPair();
  const cert = new Uint8Array([...new TextEncoder().encode(`TEST-CERT-${label}\u0000`), ...SPKI_PREFIX, ...k.pub]);
  const deviceId = deviceIdOfCert(cert);
  return {
    deviceId, cert, node: hlcNodeOf(deviceId),
    async sign(classId, path, record) {
      return { cert: toBase64(cert), value: toBase64(await k.sign(signedMessage(classId, path, record))) };
    },
  };
}

export async function testPerson(): Promise<TestPerson> {
  const k = await keyPair();
  return { memberId: memberIdOf(k.pub), pub: k.pub, sign: k.sign };
}

export const hlcAt = (ms: number, node: string, counter = 0): Hlc => formatHlc({ ms, counter, device: node });

export async function signedMember(classId: ClassId, dev: TestDevice, person: TestPerson, over: Partial<MemberFile> = {}, opts: { revoke?: DeviceId[] } = {}): Promise<MemberFile> {
  const path = `.tramado/members/${dev.deviceId}.json`;
  const proofSig = await person.sign(personProofMessage(classId, dev.deviceId, person.memberId));
  const revoked = opts.revoke ? await Promise.all(opts.revoke.map(async (d) => ({ deviceId: d, sig: toBase64Url(await person.sign(revokeMessage(classId, d, person.memberId))) }))) : undefined;
  const rec: Omit<MemberFile, 'sig'> = {
    format: 'tramado.member', version: 1, deviceId: dev.deviceId, memberId: person.memberId, name: 'Ana Ribeiro', deviceName: 'Ana’s laptop',
    joinedAt: '2026-10-01T09:12:44.512Z', hlc: hlcAt(1_790_000_000_000, dev.node), addresses: [],
    caps: { cpuOk: true, localModel: null, cloud: false, volunteer: 'off' },
    person: { pub: toBase64Url(person.pub), sig: toBase64Url(proofSig), ...(revoked ? { revoked } : {}) },
    vouches: [], formats: { 'tramado.chat': 1 }, app: { name: 'Tramado', version: '0.1.0', platform: 'linux' }, ...over,
  };
  const sig = await dev.sign(classId, path, rec as unknown as Record<string, unknown>);
  return { ...(rec as MemberFile), sig };
}

export async function signedMeta(classId: ClassId, dev: TestDevice, memberId: MemberId, fields: MetaFile['fields'], organiserOps: MetaFile['organiserOps'] = [], hlc?: Hlc): Promise<MetaFile> {
  const path = `.tramado/meta/${dev.deviceId}.json`;
  const rec = { format: 'tramado.meta' as const, version: 1 as const, deviceId: dev.deviceId, memberId, fields, organiserOps, hlc: hlc ?? hlcAt(1_790_000_000_000, dev.node) };
  return { ...rec, sig: await dev.sign(classId, path, rec as unknown as Record<string, unknown>) };
}

export async function signedBans(classId: ClassId, dev: TestDevice, memberId: MemberId, entries: BansFile['entries'], hlc?: Hlc): Promise<BansFile> {
  const path = `.tramado/bans/${dev.deviceId}.json`;
  const rec = { format: 'tramado.bans' as const, version: 1 as const, deviceId: dev.deviceId, memberId, hlc: hlc ?? hlcAt(1_790_000_000_000, dev.node), updatedAt: '2026-11-01T10:00:00.000Z', entries };
  return { ...rec, sig: await dev.sign(classId, path, rec as unknown as Record<string, unknown>) };
}
