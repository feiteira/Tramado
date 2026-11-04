// The fictional people of the demo and their computers (UX §7.3). Device IDs are the ones the memory platform's
// test key pool gives (platform/memory/keys.ts: slot n's fake certificate → SHA-256 → Syncthing's base32 with Luhn
// check characters), generated once and committed here, so check words and avatars never change. Slot 0 is this
// computer; the sync fake's `peerJoins` takes fresh devices from slot 20 up. Member IDs derive from the person keys
// (slots 32–63; folder spec §2.1 `memberId(personPub)`). `example.test.ts` recomputes all of them.
import type { DemoMember, MemberKey } from './types';

export const PEOPLE: Readonly<Record<MemberKey, DemoMember>> = {
  ana: {
    key: 'ana', name: 'Ana Ribeiro', personPool: 32, memberId: 'nxjbfwbngrrlxwz4voykudgsw7',
    devices: [{ pool: 0, deviceId: 'CYVMFYW-65CFUXR-V536LXI-IUDKARR-OHW3WJK-TFWIYQD-BJVVYIF-MPSTXAS', name: 'Ana’s laptop', lastSeen: null }],
    caps: { cpuOk: true, localModel: { id: 'turbo', speedRT: 2.7 }, cloud: false, volunteer: 'plugged' },
  },
  bruno: {
    key: 'bruno', name: 'Bruno Costa', personPool: 33, memberId: 'py3ln6zvb2fea5c7p6bpnkemrf',
    devices: [{ pool: 1, deviceId: '4Q3XIFQ-2EVBY3G-T4UHCAM-64SEVFS-R7CA2XD-HA6OVGY-ICCMFZ3-MGTBGQF', name: 'Bruno’s laptop', lastSeen: null }],
    caps: { cpuOk: true, localModel: { id: 'turbo', speedRT: 3.1 }, cloud: false, volunteer: 'always' },
  },
  carla: {
    key: 'carla', name: 'Carla Mendes', personPool: 34, memberId: 'v2wcz3m7infvpo5uzf54zldw4a',
    devices: [
      { pool: 2, deviceId: 'FF7IOAH-CEDVZDU-VODQE3P-7RLULS7-5GC6YIT-S7THP2T-TGN7ORG-KNHCYQM', name: 'Carla’s laptop', lastSeen: '2026-11-03T12:25' },
      { pool: 3, deviceId: 'RQJEXRH-CEHPKDA-LAUUTB6-X2KBFA5-SVTH4NC-TRXUTTV-UUEADIR-FQCORAM', name: 'Carla’s desktop', lastSeen: '2026-10-31T21:40' },
    ],
    caps: { cpuOk: true, localModel: null, cloud: false, volunteer: 'off' },
  },
  jamie: {
    key: 'jamie', name: 'Jamie Lee', personPool: 36, memberId: 'ctrqqtcdhwvno2xoxvtbxsug3c',
    devices: [{ pool: 4, deviceId: '6BS5AX7-ZPJT2N4-T5YPLVQ-WNRAA63-VIEFX45-JEJXRIW-SV534OP-ZMVSBQ2', name: 'Jamie’s laptop', lastSeen: null }],
    caps: { cpuOk: true, localModel: { id: 'small', speedRT: 4.2 }, cloud: false, volunteer: 'plugged' },
  },
  diogo: {
    key: 'diogo', name: 'Diogo Santos', personPool: 37, memberId: 'p56s2chhr36ud3tf7lodnd6cyo',
    devices: [{ pool: 5, deviceId: 'N2OOYEQ-M3GCCRO-O4SD7V5-MSK5SOM-SEVQFKQ-62ITWE4-Z32YGOJ-J463SQ7', name: 'Diogo’s laptop', lastSeen: null }],
    caps: { cpuOk: true, localModel: null, cloud: false, volunteer: 'off' },
  },
};

export const MEMBER_KEYS: readonly MemberKey[] = ['ana', 'bruno', 'carla', 'jamie', 'diogo'];

/**
 * `unverified=1` (UX §7.2): "Carla-PC", a device whose member file claims Carla's member ID without her person key
 * (its proof is made with another key, so folder spec §8.3.1 never binds it): shown as "Unverified (Carla-PC)".
 */
export const UNVERIFIED_DEVICE = {
  pool: 6, personPool: 38, deviceId: '5NZJ5Q7-P3BGKWW-PNDP6EX-RBSXKI5-RWBOSDC-NET4WGX-T4JGSLB-YOX4KAY', name: 'Carla-PC', claims: 'carla' as MemberKey,
};

/** The sync fake's peer slots start here (platform/memory/sync.ts `peerJoins`); the seed never uses them. */
export const FIRST_FREE_POOL_SLOT = 20;
