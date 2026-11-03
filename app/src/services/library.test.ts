import { describe, expect, it } from 'vitest';
import { verifyPersonProof, verifySig } from '../core/model/sig';
import { createServices } from './index';
import { createTestContext } from './testing/context';
import { suggestColourFor, suggestIconFor, suggestShortName } from './library';

const dec = new TextDecoder();

describe('library (impl-min)', () => {
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
});
