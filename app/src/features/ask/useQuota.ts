// The free-request quota every AI surface shows (UX §3.14.3, §3.15.7): `GET /key` once when no fresh value is known
// (AiService caches it 5 minutes and refreshes it after each batch). Errors are ignored here: the CostLine then
// shows the request count only.
import { useEffect } from 'react';
import type { AppServices } from '../../services/types/common';

const asked = new WeakMap<AppServices, number>();
const TTL_MS = 5 * 60_000;

export function useQuota(services: AppServices, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const s = services.ai.settings.get();
    if (s.customHost) return;
    const now = services.ctx.clock.now();
    const last = asked.get(services) ?? -Infinity;
    if (s.quota && now - last < TTL_MS) return;
    if (now - last < 10_000) return;
    asked.set(services, now);
    void services.ai.refreshQuota().catch(() => undefined);
  }, [services, on]);
}
