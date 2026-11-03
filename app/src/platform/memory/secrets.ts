// Secrets kept in memory only (demo and tests): status reports store 'memory' (architecture §9).
import { PlatformError } from '../../core/errors';
import type { SecretName, SecretStatus } from '../types';

export function createSecrets() {
  const values = new Map<SecretName, string>();
  const status = (name: SecretName): SecretStatus => {
    const v = values.get(name);
    return { set: v !== undefined, last4: v ? v.slice(-4) : null, store: 'memory' };
  };
  return {
    /** Test helper: the stored value (the real platform never returns it). */
    peek: (name: SecretName) => values.get(name) ?? null,
    api: {
      async set(name: SecretName, value: string): Promise<SecretStatus> {
        if ((name as string) === 'person') throw new PlatformError('INVALID', 'reserved secret name');
        if (!/^\S{1,400}$/.test(value)) throw new PlatformError('INVALID', 'a secret is 1–400 characters without spaces');
        values.set(name, value);
        return status(name);
      },
      async status(name: SecretName): Promise<SecretStatus> {
        return status(name);
      },
      async clear(name: SecretName): Promise<void> {
        values.delete(name);
      },
    },
  };
}
