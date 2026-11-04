// NotesService (architecture §11.2, §13.2; folder spec §8.21; sync spec §16; UX §3.8): class notes
// (Markdown files in the class's notes directory, any member may edit them) and my private notes
// (`private/<classId>/notes/<name>.md`, never synced). Conflict copies made by Syncthing are grouped
// per note and resolved as sync spec §16.3 says: keep one or a merge → written to `<base>.md`
// (atomic) and every copy deleted; keep both → the copy renamed to `<base> (2).md`. The ShortId in a
// copy's name is not its author (§16.4): nothing here names one. `editing(path)` sets presence
// `activity.editing`, which is how others see "Bruno is editing this note".
//
// Private notes have no file events and no mtimes in the private store, so their modification
// times live in `private/<classId>/notes-index.json` ({"format":"tramado.notes-private","version":1,
// "notes":{path:{mtimeMs}}}), next to the notes.
import { PlatformError, toPlatformError } from '../core/errors';
import type { ClassId, ClassPath, DeviceId } from '../core/model/ids';
import { dirOf, validateClassPath } from '../core/model/paths';
import { fitClassPath, sanitize, unique } from '../core/model/sanitize';
import { groupConflicts, keepBothPath, noteTitle } from '../core/notes/conflicts';
import { instant } from '../core/model/time';
import type { AppContext } from './context';
import { Store } from './store';
import type { AppServices, ClassStore } from './types/common';
import type { NoteSummary, NotesService } from './types/notes';

const enc = new TextEncoder();
const dec = new TextDecoder();
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const INDEX = 'notes-index.json';
const PRIVATE_DIR = 'notes';

interface PrivateIndex { format: 'tramado.notes-private'; version: 1; notes: Record<string, { mtimeMs: number }> }

