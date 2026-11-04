// The class library (architecture §11.2): the registry entries as UX ClassViews, folded from each class's services
// (effective meta, people, chat unread and mentions, presence, exam dates, sync state); creating a class (derived
// classId, signed class.json, own signed meta and member file with a person proof, optional share), adopting a
// folder (forked when it holds other devices' member files, sync spec §17), archiving and forgetting; the
// suggestions of name → short name, lucide icon and colour (product-ux §4.2, critique C26).
import { PlatformError, toPlatformError } from '../core/errors';
import { classIdOf, newNonce } from '../core/model/derive';
import { dirsFor } from '../core/model/dirs';
import { CLASS_COLOURS, iconOrDefault, suggestColourFor, suggestIconFor, suggestShortName } from '../core/model/icons';
import { isColourHex, type ClassId, type IconName, type Lang } from '../core/model/ids';
import { sanitize, unique } from '../core/model/sanitize';
import { canonicalBytes } from '../core/model/sig';
import { instant } from '../core/model/time';
import { FORMATS } from '../core/model/formats';
import type { ClassFile, MemberFile, MetaFile } from '../core/model/files';
import type { ClassEntry, Picked } from '../platform/types';
import type { ClassServiceImpl } from './class';
import type { AppContext } from './context';
import type { PresenceServiceImpl } from './presence';
import { Store } from './store';
import type { SyncServiceImpl } from './sync';
import type { AppServices, ClassServices } from './types/common';
import type { ClassLibrary } from './types/library';
import type { ClassSync, ClassView, DeviceRef, ExamDateView } from './types/viewModels';

export { CLASS_COLOURS, suggestColourFor, suggestIconFor, suggestShortName };

export interface ClassLibraryImpl extends ClassLibrary {
  /** The registry entry of a class (services/index.ts creates ClassServices from it). */
  entry(classId: ClassId): ClassEntry | null;
}

const dec = new TextDecoder();

