import { describe, expect, it } from 'vitest';
import { signRecord } from './sign';
import { verifySig } from '../model/sig';
import { testDevice } from './keys.testutil';

describe('signRecord (folder spec §6.6)', () => {
  it('signs the canonical record without sig', async () => {
    const d = await testDevice();
    const cls = 'tramado-geznkyujw4ofedwinfcmzl2rim';
    const path = `.tramado/bans/${d.deviceId}.json`;
    const rec = { format: 'tramado.bans', version: 1, deviceId: d.deviceId, entries: [], sig: { cert: 'old', value: 'old' } };
    const signed = await signRecord((c, p, canonical) => d.sign(c, p, JSON.parse(new TextDecoder().decode(canonical))), cls, path, rec);
    expect(await verifySig(signed, cls, path, d.deviceId)).toBe(true);
  });
});