export interface NotesServiceImpl extends NotesService {
  /** Resolves once the list reflects the store and the private notes (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

export function createNotesService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): NotesServiceImpl {
  const { platform } = ctx;
  const { store, classId } = cls;
  const list = new Store<NoteSummary[]>([]);
  const titles = new Map<string, { sig: string; title: string }>();
  let started = false;
  let building: Promise<void> | null = null;
  let again = false;
  const offs: Array<() => void> = [];

  // ── Private notes ────────────────────────────────────────────────────────────────────────────
  async function readIndex(): Promise<PrivateIndex> {
    const bytes = await platform.privateFiles.read(classId, INDEX).catch(() => null);
    try {
      const raw = bytes ? (JSON.parse(dec.decode(bytes)) as PrivateIndex) : null;
      if (raw?.format === 'tramado.notes-private' && raw.notes && typeof raw.notes === 'object') return raw;
    } catch {
      // rebuilt below
    }
    return { format: 'tramado.notes-private', version: 1, notes: {} };
  }
  async function touch(path: string, gone = false): Promise<void> {
    titles.delete(`private:${path}`);
    const ix = await readIndex();
    if (gone) delete ix.notes[path];
    else ix.notes[path] = { mtimeMs: ctx.clock.now() };
    await platform.privateFiles.write(classId, INDEX, enc.encode(JSON.stringify(ix)));
  }
  const privatePath = (path: string) => {
    const p = validateClassPath(path);
    if (!p.startsWith(`${PRIVATE_DIR}/`) || !p.toLowerCase().endsWith('.md')) throw new PlatformError('INVALID', `not a private note path: ${path}`);
    return p;
  };
  const classPath = (path: string) => {
    const p = validateClassPath(path);
    if (!p.toLowerCase().endsWith('.md')) throw new PlatformError('INVALID', `not a note: ${path}`);
    return p;
  };

  // ── The list ─────────────────────────────────────────────────────────────────────────────────
  async function titleOf(scope: 'class' | 'private', path: string, sig: string): Promise<string> {
    const k = `${scope}:${path}`;
    const hit = titles.get(k);
    if (hit && hit.sig === sig) return hit.title;
    const bytes = scope === 'class' ? await store.readBytes(path).catch(() => null) : await platform.privateFiles.read(classId, path).catch(() => null);
    const title = noteTitle(path, bytes ? dec.decode(bytes.subarray(0, 8192)) : null);
    titles.set(k, { sig, title });
    return title;
  }

  function editors(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    let others: Record<DeviceId, { activity: { editing?: { path: ClassPath } }; stale: boolean }> = {};
    let people: Array<{ name: string; devices: Array<{ deviceId: DeviceId }> }> = [];
    try {
      const c = app().forClass(classId);
      others = c.presence.others.get();
      people = c.info.detail.get().people;
    } catch {
      return out;
    }
    for (const [deviceId, o] of Object.entries(others)) {
      const path = o.activity?.editing?.path;
      if (!path || o.stale) continue;
      const name = people.find((p) => p.devices.some((d) => d.deviceId === deviceId))?.name ?? deviceId.slice(0, 7);
      out.set(path, [...(out.get(path) ?? []), name]);
    }
    return out;
  }

  async function build(): Promise<void> {
    const s = store.state.get();
    const conflicts = groupConflicts(s.index.conflicts.map((c) => c.path));
    const editing = editors();
    const out: NoteSummary[] = [];
    for (const n of s.index.notes) {
      out.push({
        scope: 'class', path: n.path, title: await titleOf('class', n.path, `${n.size}:${n.mtimeMs}`), mtimeMs: n.mtimeMs,
        conflict: conflicts.has(n.path), editingBy: editing.get(n.path) ?? [],
      });
    }
    const ix = await readIndex();
    const priv = (await platform.privateFiles.list(classId, PRIVATE_DIR).catch(() => [] as string[])).filter((p) => p.toLowerCase().endsWith('.md'));
    for (const rel of priv) {
      const path = `${PRIVATE_DIR}/${rel}`;
      const mtimeMs = ix.notes[path]?.mtimeMs ?? 0;
      out.push({ scope: 'private', path, title: await titleOf('private', path, String(mtimeMs)), mtimeMs, conflict: false, editingBy: [] });
    }
    out.sort((a, b) => (a.scope === b.scope ? b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path) : a.scope === 'private' ? -1 : 1));
    const prev = list.get();
    if (JSON.stringify(prev) !== JSON.stringify(out)) list.set(out);
  }

  function rebuild(): Promise<void> {
    if (building) {
      again = true;
      return building;
    }
    building = build().catch((e: unknown) => ctx.log('warn', 'notes: list failed', { classId, error: String(e) })).finally(() => {
      building = null;
      if (again) {
        again = false;
        void rebuild();
      }
    });
    return building;
  }

  function start() {
    if (started) return;
    started = true;
    offs.push(store.onChange(['note', 'conflict'], () => void rebuild()));
    try {
      const c = app().forClass(classId);
      offs.push(c.presence.others.subscribe(() => void rebuild()));
    } catch {
      // no presence service yet
    }
    void rebuild();
  }
  const lazyList = {
    get: () => {
      start();
      return list.get();
    },
    subscribe: (l: () => void) => {
      start();
      return list.subscribe(l);
    },
  };

  const afterPrivateChange = async (path: string, gone = false) => {
    await touch(path, gone);
    app().search.refresh?.(classId);
    await rebuild();
  };

  const notesDir = () => store.dir('notes');
  async function classSiblings(dir: string): Promise<string[]> {
    try {
      return (await platform.fs.list(classId, dir, { recursive: false })).map((e) => e.name);
    } catch (e) {
      if (toPlatformError(e).code === 'NOT_FOUND') return [];
      throw e;
    }
  }
  async function privateSiblings(): Promise<string[]> {
    return (await platform.privateFiles.list(classId, PRIVATE_DIR).catch(() => [] as string[])).filter((p) => !p.includes('/'));
  }
  const fileName = (title: string, taken: string[]) => unique(taken, sanitize(`${sanitize(title, 'Untitled').replace(/\.md$/i, '')}.md`, 'Untitled.md'));

  /** Writes `text` as the first `# ` heading's new title (or adds one). */
  const retitle = (text: string, title: string) => {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => /^\s{0,3}#\s+/.test(l));
    if (i >= 0) lines[i] = `# ${title}`;
    else lines.unshift(`# ${title}`, '');
    return lines.join('\n');
  };

  async function scanDir(path: string) {
    if (!store.state.get().entry.shared) return;
    await platform.sync.scan(classId, dirOf(path) || undefined).catch(() => undefined);
  }