export function createLibrary(ctx: AppContext, app: () => AppServices): ClassLibraryImpl {
  const { platform } = ctx;
  const classes = new Store<ClassView[]>([]);
  const entries = new Map<ClassId, ClassEntry>();
  const fallback = new Map<ClassId, { name: string; shortName: string; colour: string | null; icon: string | null; lecturer: string | null; term: string | null; language: string; vocabulary: string | null; askBeforeAdmit: boolean; organisers: string[]; newer: boolean }>();
  const wired = new Map<ClassId, () => void>();
  let order: ClassId[] = [];
  let syncWired = false;

  async function readJson<T>(classId: ClassId, path: string): Promise<T | null> {
    try {
      return JSON.parse(dec.decode(await platform.fs.read(classId, path))) as T;
    } catch {
      return null;
    }
  }

  /** First paint before the class services loaded: class.json and the creator's meta (no fold). */
  async function readFallback(e: ClassEntry) {
    const cf = e.available ? await readJson<ClassFile>(e.classId, '.tramado/class.json') : null;
    const creator = cf?.createdBy?.deviceId;
    const meta = creator ? await readJson<MetaFile>(e.classId, `.tramado/meta/${creator}.json`) : null;
    const f = meta?.fields ?? {};
    const name = (f.name?.value as string | undefined) ?? cf?.initialName ?? e.dirName;
    fallback.set(e.classId, {
      name, shortName: (f.shortName?.value as string | undefined) ?? suggestShortName(name), colour: isColourHex(f.colour?.value) ? f.colour.value : null,
      icon: (f.icon?.value as string | undefined) ?? null, lecturer: (f.lecturer?.value as string | null | undefined) ?? null, term: (f.term?.value as string | null | undefined) ?? null,
      language: (f.language?.value as string | undefined) ?? 'auto', vocabulary: (f.vocabulary?.value as string | null | undefined) ?? null,
      askBeforeAdmit: f.askBeforeAdmit?.value === true, organisers: cf ? [cf.createdBy.memberId] : [], newer: (cf?.version ?? 1) > FORMATS['tramado.class'],
    });
  }

  const servicesOf = (classId: ClassId): ClassServices | null => {
    try {
      return app().forClass(classId);
    } catch {
      return null;
    }
  };

  function syncOf(e: ClassEntry, c: ClassServices | null): ClassSync {
    if (!e.available) return { kind: 'missingFolder' };
    if (!e.shared) return { kind: 'local' };
    const st = app().sync.state.get();
    const f = st.folders[e.classId];
    if (st.markerMissing.includes(e.classId)) return { kind: 'missingFolder' };
    if (st.status?.paused || f?.paused) return { kind: 'paused' };
    if (f && (f.pullErrors > 0 || f.error)) return { kind: 'problems', count: Math.max(1, f.pullErrors) };
    if (f && f.needFiles > 0) return { kind: 'syncing', files: f.needFiles, bytesLeft: f.needBytes };
    const people = c ? (c.info as ClassServiceImpl).detail.get().people : [];
    const online = people.filter((p) => !p.isMe).flatMap((p) => p.devices.filter((d) => d.online));
    if (!online.length) return { kind: 'waiting' };
    if (online.every((d) => d.relay)) return { kind: 'relay' };
    return { kind: 'upToDate' };
  }

  function viewOf(e: ClassEntry): ClassView {
    const c = e.available ? servicesOf(e.classId) : null;
    const ci = c?.info as ClassServiceImpl | undefined;
    const loaded = !!ci && ci.model.get().loaded;
    const d = loaded ? ci!.detail.get() : null;
    const fb = fallback.get(e.classId);
    const name = d?.meta.name || fb?.name || e.dirName;
    const notify = ctx.prefs.get(`notify.class.${e.classId}`) || ctx.prefs.get('notify.default');
    const chat = c?.chat.view.get();
    let recordingBy: DeviceRef | null = null;
    const presence = c?.presence as PresenceServiceImpl | undefined;
    if (presence && ci) {
      for (const [dev, o] of Object.entries(presence.others.get())) {
        if (!o.stale && o.activity.recording) {
          recordingBy = ci.deviceRef(dev);
          break;
        }
      }
    }
    let nextExams: ExamDateView[] = [];
    try {
      const now = ctx.clock.now();
      nextExams = [...(c?.exams.list.get().dates ?? [])].filter((x) => Date.parse(x.at) >= now - 86_400_000).sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 3);
    } catch {
      nextExams = [];
    }
    const people = d?.people ?? [];
    return {
      id: e.classId, name, shortName: d?.meta.shortName || fb?.shortName || suggestShortName(name),
      color: d?.meta.colour ?? fb?.colour ?? CLASS_COLOURS[11], icon: iconOrDefault(d?.meta.icon ?? fb?.icon ?? suggestIconFor(name)),
      lecturer: d ? d.meta.lecturer : fb?.lecturer ?? null, term: d ? d.meta.term : fb?.term ?? null, language: d?.meta.language ?? fb?.language ?? 'auto',
      vocabulary: (d ? d.meta.vocabulary : fb?.vocabulary) ?? '', shared: e.shared, archived: e.archived, path: e.path, sync: syncOf(e, c),
      onlineMembers: people.filter((p) => !p.isMe && p.devices.some((x) => x.online)).length, memberCount: Math.max(1, people.length),
      unread: chat?.unread ?? 0, mentions: chat?.mentions ?? 0, recordingBy, nextExams, pins: [],
      notify: notify === 'all' || notify === 'none' ? notify : 'important', askBeforeJoin: d ? d.meta.askBeforeAdmit : fb?.askBeforeAdmit ?? false,
      skipAudio: e.skipAudio, organisers: d?.organisers ?? fb?.organisers ?? [], newerFormat: d ? d.readOnly || d.newerItems > 0 : fb?.newer ?? false,
    };
  }

  function publish() {
    const pos = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + [...entries.keys()].indexOf(id));
    const views = [...entries.values()].filter((e) => !e.leaving).map(viewOf).sort((a, b) => pos(a.id) - pos(b.id));
    if (JSON.stringify(views) !== JSON.stringify(classes.get())) classes.set(views);
  }

  function wire(e: ClassEntry) {
    if (wired.has(e.classId) || !e.available) return;
    const c = servicesOf(e.classId);
    if (!c) return;
    const offs = [
      (c.info as ClassServiceImpl).detail.subscribe(publish), c.chat.view.subscribe(publish), c.presence.others.subscribe(publish),
    ];
    try {
      offs.push(c.exams.list.subscribe(publish));
    } catch {
      // exams not available yet
    }
    wired.set(e.classId, () => offs.forEach((o) => o()));
  }

  async function load(): Promise<void> {
    const list = await platform.classes.list();
    entries.clear();
    for (const e of list) entries.set(e.classId, e);
    for (const [id, off] of wired) if (!entries.has(id)) {
      off();
      wired.delete(id);
    }
    try {
      order = JSON.parse(ctx.prefs.get('ui.classOrder')) as string[];
    } catch {
      order = [];
    }
    await Promise.all(list.map(readFallback));
    publish();
    if (!syncWired) {
      syncWired = true;
      app().sync.state.subscribe(publish);
      (app().sync as SyncServiceImpl).connections?.subscribe(publish);
      // A class's notification level (`notify.class.<id>`, `notify.default`) shows at once (UI-SHELL).
      ctx.prefs.store.subscribe(publish);
    }
    for (const e of list) if (!e.leaving) wire(e);
    publish();
  }

  async function sign<T extends Record<string, unknown>>(classId: ClassId, path: string, record: T): Promise<T & { sig: { cert: string; value: string } }> {
    const sig = await platform.sync.sign(classId, path, canonicalBytes(record));
    return { ...record, sig };
  }

  return {
    classes,
    load,
    entry: (classId) => entries.get(classId) ?? null,
    async create(input) {
      const identity = ctx.identity.get();
      const device = ctx.device.get() ?? (await platform.sync.identity());
      if (!identity) throw new PlatformError('INVALID', 'no identity yet');
      const name = input.name.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!name) throw new PlatformError('INVALID', 'a class needs a name');
      const nonce = newNonce(ctx.rand);
      const classId = classIdOf(device.deviceId, nonce);
      const root = await platform.classes.root();
      const dirName = unique(root.names, sanitize(name, 'Class'));
      await platform.classes.create({ classId, dirName });
      const now = instant(ctx.clock.now());
      const deviceId = device.deviceId;
      const lang: Lang | 'auto' = input.language;
      const dirs = dirsFor(lang === 'auto' ? ctx.prefs.get('ui.locale') || 'en' : lang);
      const classFile = await sign(classId, '.tramado/class.json', {
        format: 'tramado.class', version: 1, classId, idNonce: nonce, specVersion: '1.1', createdAt: now,
        createdBy: { memberId: identity.memberId, deviceId, name: identity.name.slice(0, 64) }, initialName: name,
      });
      const reg = <T>(value: T) => ({ value, hlc: ctx.hlc.tick() });
      const icon: IconName = input.icon;
      const fields: MetaFile['fields'] = {
        name: reg(name), shortName: reg((input.shortName?.trim() || suggestShortName(name)).slice(0, 12)), colour: reg(input.colour), icon: reg(icon),
        language: reg(lang), dirs: reg(dirs),
        ...(input.lecturer ? { lecturer: reg(input.lecturer.slice(0, 80)) } : {}),
        ...(input.term ? { term: reg(input.term.slice(0, 40)) } : {}),
        ...(input.vocabulary ? { vocabulary: reg(input.vocabulary.slice(0, 500)) } : {}),
      };
      const metaPath = `.tramado/meta/${deviceId}.json`;
      const meta = await sign(classId, metaPath, {
        format: 'tramado.meta', version: 1, deviceId, memberId: identity.memberId, fields,
        organiserOps: [{ op: 'add', memberId: identity.memberId, hlc: ctx.hlc.tick() }], hlc: ctx.hlc.tick(),
      });
      const memberPath = `.tramado/members/${deviceId}.json`;
      const person = await platform.person.prove(classId);
      const info = ctx.info;
      const member = await sign(classId, memberPath, {
        format: 'tramado.member', version: 1, deviceId, memberId: identity.memberId, name: identity.name.slice(0, 64),
        ...(identity.colour ? { colour: identity.colour } : {}), deviceName: (identity.deviceName || identity.name).slice(0, 64),
        joinedAt: now, hlc: ctx.hlc.tick(), addresses: [],
        caps: { cpuOk: false, localModel: null, cloud: false, volunteer: 'off' }, person, vouches: [], formats: { ...FORMATS },
        app: { name: 'Tramado', version: info.version, platform: info.os === 'web' ? 'linux' : info.os },
      } satisfies Omit<MemberFile, 'sig'>);
      const enc = (v: unknown, indent: boolean) => new TextEncoder().encode(indent ? JSON.stringify(v, null, 2) + '\n' : JSON.stringify(v));
      await platform.fs.write(classId, '.tramado/class.json', enc(classFile, true), { own: true });
      await platform.fs.write(classId, metaPath, enc(meta, false), { own: true });
      await platform.fs.write(classId, memberPath, enc(member, false), { own: true });
      for (const d of [dirs.lectures, dirs.documents, dirs.exams, dirs.notes]) await platform.fs.mkdir(classId, d);
      await load();
      if (input.share) await app().sync.share(classId);
      return classId;
    },
    async adopt(pick: Picked) {
      const { entry, foreignMembers } = await platform.classes.adopt(pick.token);
      await load();
      if (foreignMembers) {
        const forked = await (app().sync as SyncServiceImpl).fork(entry.classId);
        await load();
        return forked;
      }
      return entry.classId;
    },
    async archive(classId, archived) {
      await platform.classes.update(classId, { archived });
      await load();
    },
    async forget(classId, opts) {
      try {
        if (opts.trash) await platform.classes.trash(classId);
        else await platform.classes.forget(classId);
      } catch (e) {
        throw toPlatformError(e);
      }
      await load();
    },
    async setOrder(ids) {
      const known = new Set(entries.keys());
      order = [...new Set(ids)].filter((id) => known.has(id));
      await ctx.prefs.set('ui.classOrder', JSON.stringify(order));
      publish();
    },
    suggest(name) {
      const used = classes.get().filter((c) => !c.archived).map((c) => c.color);
      return { shortName: suggestShortName(name), icon: suggestIconFor(name), colour: suggestColourFor(used) };
    },
  };
}
