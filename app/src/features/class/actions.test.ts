import { describe, expect, it } from 'vitest';
import { languageForUi, metaPatch, nameTaken, type ClassForm } from './actions';

const form: ClassForm = { name: 'Direito Constitucional I', shortName: 'DC I', colour: '#12a594', icon: 'scale', lecturer: 'Prof.ª Marta Reis', term: '2026/27', language: 'pt-PT', vocabulary: '', askBeforeJoin: false };

describe('class form (UX §3.3.1)', () => {
  it('finds names already used, ignoring case, accents and spaces', () => {
    const classes = [{ id: 'a', name: 'Estadística I' }, { id: 'b', name: 'Biology 101' }];
    expect(nameTaken('estadistica  i', classes)).toBe(true);
    expect(nameTaken('Estadística I', classes, 'a')).toBe(false);
    expect(nameTaken('Chemistry', classes)).toBe(false);
    expect(nameTaken('   ', classes)).toBe(false);
  });

  it('writes only the fields that changed', () => {
    expect(metaPatch(form, form)).toEqual({});
    expect(metaPatch(form, { ...form, name: ' Direito  Constitucional II ', lecturer: '  ', vocabulary: 'quid iuris', askBeforeJoin: true })).toEqual({
      name: 'Direito Constitucional II', lecturer: null, vocabulary: 'quid iuris', askBeforeAdmit: true,
    });
  });

  it('defaults the lecture language to the UI language', () => {
    expect(languageForUi('pt')).toBe('pt-PT');
    expect(languageForUi('es')).toBe('es-ES');
    expect(languageForUi('en')).toBe('en');
  });
});
