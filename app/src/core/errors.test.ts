import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ERROR_CODES, PlatformError, errorData, toPlatformError } from './errors';
import { catalogs } from './i18n/catalogs';

const vectors = JSON.parse(readFileSync(new URL('../../../test-vectors/error-codes.json', import.meta.url), 'utf8')) as { codes: string[] };

describe('errors', () => {
  it('lists exactly the codes of test-vectors/error-codes.json, in order', () => {
    expect([...ERROR_CODES]).toEqual(vectors.codes);
  });

  it('has one translated sentence per code in every language', () => {
    for (const lang of ['en', 'pt', 'es'] as const) {
      const errs = catalogs[lang].errors as Record<string, string>;
      for (const c of ERROR_CODES) expect(errs[c], `${lang} ${c}`).toBeTruthy();
    }
  });

  it('maps Rust objects, Tauri strings and stray errors', () => {
    const e = toPlatformError({ code: 'DISK_FULL', message: 'full', data: { needBytes: 3 } });
    expect(e).toBeInstanceOf(PlatformError);
    expect(e.code).toBe('DISK_FULL');
    expect(errorData(e)).toEqual({ needBytes: 3 });
    expect(toPlatformError({ code: 'WHAT', message: 'x' }).code).toBe('IO_ERROR');
    expect(toPlatformError('Command app_nope not found').code).toBe('INVALID');
    expect(toPlatformError('disk on fire').code).toBe('IO_ERROR');
    expect(toPlatformError(new Error('boom')).message).toBe('boom');
    const same = new PlatformError('CANCELLED');
    expect(toPlatformError(same)).toBe(same);
    expect(same.message).toBe('CANCELLED');
  });
});
