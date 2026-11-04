import { describe, expect, it } from 'vitest';
import { modelBusy } from './catalog';

describe('modelBusy (INT: the key test\'s "works, but the free model is busy")', () => {
  const ep = (o: Record<string, unknown>) => ({ data: { id: 'google/gemma-4-31b-it:free', endpoints: [{ name: 'Google AI Studio', ...o }] } });
  it('reads the endpoints\' status and recent uptime', () => {
    expect(modelBusy(ep({ status: 0, uptime_last_5m: 100, uptime_last_30m: 100 }))).toBe(false);
    expect(modelBusy(ep({ status: 0, uptime_last_5m: 12, uptime_last_30m: 80 }))).toBe(true);
    expect(modelBusy(ep({ status: 0, uptime_last_30m: 20 }))).toBe(true);
    expect(modelBusy(ep({ status: -2, uptime_last_5m: 100 }))).toBe(true);
    expect(modelBusy(ep({}))).toBe(false);
    // One healthy endpoint is enough.
    expect(modelBusy({ data: { endpoints: [{ uptime_last_5m: 5 }, { uptime_last_5m: 99 }] } })).toBe(false);
  });
  it('says nothing about bodies without endpoints', () => {
    expect(modelBusy(null)).toBeNull();
    expect(modelBusy({ data: { endpoints: [] } })).toBeNull();
    expect(modelBusy({ error: { code: 404 } })).toBeNull();
  });
});
