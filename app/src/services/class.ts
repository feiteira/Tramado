// The class service (architecture §11.2, folder spec §8.1–§8.5, §8.18–§8.19): reads the trusted class.json, meta,
// member, bans, consent and mod files, computes person bindings (with former bindings of devices that left),
// organisers (replay with the monotonic vacancy clause), effective meta and bans, active consents and the honoured
// moderation lines; exposes ClassDetail; writes my own meta (LWW with the override stamp), member file (caps, addresses,
// formats; person proof) and consent lines (all signed); pushes the class policy to Rust (debounced 1 s).
import { PlatformError } from '../core/errors';
import { newUlid } from '../core/ids';
import { mergeUnknown, parserFor } from '../core/model/parse';
import { DIR_NAMES, dirsFor } from '../core/model/dirs';
import { FORMATS } from '../core/model/formats';
import { CLASS_COLOURS, iconOrDefault, suggestShortName } from '../core/model/icons';
import { classifyPath } from '../core/model/paths';
import { verifySig } from '../core/model/sig';
import { instant } from '../core/model/time';
import { hlcNodeOf, type ClassId, type ClassPath, type DeviceId, type Hlc, type MemberId, type Ulid } from '../core/model/ids';
import type { BansFile, ClassFile, ConsentLine, MemberFile, MetaFile } from '../core/model/files';
import { effectiveBans, withEntry, type BanTarget, type EffectiveBans } from '../core/sync/bans';
import { activeConsents, consentLineOk, type ActiveConsent } from '../core/sync/consent';
import { checkMemberFile, computeBindings, memberShapeOk, type Bindings, type MemberCheck } from '../core/sync/members';
import { foldMeta, META_FIELDS, overrideStamp, replayOrganisers, validValue, type FoldedMeta, type MetaField, type OrganiserReplay } from '../core/sync/meta';
import { foldMod, modLineOk, type ModState } from '../core/sync/mod';
import { computePolicy, samePolicy } from '../core/sync/policy';
import { signRecord } from '../core/sync/sign';
import { effectiveVolunteer } from '../core/sync/claims';
import { sha256Hex } from '../core/util/sha256';
import type { ClassPolicy } from '../platform/types';
import type { ClassEntry } from '../platform/types';
import type { AppContext } from './context';
import { Store, type ReadableStore } from './store';
import type { TrustServiceImpl } from './trust';
import type { AppServices, ClassStore } from './types/common';
import type { ClassDetail, ClassModel, ClassService, ConsentInput, EffectiveMeta, Person } from './types/class';
import type { DeviceRef } from './types/viewModels';

export function emptyClassDetail(classId: ClassId, me: { deviceId: string; memberId: string } = { deviceId: '', memberId: '' }): ClassDetail {
  return {
    classId,
    meta: {
      name: '', shortName: '', colour: '#8d8d86', icon: 'book-open', lecturer: null, term: null, language: 'auto', description: null,
      vocabulary: null, askBeforeAdmit: false, largeClassAck: false, dirs: { ...DIR_NAMES.en },
    },
    organisers: [], people: [], unverified: [], me: { ...me, isOrganiser: false }, shared: false, readOnly: false, newerItems: 0,
  };
}


/** What the other services of the class reach behind ClassService (T-SYNC; part of ClassService since G1). */
export type ClassServiceImpl = ClassService;
export type { ClassModel };

const enc = new TextEncoder();
const dec = new TextDecoder();
const POLICY_DEBOUNCE_MS = 1000;
const ADDRESS_MIN_INTERVAL_MS = 5 * 60_000;

function defaultMeta(classFile: ClassFile | null, dirName: string): EffectiveMeta {
  const name = classFile?.initialName ?? dirName;
  return {
    name, shortName: suggestShortName(name), colour: CLASS_COLOURS[11], icon: 'book-open', lecturer: null, term: null, language: 'auto',
    description: null, vocabulary: null, askBeforeAdmit: false, largeClassAck: false, dirs: { ...DIR_NAMES.en },
  };
}

