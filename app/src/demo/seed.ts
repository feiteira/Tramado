// IMPL-MIN (M0) → T-DEMO owns this file from wave 1 (UX §7.3 in full: lectures, documents, notes, exams,
// chat, presence, consent, private data). M0 writes the app files (identity, prefs) and, for the four
// classes `law`, `bio`, `stats`, `hist`, a spec-conformant `class.json`, the creator's meta and my member
// file, all signed with the memory platform's demo keys, plus the content folders. No services.
import { classIdOf, newNonce } from '../core/model/derive';
import { dirsFor } from '../core/model/dirs';
import { FORMATS } from '../core/model/formats';
import { hlcNodeOf, type ClassId, type ColourHex, type IconName, type Lang } from '../core/model/ids';
import { canonicalBytes } from '../core/model/sig';
import { instant } from '../core/model/time';
import type { ClassFile, IdentityFile, MemberFile, MetaFile } from '../core/model/files';
import { Hlc } from '../core/hlc';
import { mulberry32 } from '../core/util/prng';
import type { UiLocale } from '../core/i18n/languages';
import type { MemoryPlatform } from '../platform/memory';
import { emptyDemoKeys, type DemoClassKey, type DemoKeys } from './keys';

interface DemoClassDef {
  key: DemoClassKey;
  name: string;
  shortName: string;
  colour: ColourHex;
  icon: IconName;
  lecturer: string | null;
  term: string | null;
  language: Lang;
  shared: boolean;
  archived: boolean;
  /** Days before "now" the class was created. */
  createdDaysAgo: number;
}

/** UX §7.3 (names, short names, colours, icons, lecturers, terms, languages, sharing). */
export const DEMO_CLASSES: readonly DemoClassDef[] = [
  { key: 'law', name: 'Direito Constitucional I', shortName: 'DC I', colour: '#12a594', icon: 'scale', lecturer: 'Prof.ª Marta Reis', term: '2026/27 · 1.º semestre', language: 'pt-PT', shared: true, archived: false, createdDaysAgo: 44 },
  { key: 'bio', name: 'Biology 101', shortName: 'BIO 101', colour: '#30a46c', icon: 'dna', lecturer: 'Dr. Sam Okafor', term: 'Fall 2026', language: 'en', shared: true, archived: false, createdDaysAgo: 42 },
  { key: 'stats', name: 'Estadística I', shortName: 'EST I', colour: '#f5a524', icon: 'sigma', lecturer: null, term: null, language: 'es-ES', shared: false, archived: false, createdDaysAgo: 40 },
  { key: 'hist', name: 'História do Direito Português', shortName: 'HDP', colour: '#8d8d86', icon: 'landmark', lecturer: null, term: null, language: 'pt-PT', shared: false, archived: true, createdDaysAgo: 400 },
];

export interface SeedOptions {
  lang: UiLocale;
  theme: 'light' | 'dark';
  name: string;
  nowMs: number;
  /** `demo=empty`: only the prefs (the onboarding writes the identity). */
  empty: boolean;
}

const DAY = 86_400_000;
const enc = new TextEncoder();
const json = (v: unknown, indent: boolean) => enc.encode(indent ? JSON.stringify(v, null, 2) + '\n' : JSON.stringify(v));
/** UX §7.3: "Ana's laptop" (the fixture keeps its English device names in every UI language). */
const deviceNameOf = (name: string) => `${name.split(/\s+/)[0] ?? name}’s laptop`;

export async function seedDemo(platform: MemoryPlatform, opts: SeedOptions): Promise<DemoKeys> {
  const keys = emptyDemoKeys();
  const prefs: Record<string, string> = { 'ui.locale': opts.lang, 'ui.theme': opts.theme, 'app.trayAsked': '1' };
  if (opts.empty) {
    await platform.appFiles.write('prefs.json', JSON.stringify(prefs, null, 2) + '\n');
    return keys;
  }

  // Me: the person key (memory pool) and identity.json.
  const person = await platform.person.init();
  const deviceId = platform.mem.deviceId;
  const deviceName = deviceNameOf(opts.name);
  const createdAt = instant(opts.nowMs - 60 * DAY);
  const identity: IdentityFile = { format: 'tramado.identity', version: 1, memberId: person.memberId, name: opts.name, deviceName, colour: null, personPub: person.pub, createdAt };
  await platform.appFiles.write('identity.json', JSON.stringify(identity, null, 2) + '\n');
  keys.members.ana = { memberId: person.memberId, deviceIds: [deviceId] };

  // Deterministic nonces (the class ids are the same on every run).
  const rand = mulberry32(0x5eed);
  for (const def of DEMO_CLASSES) {
    const createdMs = opts.nowMs - def.createdDaysAgo * DAY;
    const hlc = new Hlc(hlcNodeOf(deviceId), (() => {
      let t = createdMs;
      return () => t++;
    })());
    const nonce = newNonce(rand);
    const classId: ClassId = classIdOf(deviceId, nonce);
    await platform.classes.create({ classId, dirName: def.name });
    const sign = async <T extends Record<string, unknown>>(path: string, record: T) => ({ ...record, sig: await platform.sync.sign(classId, path, canonicalBytes(record)) });

    const classFile: ClassFile = await sign('.tramado/class.json', {
      format: 'tramado.class' as const, version: 1 as const, classId, idNonce: nonce, specVersion: '1.1' as const, createdAt: instant(createdMs),
      createdBy: { memberId: person.memberId, deviceId, name: opts.name }, initialName: def.name,
    });
    const dirs = dirsFor(def.language);
    const reg = <T>(value: T) => ({ value, hlc: hlc.tick() });
    const metaPath = `.tramado/meta/${deviceId}.json`;
    const meta: MetaFile = await sign(metaPath, {
      format: 'tramado.meta' as const, version: 1 as const, deviceId, memberId: person.memberId,
      fields: {
        name: reg(def.name), shortName: reg(def.shortName), colour: reg(def.colour), icon: reg(def.icon), language: reg(def.language), dirs: reg(dirs),
        lecturer: reg(def.lecturer), term: reg(def.term),
      },
      organiserOps: [{ op: 'add' as const, memberId: person.memberId, hlc: hlc.tick() }],
      hlc: hlc.tick(),
    });
    const memberPath = `.tramado/members/${deviceId}.json`;
    const member: MemberFile = await sign(memberPath, {
      format: 'tramado.member' as const, version: 1 as const, deviceId, memberId: person.memberId, name: opts.name, deviceName,
      joinedAt: instant(createdMs), hlc: hlc.tick(), addresses: [],
      caps: { cpuOk: true, localModel: null, cloud: false, volunteer: 'off' as const }, person: await platform.person.prove(classId), vouches: [],
      formats: { ...FORMATS }, app: { name: 'Tramado', version: '0.1.0', platform: 'linux' },
    });
    await platform.fs.write(classId, '.tramado/class.json', json(classFile, true), { own: true });
    await platform.fs.write(classId, metaPath, json(meta, false), { own: true });
    await platform.fs.write(classId, memberPath, json(member, false), { own: true });
    for (const d of [dirs.lectures, dirs.documents, dirs.exams, dirs.notes]) await platform.fs.mkdir(classId, d);
    if (def.shared) await platform.sync.shareClass(classId, def.name);
    if (def.archived) await platform.classes.update(classId, { archived: true });
    keys.classes[def.key] = classId;
  }
  prefs['ui.classOrder'] = JSON.stringify(DEMO_CLASSES.map((d) => keys.classes[d.key]));
  await platform.appFiles.write('prefs.json', JSON.stringify(prefs, null, 2) + '\n');
  return keys;
}
