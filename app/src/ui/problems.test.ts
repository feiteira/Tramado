import { describe, expect, it } from 'vitest';
import { catalogs } from '../core/i18n/catalogs';
import { translate } from '../core/i18n/translate';
import { PlatformError } from '../core/errors';
import { problemKey, problemOf } from './problems';

describe('problems said in words', () => {
  it('maps codes and OS texts to error sentences', () => {
    expect(problemOf(new PlatformError('IO_ERROR', 'file error: No space left on device (os error 28)'))).toBe('DISK_FULL');
    expect(problemOf(new PlatformError('IO_ERROR', 'There is not enough space on the disk. (os error 112)'))).toBe('DISK_FULL');
    expect(problemOf(new PlatformError('IO_ERROR', 'file error: Permission denied (os error 13)'))).toBe('PERMISSION_DENIED');
    expect(problemOf(new PlatformError('AI_BUSY'))).toBe('AI_BUSY');
    expect(problemOf({ code: 'NOT_FOUND', message: 'x' })).toBe('NOT_FOUND');
    expect(problemOf(new Error('boom'))).toBeNull();
    expect(translate(catalogs.pt, catalogs.en, problemKey(new PlatformError('DISK_FULL'))!)).toBe('O disco está cheio. Liberte algum espaço e tente novamente.');
  });
});