export function createClassService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ClassServiceImpl {
  const { platform, clock } = ctx;
  const { store, classId } = cls;
  const liveEntry = () => (app().library as unknown as { entry?(id: string): ClassEntry | null }).entry?.(classId) ?? cls.store.state.get().entry;
  const me = () => ({ deviceId: ctx.device.get()?.deviceId ?? '', memberId: ctx.identity.get()?.memberId ?? '' });
  const trust = () => app().forClass(classId).trust as TrustServiceImpl;
  const entry = liveEntry;

  const emptyModel = (): ClassModel => {
    const bindings = computeBindings([]);
    return {
      revision: 0, loaded: false, classFile: null, folded: { values: {}, hlcs: {}, writers: {} }, meta: defaultMeta(null, entry().dirName),
      organisers: replayOrganisers(null, [], () => null, new Set()), bindings,
      bans: effectiveBans([], () => null, () => false, new Map()), members: new Map(), consents: [],
      mod: { pins: [], hidden: [], hideSuggestions: [], audioRemoved: new Set(), rotations: [] }, me: me(), newer: 0, former: new Map(),
    };
  };
  const model = new Store<ClassModel>(emptyModel());
  const detail = new Store<ClassDetail>(emptyClassDetail(classId, me()));
  const memberChecks = new Map<string, MemberCheck>();
  const lineSigs = new Map<string, boolean>();
  let lastPolicy: ClassPolicy | null = null;
  let pushedPolicy: ClassPolicy | null = null;
  let policyTimer: (() => void) | null = null;
  let loading: Promise<void> | null = null;
  let again = false;
  let readyResolve: () => void = () => undefined;
  const readyP = new Promise<void>((r) => (readyResolve = r));
  let lastAddressesAt = -Infinity;
  let lastDirs = '';
  let ownMemberWritten = false;

  // ── reading ────────────────────────────────────────────────────────────────────────────────────
  async function readSigned<T>(path: ClassPath, format: Parameters<typeof parserFor>[0]): Promise<T | null> {
    const parse = parserFor(format) as (raw: unknown) => { ok: boolean; value: unknown; newer: boolean; unknown: string[] };
    const loaded = await store.readJson(path, parse);
    if (loaded && (loaded.verdict.kind === 'trusted' || loaded.verdict.kind === 'unverified')) return loaded.value as T;
    // Untrusted, pending or deleted: the last trusted bytes (folder spec §6.2 rules 4–5).
    const t = trust();
    if (!entry().shared || !t.kept) return (loaded?.value as T | undefined) ?? null;
    const bytes = await t.kept(path);
    if (!bytes) return null;
    try {
      return JSON.parse(dec.decode(bytes)) as T;
    } catch {
      return null;
    }
  }

  /** A JSONL line signed under the previous ID of a rotation chain is valid too (folder spec §6.6; rotation is v1.1). */
  let rotatedFrom: ClassId | null = null;
  async function readSignedLines<T extends { sig?: unknown }>(path: ClassPath, format: 'tramado.consent' | 'tramado.mod', ok: (l: unknown) => l is T): Promise<T[]> {
    const loaded = await store.readJsonl(path, parserFor(format) as (raw: unknown) => { ok: boolean; value: T | null; newer: boolean; unknown: string[] });
    const writer = classifyPath(path).deviceId!;
    const out: T[] = [];
    for (const { value } of loaded.lines) {
      if (!ok(value)) continue;
      const key = `${path}|${sha256Hex(JSON.stringify(value))}`;
      let good = lineSigs.get(key);
      if (good === undefined) {
        good = await verifySig(value as unknown as Record<string, unknown>, [classId, ...(rotatedFrom ? [rotatedFrom] : [])], path, writer);
        lineSigs.set(key, good);
      }
      if (good) out.push(value);
    }
    return out;
  }

  async function load(): Promise<void> {
    const index = store.state.get().index;
    const shared = entry().shared;
    const t = shared ? trust() : null;
    if (t) await t.ready();
    const pathsOf = (kind: string) => {
      const set = new Set<ClassPath>();
      for (const p of index.machine.keys()) if (classifyPath(p).kind === kind) set.add(p);
      if (t) for (const p of t.keptPaths()) if (classifyPath(p).kind === kind) set.add(p);
      return [...set].sort();
    };
    const classFile = await readSigned<ClassFile>('.tramado/class.json', 'tramado.class');
    rotatedFrom = typeof classFile?.rotatedFrom === 'string' ? classFile.rotatedFrom : null;
    let newer = 0;
    if (classFile && classFile.version > FORMATS['tramado.class']) newer++;

    // Members (with deletions: a deletion counts only from the writer, §6.2 rule 4).
    const members = new Map<DeviceId, { file: MemberFile; check: MemberCheck }>();
    for (const path of pathsOf('members')) {
      const deviceId = classifyPath(path).deviceId!;
      const present = index.machine.has(path);
      if (!present && t && (await t.deletionHonoured(path, deviceId))) {
        const kept = await t.kept(path);
        if (kept) {
          try {
            const f = JSON.parse(dec.decode(kept)) as MemberFile;
            if (memberShapeOk(f, deviceId)) t.noteLeft(deviceId, f.memberId, ctx.hlc.tick(), { name: f.name, deviceName: f.deviceName });
          } catch {
            // a broken kept copy is simply forgotten
          }
        }
        await t.dropKept(path);
        continue;
      }
      const f = await readSigned<MemberFile>(path, 'tramado.member');
      if (!f || !memberShapeOk(f, deviceId)) continue;
      if (f.version > FORMATS['tramado.member']) newer++;
      const key = `${path}|${sha256Hex(JSON.stringify(f))}`;
      let check = memberChecks.get(key);
      if (!check) {
        check = await checkMemberFile(f, classId, path);
        memberChecks.set(key, check);
      }
      members.set(deviceId, { file: f, check });
    }
    const former = new Map<DeviceId, { memberId: MemberId; leftHlc: Hlc; file: null }>();
    if (t) for (const [d, v] of t.left()) if (!members.has(d) && v.memberId) former.set(d, { memberId: v.memberId, leftHlc: v.leftHlc, file: null });
    const bindings = computeBindings([...members].map(([deviceId, m]) => ({ deviceId, ...m })), former);
    // vacated: memberIds all of whose bound devices have left (monotonic, kept in the trust cache).
    if (t) {
      const leftPeople = new Set([...former.values()].map((f) => f.memberId));
      const stillHere = new Set(bindings.bound.values());
      t.addVacated([...leftPeople].filter((m) => !stillHere.has(m)));
    }
    const vacated = t ? t.vacated() : new Set<MemberId>();

    const metas: Array<{ deviceId: DeviceId; file: MetaFile }> = [];
    for (const path of pathsOf('meta')) {
      const deviceId = classifyPath(path).deviceId!;
      const f = await readSigned<MetaFile>(path, 'tramado.meta');
      if (f && f.deviceId === deviceId && typeof f.fields === 'object') metas.push({ deviceId, file: f });
    }
    const creator = classFile?.createdBy?.memberId ?? null;
    const organisers = replayOrganisers(creator, metas, bindings.personAt, vacated);
    const folded = foldMeta(metas, (d, h) => organisers.isOrganiserAt(bindings.personAt(d, h), h));
    const base = defaultMeta(classFile, entry().dirName);
    const v = folded.values;
    const lang = (v.language as string | undefined) ?? base.language;
    const meta: EffectiveMeta = {
      name: v.name ?? base.name, shortName: v.shortName ?? suggestShortName(v.name ?? base.name), colour: v.colour ?? base.colour,
      icon: iconOrDefault(v.icon ?? base.icon), lecturer: v.lecturer ?? null, term: v.term ?? null, language: lang,
      description: v.description ?? null, vocabulary: v.vocabulary ?? null, askBeforeAdmit: v.askBeforeAdmit ?? false,
      largeClassAck: v.largeClassAck ?? false, dirs: v.dirs ?? dirsFor(lang === 'auto' ? 'en' : lang),
    };

    const bansFiles: Array<{ deviceId: DeviceId; file: BansFile }> = [];
    for (const path of pathsOf('bans')) {
      const deviceId = classifyPath(path).deviceId!;
      const f = await readSigned<BansFile>(path, 'tramado.bans');
      if (f && f.deviceId === deviceId) bansFiles.push({ deviceId, file: f });
    }
    const bans = effectiveBans(bansFiles, bindings.personAt, organisers.isOrganiserAt, bindings.claims);

    const consentLines: Array<{ deviceId: DeviceId; line: ConsentLine }> = [];
    for (const path of pathsOf('consent')) {
      const deviceId = classifyPath(path).deviceId!;
      for (const line of await readSignedLines(path, 'tramado.consent', consentLineOk)) consentLines.push({ deviceId, line });
    }
    const consents = activeConsents(consentLines, bindings.personAt, organisers.isOrganiserAt);

    const modLines = [];
    for (const path of pathsOf('mod')) {
      const deviceId = classifyPath(path).deviceId!;
      for (const line of await readSignedLines(path, 'tramado.mod', modLineOk)) modLines.push({ deviceId, line });
    }
    const mod = foldMod(modLines, bindings.personAt, organisers.isOrganiserAt, () => null);

    const next: ClassModel = {
      revision: model.get().revision + 1, loaded: true, classFile, folded, meta, organisers, bindings, bans, members, consents, mod, me: me(), newer,
      former: new Map(t ? [...t.left()].filter(([d]) => !members.has(d)).map(([d, v]) => [d, { memberId: v.memberId, name: v.name, deviceName: v.deviceName }]) : []),
    };
    model.set(next);
    const dirsKey = JSON.stringify(meta.dirs);
    if (dirsKey !== lastDirs && v.dirs) {
      lastDirs = dirsKey;
      store.setDirs(meta.dirs);
    }
    detail.set(toDetail(next));
    schedulePolicy(next);
    await selfHeal(next);
    readyResolve();
  }

  function reload(): Promise<void> {
    if (loading) {
      again = true;
      return loading;
    }
    loading = (async () => {
      try {
        do {
          again = false;
          await load();
        } while (again);
      } catch (e) {
        ctx.log('error', 'class model failed to load', { classId, error: String(e) });
        readyResolve();
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  // ── views ──────────────────────────────────────────────────────────────────────────────────────
  const sync = () => app().sync as unknown as { connectionOf?(d: DeviceId): { connected: boolean; relay: boolean; lastSeen: string | null } | null };
  const presence = () => app().forClass(classId).presence as unknown as { activityOf?(d: DeviceId): { activity: Person['devices'][number]['activity']; stale: boolean } | null };

  function personView(m: ClassModel, memberId: MemberId, devices: DeviceId[], verified: boolean): Person {
    const mine = me();
    const files = devices.map((d) => m.members.get(d)?.file).filter((f): f is MemberFile => !!f);
    const best = [...files].sort((a, b) => (a.hlc < b.hlc ? 1 : -1))[0];
    return {
      memberId, name: best?.name ?? memberId, colour: best?.colour ?? null, isMe: memberId === mine.memberId,
      isOrganiser: m.organisers.organisers.has(memberId), banned: m.bans.members.has(memberId) || devices.some((d) => m.bans.bannedDevices.has(d)),
      devices: devices.map((d) => {
        const f = m.members.get(d)?.file;
        const conn = d === mine.deviceId ? null : sync().connectionOf?.(d) ?? null;
        const act = presence().activityOf?.(d) ?? null;
        return {
          deviceId: d, deviceName: f?.deviceName ?? d.slice(0, 7), verified, online: d === mine.deviceId ? true : !!conn?.connected, relay: !!conn?.relay,
          lastSeen: d === mine.deviceId ? instant(clock.now()) : conn?.lastSeen ?? null,
          caps: f?.caps ?? { cpuOk: false, localModel: null, cloud: false, volunteer: 'off' }, app: f?.app ?? { name: 'Tramado', version: '', platform: '' },
          activity: act?.activity ?? null, stale: act?.stale ?? true,
        };
      }),
    };
  }

  function toDetail(m: ClassModel): ClassDetail {
    const mine = me();
    const people = m.bindings.people.map((p) => personView(m, p.memberId, p.devices, true));
    const byClaim = new Map<MemberId, DeviceId[]>();
    for (const d of m.bindings.unverified) {
      const claim = m.bindings.claims.get(d);
      if (claim) byClaim.set(claim, [...(byClaim.get(claim) ?? []), d]);
    }
    const unverified = [...byClaim].map(([memberId, devs]) => personView(m, memberId, devs, false));
    return {
      classId, meta: m.meta, organisers: [...m.organisers.organisers].sort(), people, unverified,
      me: { ...mine, isOrganiser: m.organisers.organisers.has(mine.memberId) }, shared: entry().shared,
      readOnly: (m.classFile?.version ?? 1) > FORMATS['tramado.class'], newerItems: m.newer,
    };
  }

  function refreshDetail() {
    if (model.get().loaded) detail.set(toDetail(model.get()));
  }

  // ── policy push (architecture §12 rule 6) ───────────────────────────────────────────────────────
  function schedulePolicy(m: ClassModel) {
    if (!m.classFile && !m.members.size) return;
    const mine = me();
    const p = computePolicy({
      classId, label: m.meta.name, askBeforeAdmit: m.meta.askBeforeAdmit,
      members: [...m.members].map(([deviceId, x]) => ({ deviceId, file: x.file, bound: m.bindings.bound.has(deviceId) })),
      bannedDevices: m.bans.bannedDevices, me: mine.deviceId, now: instant(clock.now()),
    }) as ClassPolicy;
    lastPolicy = p;
    if (!entry().shared || samePolicy(pushedPolicy, p)) return;
    policyTimer?.();
    const first = pushedPolicy === null;
    const push = () => {
      policyTimer = null;
      const latest = lastPolicy!;
      if (!entry().shared || samePolicy(pushedPolicy, latest)) return;
      pushedPolicy = latest;
      void platform.sync.setPolicy(latest).catch((e: unknown) => ctx.log('warn', 'policy push failed', { classId, error: String(e) }));
    };
    if (first) push();
    else policyTimer = clock.setTimeout(push, POLICY_DEBOUNCE_MS);
  }

  // ── writing ────────────────────────────────────────────────────────────────────────────────────
  const sign = <T extends object>(path: ClassPath, record: T) => signRecord((c, p, canonical) => platform.sync.sign(c, p, canonical), classId, path, record);
  const writeSigned = async (path: ClassPath, record: object) => {
    await store.writeJson(path, record, { own: true });
    await platform.sync.scan(classId, path).catch(() => undefined);
  };

  async function ownMeta(): Promise<{ prev: MetaFile | null }> {
    const mine = me();
    const path = `.tramado/meta/${mine.deviceId}.json`;
    const loaded = await store.readJson(path, parserFor('tramado.meta'));
    return { prev: (loaded?.value as MetaFile | undefined) ?? null };
  }

  async function writeMeta(mutate: (f: MetaFile) => void): Promise<void> {
    const mine = me();
    if (!mine.deviceId || !mine.memberId) throw new PlatformError('INVALID', 'no identity');
    const path = `.tramado/meta/${mine.deviceId}.json`;
    const { prev } = await ownMeta();
    const next: MetaFile = mergeUnknown(prev, {
      format: 'tramado.meta', version: 1, deviceId: mine.deviceId, memberId: mine.memberId,
      fields: { ...(prev?.fields ?? {}) }, organiserOps: [...(prev?.organiserOps ?? [])], hlc: ctx.hlc.tick(), sig: { cert: '', value: '' },
    });
    mutate(next);
    next.hlc = ctx.hlc.tick();
    const signed = await sign(path, next);
    await writeSigned(path, signed);
    await reload();
  }

  const stamp = (current: Hlc | null | undefined) => overrideStamp(ctx.hlc.tick(), current, hlcNodeOf(me().deviceId));

  async function memberRecord(prev: MemberFile | null): Promise<Omit<MemberFile, 'sig'>> {
    const mine = me();
    const identity = ctx.identity.get();
    if (!identity || !mine.deviceId) throw new PlatformError('INVALID', 'no identity');
    const info = ctx.info;
    let caps: MemberFile['caps'] = prev?.caps ?? { cpuOk: false, localModel: null, cloud: false, volunteer: 'off' };
    try {
      const s = await platform.speech?.info();
      if (s) {
        const active = (ctx.prefs.get('speech.model') || s.defaultModel) as string;
        const ready = s.models.find((x) => x.id === active && x.state === 'ready') ?? s.models.find((x) => x.state === 'ready');
        const cloud = ctx.prefs.get('speech.cloud') === '1';
        const cloudAuto = cloud && ctx.prefs.get('speech.cloudAuto') === '1';
        const pref = (ctx.prefs.get('speech.volunteer') || 'plugged') as 'off' | 'plugged' | 'always';
        caps = {
          cpuOk: s.cpuOk && s.localWhisper, localModel: ready ? { id: ready.id, speedRT: ready.speedRT ?? 1 } : null, cloud,
          volunteer: effectiveVolunteer(pref, !!ready && s.cpuOk && s.localWhisper, cloudAuto),   // as the TranscriptionQueue decides (G1)
        };
      }
    } catch {
      // no speech on this platform
    }
    let addresses = prev?.addresses ?? [];
    if (clock.mono() - lastAddressesAt >= ADDRESS_MIN_INTERVAL_MS || !prev) {
      try {
        addresses = (await platform.sync.ownAddresses()).slice(0, 8);
        lastAddressesAt = clock.mono();
      } catch {
        addresses = prev?.addresses ?? [];
      }
    }
    const person = await platform.person.prove(classId);
    return {
      format: 'tramado.member', version: 1, deviceId: mine.deviceId, memberId: identity.memberId, name: identity.name.slice(0, 64),
      ...(identity.colour ? { colour: identity.colour } : {}), deviceName: (identity.deviceName || identity.name).slice(0, 64),
      joinedAt: prev?.joinedAt ?? instant(clock.now()), hlc: ctx.hlc.tick(), addresses, caps, person, vouches: prev?.vouches ?? [], formats: { ...FORMATS },
      app: { name: 'Tramado', version: info.version, platform: info.os === 'web' ? 'linux' : info.os },
    };
  }

  /** Rewrites my member file when something it carries changed (folder spec §8.3). */
  async function refreshOwnMemberFile(force = false): Promise<void> {
    const mine = me();
    if (!mine.deviceId || !ctx.identity.get()) return;
    if (entry().leaving) return;
    const path = `.tramado/members/${mine.deviceId}.json`;
    const loaded = await store.readJson(path, parserFor('tramado.member'));
    const prev = (loaded?.value as MemberFile | undefined) ?? null;
    const rec = await memberRecord(prev);
    if (prev && !force) {
      const strip = (f: object) => JSON.stringify({ ...f, hlc: '', sig: null, joinedAt: '' });
      if (strip(mergeUnknown(prev, rec)) === strip(prev)) return;
    }
    const signed = await sign(path, mergeUnknown(prev, rec));
    await writeSigned(path, signed);
    ownMemberWritten = true;
    await reload();
  }

  /** My own signed files must be there (Rust heals them from its mirror; the memory platform has no mirror). */
  async function selfHeal(m: ClassModel) {
    const mine = me();
    if (!entry().shared || entry().leaving || !mine.deviceId || !ownMemberWritten) return;
    if (!m.members.has(mine.deviceId) && !store.state.get().index.machine.has(`.tramado/members/${mine.deviceId}.json`)) {
      void refreshOwnMemberFile(true).catch(() => undefined);
    }
  }

  async function consentRecord(input: ConsentInput): Promise<{ deviceId: DeviceId; id: Ulid }> {
    const mine = me();
    if (!mine.deviceId || !mine.memberId) throw new PlatformError('INVALID', 'no identity');
    const path = `.tramado/consent/${mine.deviceId}.jsonl`;
    const now = clock.now();
    const id = newUlid(now, ctx.rand);
    const line: Omit<ConsentLine, 'sig'> = {
      format: 'tramado.consent', version: 1, id, hlc: ctx.hlc.tick(), ms: now, memberId: mine.memberId, kind: input.kind, scope: input.scope,
      ...(input.scope === 'lecture' && input.lectureId ? { lectureId: input.lectureId } : {}),
      ...(input.kind === 'share' && input.share ? { share: input.share } : {}),
      textId: input.textId, textLang: input.textLang, text: input.text.slice(0, 500), ...(input.lecturer ? { lecturer: input.lecturer } : {}),
    };
    await store.appendLine(path, await sign(path, line));
    await platform.sync.scan(classId, path).catch(() => undefined);
    await reload();
    return { deviceId: mine.deviceId, id };
  }

  // Reload on the kinds that carry class semantics.
  store.onChange(['classFile', 'meta', 'members', 'bans', 'consent', 'mod'], () => void reload());
  store.state.subscribe(() => {
    const status = store.state.get().status;
    if (status === 'ready' && !model.get().loaded && !loading) void reload();
    if (status === 'missing' || status === 'error') readyResolve();
  });

  const service: ClassServiceImpl = {
    detail,
    model,
    ready: () => readyP,
    reload,
    async setMeta(patch) {
      const fields = Object.keys(patch) as MetaField[];
      for (const f of fields) {
        if (!META_FIELDS.includes(f)) throw new PlatformError('INVALID', `unknown meta field ${f}`);
        if (!validValue(f, patch[f])) throw new PlatformError('INVALID', `invalid value for ${f}`);
      }
      await service.ready();
      const cur = model.get().folded.hlcs;
      await writeMeta((next) => {
        for (const f of fields) (next.fields as Record<string, unknown>)[f] = { value: patch[f], hlc: stamp(cur[f]) };
      });
      if (fields.includes('name') && entry().shared) await app().library.load();
    },
    async setOrganiser(memberId, on) {
      await service.ready();
      const mine = me();
      if (!model.get().organisers.organisers.has(mine.memberId)) throw new PlatformError('PERMISSION_DENIED', 'only organisers can change organisers');
      await writeMeta((next) => next.organiserOps.push({ op: on ? 'add' : 'remove', memberId, hlc: ctx.hlc.tick() }));
    },
    async becomeOrganiser() {
      await service.ready();
      const mine = me();
      await writeMeta((next) => next.organiserOps.push({ op: 'add', memberId: mine.memberId, hlc: ctx.hlc.tick() }));
    },
    refreshOwnMemberFile: () => refreshOwnMemberFile(false),
    consent: {
      record: consentRecord,
      async revoke(ref) {
        const mine = me();
        const path = `.tramado/consent/${mine.deviceId}.jsonl`;
        const now = clock.now();
        const target = model.get().consents.find((c) => c.deviceId === ref.deviceId && c.id === ref.id);
        const line: Omit<ConsentLine, 'sig'> = {
          format: 'tramado.consent', version: 1, id: newUlid(now, ctx.rand), hlc: ctx.hlc.tick(), ms: now, memberId: mine.memberId, kind: 'revoke',
          scope: target?.scope ?? 'class', revokes: { deviceId: ref.deviceId, id: ref.id }, textId: target?.textId ?? 'record.dialog.consent.v1',
          textLang: target?.textLang ?? 'en', text: target?.text ?? '',
        };
        await store.appendLine(path, await sign(path, line));
        await platform.sync.scan(classId, path).catch(() => undefined);
        await reload();
      },
      active: () => model.get().consents,
    },
    personAt: (d, h) => model.get().bindings.personAt(d, h),
    isOrganiserAt: (m, h) => model.get().organisers.isOrganiserAt(m, h),
    nameOf(d) {
      const m = model.get();
      const who = m.bindings.bound.get(d);
      const person = who ? m.bindings.people.find((p) => p.memberId === who) : undefined;
      const gone = m.former.get(d);
      const sameNow = gone ? m.bindings.people.find((p) => p.memberId === gone.memberId) : undefined;
      return person?.name ?? sameNow?.name ?? (gone?.name || undefined) ?? m.members.get(d)?.file.deviceName ?? (d === me().deviceId ? ctx.identity.get()?.name ?? '' : d.slice(0, 7));
    },
    deviceRef(d) {
      const m = model.get();
      const bound = m.bindings.personAt(d) ?? '';
      const f = m.members.get(d)?.file;
      const mine = me();
      const self = d === mine.deviceId;
      return {
        deviceId: d, deviceName: f?.deviceName ?? m.former.get(d)?.deviceName ?? (self ? ctx.identity.get()?.deviceName ?? '' : d.slice(0, 7)),
        memberId: bound || (self ? mine.memberId : ''), memberName: service.nameOf(d), self,
      };
    },
    policy: () => lastPolicy,
    async writeBan(target, state, reason) {
      await service.ready();
      const mine = me();
      const path = `.tramado/bans/${mine.deviceId}.json`;
      const loaded = await store.readJson(path, parserFor('tramado.bans'));
      const prev = (loaded?.value as BansFile | undefined) ?? null;
      const hlc = stamp(model.get().bans.current(target));
      const next: Omit<BansFile, 'sig'> = mergeUnknown(prev, {
        format: 'tramado.bans', version: 1, deviceId: mine.deviceId, memberId: mine.memberId, hlc: ctx.hlc.tick(), updatedAt: instant(clock.now()),
        entries: withEntry(prev?.entries ?? [], target, state, hlc, reason),
      });
      await writeSigned(path, await sign(path, next));
      await reload();
    },
    async removeOwnFiles() {
      const mine = me();
      // The departure stamp (folder spec §8.2, sync spec §17; UI-GROUP, G2 decision): my meta file once more, same
      // fields and ops with a fresh hlc, signed, right before my member file goes.
      await writeMeta(() => undefined).catch(() => undefined);
      for (const p of [`.tramado/presence/${mine.deviceId}.json`, `.tramado/members/${mine.deviceId}.json`]) {
        await store.remove(p).catch(() => undefined);
      }
      ownMemberWritten = false;
      await platform.sync.scan(classId, '.tramado').catch(() => undefined);
    },
    async writeFork(newClassId, nonce) {
      // Called after platform.classes.fork: this service still answers for the old ID, so it writes through the
      // platform directly under the new one (sync spec §17; folder spec §8.1 `forkedFrom`).
      const mine = me();
      const identity = ctx.identity.get();
      if (!identity) throw new PlatformError('INVALID', 'no identity');
      const m = model.get();
      const signAs = <T extends object>(path: ClassPath, rec: T) => signRecord((c, p, canonical) => platform.sync.sign(c, p, canonical), newClassId, path, rec);
      const json = (v: unknown, indent: boolean) => enc.encode(indent ? JSON.stringify(v, null, 2) + '\n' : JSON.stringify(v));
      const classFile = await signAs('.tramado/class.json', {
        format: 'tramado.class', version: 1, classId: newClassId, idNonce: nonce, specVersion: '1.1', createdAt: instant(clock.now()),
        createdBy: { memberId: identity.memberId, deviceId: mine.deviceId, name: identity.name.slice(0, 64) }, initialName: m.meta.name, forkedFrom: classId,
      });
      await platform.fs.write(newClassId, '.tramado/class.json', json(classFile, true), { own: true });
      const reg = <T>(value: T) => ({ value, hlc: ctx.hlc.tick() });
      const fields: MetaFile['fields'] = {
        name: reg(m.meta.name), shortName: reg(m.meta.shortName), colour: reg(m.meta.colour), icon: reg(m.meta.icon), language: reg(m.meta.language),
        dirs: reg(m.meta.dirs), lecturer: reg(m.meta.lecturer), term: reg(m.meta.term),
        ...(m.meta.vocabulary ? { vocabulary: reg(m.meta.vocabulary) } : {}),
      };
      const metaPath = `.tramado/meta/${mine.deviceId}.json`;
      const meta = await signAs(metaPath, { format: 'tramado.meta', version: 1, deviceId: mine.deviceId, memberId: identity.memberId, fields, organiserOps: [{ op: 'add', memberId: identity.memberId, hlc: ctx.hlc.tick() }], hlc: ctx.hlc.tick() });
      await platform.fs.write(newClassId, metaPath, json(meta, false), { own: true });
      const memberPath = `.tramado/members/${mine.deviceId}.json`;
      const rec = await memberRecord(null);
      const member = await signAs(memberPath, { ...rec, person: await platform.person.prove(newClassId) });
      await platform.fs.write(newClassId, memberPath, json(member, false), { own: true });
    },
    async uiState() {
      const raw = await platform.privateFiles.read(classId, 'ui-state.json').catch(() => null);
      if (!raw) return { format: 'tramado.ui-state', version: 1, dismissed: {} };
      try {
        return JSON.parse(dec.decode(raw)) as Record<string, unknown>;
      } catch {
        return { format: 'tramado.ui-state', version: 1, dismissed: {} };
      }
    },
    async setUiState(patch) {
      const cur = await service.uiState();
      await platform.privateFiles.write(classId, 'ui-state.json', enc.encode(JSON.stringify({ ...cur, ...patch, format: 'tramado.ui-state', version: 1 })));
    },
  };

  // Presence and connection changes update the people's online dots.
  queueMicrotask(() => {
    try {
      const s = app().sync as unknown as { connections?: ReadableStore<unknown> };
      s.connections?.subscribe(refreshDetail);
      const p = app().forClass(classId).presence as unknown as { others: ReadableStore<unknown> };
      p.others.subscribe(refreshDetail);
    } catch {
      // the class left the library before its services were wired
    }
  });
  return service;
}
