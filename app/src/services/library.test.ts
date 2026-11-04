import { describe, expect, it } from 'vitest';
import { verifyPersonProof, verifySig } from '../core/model/sig';
import { createServices } from './index';
import { createTestContext } from './testing/context';
import { suggestColourFor, suggestIconFor, suggestShortName } from './library';
import { allowed } from './notifications';

const dec = new TextDecoder();

describe('library', () => {
  it('creates a class with signed class.json, meta and member files, and lists it', async () => {
    const { ctx, platform } = await createTestContext({ name: 'Ana Ribeiro' });
    const s = createServices(ctx);
    const classId = await s.library.create({ name: 'Direito Constitucional I', colour: '#12a594', icon: 'scale', language: 'pt-PT', share: false, lecturer: 'Prof.ª Marta Reis' });
    const views = s.library.classes.get();
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ id: classId, name: 'Direito Constitucional I', shortName: 'DC I', color: '#12a594', icon: 'scale', lecturer: 'Prof.ª Marta Reis', shared: false, sync: { kind: 'local' } });
    const dev = platform.mem.deviceId;
    const cf = JSON.parse(dec.decode(await platform.fs.read(classId, '.tramado/class.json')));
    expect(await verifySig(cf, classId, '.tramado/class.json', dev)).toBe(true);
    const member = JSON.parse(dec.decode(await platform.fs.read(classId, `.tramado/members/${dev}.json`)));
    expect(await verifySig(member, classId, `.tramado/members/${dev}.json`, dev)).toBe(true);
    expect(await verifyPersonProof(member, classId)).toBe(true);
    const meta = JSON.parse(dec.decode(await platform.fs.read(classId, `.tramado/meta/${dev}.json`)));
    expect(meta.fields.dirs.value).toEqual({ lectures: 'Aulas', documents: 'Documentos', exams: 'Exames', notes: 'Notas', fromChat: 'Do chat' });
    expect((await platform.fs.list(classId, '', { recursive: false })).map((e) => e.path)).toEqual(['Aulas', 'Documentos', 'Exames', 'Notas']);
    const cls = s.forClass(classId);
    await (cls.store as unknown as { idle(): Promise<void> }).idle();
    expect(cls.store.state.get().status).toBe('ready');
    await s.library.archive(classId, true);
    expect(s.library.classes.get()[0]!.archived).toBe(true);
    s.dispose();
  });

  it('suggests short names, icons and colours (UX §1.3)', () => {
    expect(suggestShortName('Direito Constitucional I')).toBe('DC I');
    expect(suggestIconFor('Estadística I')).toBe('sigma');
    expect(suggestIconFor('História do Direito Português')).toBe('scale');
    expect(suggestIconFor('Cell biology')).toBe('dna');
    expect(suggestIconFor('Tópicos')).toBe('book-open');
    expect(suggestColourFor(['#e5484d'])).toBe('#f76b15');
  });

  it('folds the views from the class services (meta LWW, sync state, notify level)', async () => {
    const { ctx } = await createTestContext({ name: 'Ana Ribeiro' });
    const s = createServices(ctx);
    const classId = await s.library.create({ name: 'Biologia Celular', colour: '#30a46c', icon: 'dna', language: 'pt-PT', share: false });
    const cls = s.forClass(classId);
    await (cls.info as unknown as { ready(): Promise<void> }).ready();
    await cls.info.setMeta({ name: 'Biologia Celular e Molecular', shortName: 'BCM', term: '2026/27 · S1' });
    const v = s.library.classes.get().find((c) => c.id === classId)!;
    expect(v).toMatchObject({ name: 'Biologia Celular e Molecular', shortName: 'BCM', term: '2026/27 · S1', sync: { kind: 'local' }, memberCount: 1, notify: 'important' });
    await ctx.prefs.set(`notify.class.${classId}`, 'none');
    await s.library.load();
    expect(s.library.classes.get()[0]!.notify).toBe('none');
    expect(s.library.suggest('Estatística').icon).toBe('sigma');
    s.dispose();
  });

  it('notification preferences (UX §3.14.6)', () => {
    const prefs = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? ({ 'notify.system': '1', 'notify.default': 'important', 'notify.joins': '1', 'notify.transcripts': '1', 'notify.exams': '1', 'notify.model': '1' } as Record<string, string>)[k] ?? '' });
    expect(allowed(prefs({}), 'mention', 'c1')).toBe(true);
    expect(allowed(prefs({}), 'chat', 'c1')).toBe(false);
    expect(allowed(prefs({ 'notify.class.c1': 'all' }), 'chat', 'c1')).toBe(true);
    expect(allowed(prefs({ 'notify.class.c1': 'none' }), 'mention', 'c1')).toBe(false);
    expect(allowed(prefs({ 'notify.joins': '0' }), 'join', 'c1')).toBe(false);
    expect(allowed(prefs({ 'notify.system': '0' }), 'model', null)).toBe(false);
  });
});
