// The class library (architecture §11.2). M0: impl-min — lists the registry entries with the name,
// colour and icon of `class.json` and the creator's own meta file (no LWW fold across devices), creates,
// archives and forgets classes. T-SYNC replaces the view with the folded meta (folder spec §8.2).
import { PlatformError, toPlatformError } from '../core/errors';
import { classIdOf, newNonce } from '../core/model/derive';
import { dirsFor } from '../core/model/dirs';
import { CLASS_COLOURS, iconOrDefault, suggestColourFor, suggestIconFor, suggestShortName } from '../core/model/icons';

export { CLASS_COLOURS, suggestColourFor, suggestIconFor, suggestShortName };
import { isColourHex, shortIdOf, type ClassId, type ColourHex, type IconName, type Lang } from '../core/model/ids';
import { sanitize, unique } from '../core/model/sanitize';
import { canonicalBytes } from '../core/model/sig';
import { instant } from '../core/model/time';
import { FORMATS } from '../core/model/formats';
import type { ClassFile, MemberFile, MetaFile } from '../core/model/files';
import type { ClassEntry, Picked } from '../platform/types';
import type { AppContext } from './context';
import { Store } from './store';
import type { AppServices } from './types/common';
import type { ClassLibrary } from './types/library';
import type { ClassView } from './types/viewModels';

export interface ClassLibraryImpl extends ClassLibrary {
  /** The registry entry of a class (services/index.ts creates ClassServices from it). */
  entry(classId: ClassId): ClassEntry | null;
}

const dec = new TextDecoder();

export function createLibrary(ctx: AppContext, app: () => AppServices): ClassLibraryImpl {
  void app;
  const { platform } = ctx;
  const classes = new Store<ClassView[]>([]);
  const entries = new Map<ClassId, ClassEntry>();

  async function readJson<T>(classId: ClassId, path: string): Promise<T | null> {
    try {
      return JSON.parse(dec.decode(await platform.fs.read(classId, path))) as T;
    } catch {
      return null;
    }
  }

  async function viewOf(e: ClassEntry): Promise<ClassView> {
    const cf = e.available ? await readJson<ClassFile>(e.classId, '.tramado/class.json') : null;
    const creator = cf?.createdBy?.deviceId;
    const meta = creator ? await readJson<MetaFile>(e.classId, `.tramado/meta/${creator}.json`) : null;
    const f = meta?.fields ?? {};
    const name = (f.name?.value as string | undefined) ?? cf?.initialName ?? e.dirName;
    const colour = isColourHex(f.colour?.value) ? f.colour.value : null;
    const notify = ctx.prefs.get(`notify.class.${e.classId}`) || ctx.prefs.get('notify.default');
    return {
      id: e.classId, name, shortName: (f.shortName?.value as string | undefined) ?? suggestShortName(name),
      color: colour ?? CLASS_COLOURS[11], icon: f.icon ? iconOrDefault(f.icon.value) : suggestIconFor(name),
      lecturer: (f.lecturer?.value as string | null | undefined) ?? null, term: (f.term?.value as string | null | undefined) ?? null,
      language: (f.language?.value as string | undefined) ?? 'auto', vocabulary: (f.vocabulary?.value as string | null | undefined) ?? '',
      shared: e.shared, archived: e.archived, path: e.path,
      sync: e.available ? (e.shared ? { kind: 'waiting' } : { kind: 'local' }) : { kind: 'missingFolder' },
      onlineMembers: 0, memberCount: 1, unread: 0, mentions: 0, recordingBy: null, nextExams: [], pins: [],
      notify: notify === 'all' || notify === 'none' ? notify : 'important', askBeforeJoin: f.askBeforeAdmit?.value === true,
      skipAudio: e.skipAudio, organisers: cf ? [cf.createdBy.memberId] : [], newerFormat: (cf?.version ?? 1) > FORMATS['tramado.class'],
    };
  }

  async function load(): Promise<void> {
    const list = await platform.classes.list();
    entries.clear();
    for (const e of list) entries.set(e.classId, e);
    const views = await Promise.all(list.map(viewOf));
    let order: string[] = [];
    try {
      order = JSON.parse(ctx.prefs.get('ui.classOrder')) as string[];
    } catch {
      order = [];
    }
    const pos = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + list.findIndex((e) => e.classId === id));
    classes.set(views.sort((a, b) => pos(a.id) - pos(b.id)));
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
      const name = input.name.normalize('NFC').trim().slice(0, 120);
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
        name: reg(name), shortName: reg((input.shortName ?? suggestShortName(name)).slice(0, 12)), colour: reg(input.colour), icon: reg(icon),
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
      void shortIdOf;
      await load();
      return classId;
    },
    async adopt(pick: Picked) {
      const { entry } = await platform.classes.adopt(pick.token);
      await load();
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
    suggest(name) {
      const used = classes.get().filter((c) => !c.archived).map((c) => c.color);
      return { shortName: suggestShortName(name), icon: suggestIconFor(name), colour: suggestColourFor(used) };
    },
  };
}