  const service: NotesServiceImpl = {
    list: lazyList,
    async read(scope, path) {
      if (scope === 'private') {
        const bytes = await platform.privateFiles.read(classId, privatePath(path));
        if (!bytes) throw new PlatformError('NOT_FOUND', `no note ${path}`);
        return dec.decode(bytes);
      }
      const bytes = await store.readBytes(classPath(path));
      if (!bytes) throw new PlatformError('NOT_FOUND', `no note ${path}`);
      return dec.decode(bytes);
    },
    async save(scope, path, text) {
      if (scope === 'private') {
        await platform.privateFiles.write(classId, privatePath(path), enc.encode(text));
        await afterPrivateChange(path);
        return;
      }
      // A class note is content, written by anyone: an atomic write, not an "own" machine file.
      await store.writeText(classPath(path), text, { own: false });
      await scanDir(path);
    },
    async create(scope, title) {
      const body = `# ${title.trim() || 'Untitled'}\n\n`;
      if (scope === 'private') {
        const name = fileName(title, await privateSiblings());
        const path = validateClassPath(`${PRIVATE_DIR}/${name}`);
        await platform.privateFiles.write(classId, path, enc.encode(body));
        await afterPrivateChange(path);
        return path;
      }
      const dir = notesDir();
      const name = fileName(title, await classSiblings(dir));
      const path = fitClassPath(dir, name);
      if (!path) throw new PlatformError('INVALID', 'the note title is too long');
      await platform.fs.mkdir(classId, dir).catch(() => undefined);
      await store.writeText(validateClassPath(path), body, { own: false });
      await scanDir(path);
      return path;
    },
    async rename(scope, path, title) {
      const text = retitle(await service.read(scope, path), title.trim() || 'Untitled');
      if (scope === 'private') {
        const p = privatePath(path);
        const name = fileName(title, (await privateSiblings()).filter((n) => n !== nameOf(p)));
        const next = validateClassPath(`${PRIVATE_DIR}/${name}`);
        await platform.privateFiles.write(classId, next, enc.encode(text));
        if (next !== p) {
          await platform.privateFiles.remove(classId, p);
          await touch(p, true);
        }
        await afterPrivateChange(next);
        return next;
      }
      const p = classPath(path);
      const dir = dirOf(p);
      const name = fileName(title, (await classSiblings(dir)).filter((n) => n !== nameOf(p)));
      const next = fitClassPath(dir, name) ?? p;
      await store.writeText(p, text, { own: false });
      if (next !== p) await store.move(p, next);
      await scanDir(next);
      return next;
    },
    async remove(scope, path) {
      if (scope === 'private') {
        await platform.privateFiles.remove(classId, privatePath(path));
        await afterPrivateChange(path, true);
        return;
      }
      await store.remove(classPath(path));
      await scanDir(path);
    },
    async conflicts(path) {
      const p = classPath(path);
      const copies = groupConflicts(store.state.get().index.conflicts.map((c) => c.path)).get(p) ?? [];
      const base = await store.readBytes(p);
      const out: Array<{ path: ClassPath; text: string }> = [];
      for (const c of copies) {
        const bytes = await store.readBytes(c.path);
        if (bytes) out.push({ path: c.path, text: dec.decode(bytes) });
      }
      return { base: base ? dec.decode(base) : '', copies: out };
    },
    async resolve(path, choice) {
      const p = classPath(path);
      const copies = (groupConflicts(store.state.get().index.conflicts.map((c) => c.path)).get(p) ?? []).map((c) => c.path);
      if ('keepBoth' in choice) {
        const taken = await classSiblings(dirOf(p));
        for (const c of copies) {
          const target = keepBothPath(p, taken.filter((n) => n !== nameOf(c)));
          taken.push(nameOf(target));
          await store.move(c, target);
        }
      } else {
        let text: string | null = null;
        if ('merged' in choice) text = choice.merged;
        else if (choice.keep !== 'base') {
          if (!copies.includes(choice.keep)) throw new PlatformError('NOT_FOUND', `${choice.keep} is not a conflict copy of ${p}`);
          const bytes = await store.readBytes(choice.keep);
          if (!bytes) throw new PlatformError('NOT_FOUND', `no ${choice.keep}`);
          text = dec.decode(bytes);
        }
        if (text !== null) await store.writeText(p, text, { own: false });
        for (const c of copies) await store.remove(c).catch((e: unknown) => {
          if (toPlatformError(e).code !== 'NOT_FOUND') throw e;
        });
      }
      await scanDir(p);
      await rebuild();
    },
    editing(path) {
      const presence = (() => {
        try {
          return app().forClass(classId).presence;
        } catch {
          return null;
        }
      })();
      if (!presence) return;
      const activity = path ? { editing: { path, since: instant(ctx.clock.now()) } } : { editing: undefined };
      void presence.setActivity(activity as Parameters<typeof presence.setActivity>[0]).catch(() => undefined);
    },
    async idle() {
      start();
      for (let i = 0; i < 20 && building; i++) await building;
    },
    dispose() {
      for (const off of offs.splice(0)) off();
      started = false;
    },
  };
  return service;
}
