// The demo's URL parameters, route and dialog resolution, and the M0 seed (spec-conformant, signed files).
import { describe, expect, it } from 'vitest';
import { verifyPersonProof, verifySig } from '../core/model/sig';
import { parseIdentity } from '../services/identity';
import { createMemoryPlatform } from '../platform/memory';
import type { MemberFile } from '../core/model/files';
import { demoDialog, demoRoute, parseDemoFlags } from './boot';
import { DEMO_CLASSES, seedDemo } from './seed';
import { emptyDemoKeys, MISSING_ID } from './keys';

const NOW = Date.UTC(2026, 10, 3, 15, 30);
const dec = new TextDecoder();

describe('parseDemoFlags (UX §7.2)', () => {
  it('defaults to the first value of each row', () => {
    const f = parseDemoFlags('');
    expect(f).toMatchObject({
      empty: false, lang: 'en', theme: 'light', clock: '2026-11-03T15:30', name: 'Ana Ribeiro', route: 'today', ai: 'fake', sync: 'fake',
      model: 'ready', speech: null, recording: false, join: null, unverified: false, conflict: false, dialog: null, code: null,
    });
  });
  it('parses every parameter and ignores unknown values', () => {
    const f = parseDemoFlags('?demo=empty&lang=pt&theme=dark&route=exam&class=law&tab=chat&exam=mock&q=IIb&mode=practice&at=12000&cite=1&section=ai&ai=busy&speech=fake&model=downloading&sync=offline&recording=1&join=ask&unverified=1&conflict=1&dialog=record&code=abc&page=9&quote=x');
    expect(f).toMatchObject({
      empty: true, lang: 'pt', theme: 'dark', route: 'exam', class: 'law', tab: 'chat', exam: 'mock', q: 'IIb', mode: 'practice', at: 12000, cite: true,
      section: 'ai', ai: 'busy', speech: 'fake', model: 'downloading', sync: 'offline', recording: true, join: 'ask', unverified: true, conflict: true,
      dialog: 'record', code: 'abc', page: 9, quote: 'x',
    });
    expect(parseDemoFlags('?lang=fr&route=nope&tab=x&dialog=pair&ai=?').lang).toBe('en');
    expect(parseDemoFlags('?route=nope').route).toBe('today');
    expect(parseDemoFlags('?tab=x').tab).toBeNull();
    expect(parseDemoFlags('?dialog=pair').dialog).toBeNull();
  });
});

describe('demoRoute and demoDialog', () => {
  const keys = { ...emptyDemoKeys(), classes: { law: 'tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa' } };
  it('resolves keys and sends unknown ones to the Missing state', () => {
    expect(demoRoute(parseDemoFlags('?route=class&class=law&tab=documents'), keys)).toEqual({ name: 'class', classId: keys.classes.law, tab: 'documents' });
    expect(demoRoute(parseDemoFlags('?route=class&class=zzz'), keys)).toEqual({ name: 'class', classId: MISSING_ID });
    expect(demoRoute(parseDemoFlags('?route=lecture&class=law&lecture=l6'), keys)).toMatchObject({ name: 'lecture', classId: MISSING_ID });
    expect(demoRoute(parseDemoFlags('?route=settings&section=privacy'), keys)).toEqual({ name: 'settings', section: 'privacy' });
    expect(demoRoute(parseDemoFlags('?route=practice'), keys)).toEqual({ name: 'practice', classId: keys.classes.law });
  });
  it('gives every dialog its props', () => {
    expect(demoDialog(parseDemoFlags(''), keys, NOW)).toBeNull();
    expect(demoDialog(parseDemoFlags('?dialog=record&class=law'), keys, NOW)).toEqual({ id: 'record', props: { classId: keys.classes.law } });
    expect(demoDialog(parseDemoFlags('?dialog=join&code=xyz'), keys, NOW)).toEqual({ id: 'join', props: { code: 'xyz' } });
    expect(demoDialog(parseDemoFlags('?dialog=save'), keys, NOW)?.props).toMatchObject({ recording: { classId: keys.classes.law, state: 'stopped' } });
  });
});

describe('seedDemo (M0 minimal seed)', () => {
  it('writes the four classes as signed, spec-conformant files', async () => {
    const platform = createMemoryPlatform({ kind: 'demo', clock: { now: () => NOW } });
    const keys = await seedDemo(platform, { lang: 'pt', theme: 'dark', name: 'Ana Ribeiro', nowMs: NOW, empty: false });
    const identity = parseIdentity(await platform.appFiles.read('identity.json'));
    expect(identity?.name).toBe('Ana Ribeiro');
    const prefs = JSON.parse((await platform.appFiles.read('prefs.json')) ?? '{}') as Record<string, string>;
    expect(prefs['ui.locale']).toBe('pt');
    expect(JSON.parse(prefs['ui.classOrder'] ?? '[]')).toEqual(DEMO_CLASSES.map((d) => keys.classes[d.key]));
    const entries = await platform.classes.list();
    expect(entries).toHaveLength(4);
    const me = platform.mem.deviceId;
    for (const def of DEMO_CLASSES) {
      const classId = keys.classes[def.key]!;
      const e = entries.find((x) => x.classId === classId)!;
      expect(e).toMatchObject({ shared: def.shared, archived: def.archived, available: true, dirName: def.name });
      const read = async (p: string) => JSON.parse(dec.decode(await platform.fs.read(classId, p))) as Record<string, unknown>;
      expect(await verifySig(await read('.tramado/class.json'), classId, '.tramado/class.json', me)).toBe(true);
      const meta = await read(`.tramado/meta/${me}.json`);
      expect(await verifySig(meta, classId, `.tramado/meta/${me}.json`, me)).toBe(true);
      expect((meta.fields as Record<string, { value: unknown }>).colour?.value).toBe(def.colour);
      const member = (await read(`.tramado/members/${me}.json`)) as unknown as MemberFile;
      expect(await verifySig(member as unknown as Record<string, unknown>, classId, `.tramado/members/${me}.json`, me)).toBe(true);
      expect(await verifyPersonProof(member, classId)).toBe(true);
    }
    // The pt class gets Portuguese folders, the en class English ones.
    expect((await platform.fs.stat(keys.classes.law!, 'Aulas'))?.isDir).toBe(true);
    expect((await platform.fs.stat(keys.classes.bio!, 'Lectures'))?.isDir).toBe(true);
    expect((await platform.fs.stat(keys.classes.stats!, 'Apuntes'))?.isDir ?? (await platform.fs.stat(keys.classes.stats!, 'Documentos'))?.isDir).toBe(true);
  });

  it('demo=empty writes only the prefs', async () => {
    const platform = createMemoryPlatform({ kind: 'demo' });
    const keys = await seedDemo(platform, { lang: 'es', theme: 'light', name: 'Ana Ribeiro', nowMs: NOW, empty: true });
    expect(keys.classes).toEqual({});
    expect(await platform.appFiles.read('identity.json')).toBeNull();
    expect(await platform.classes.list()).toEqual([]);
  });
});
