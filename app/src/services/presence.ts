// Presence (folder spec §8.4, sync spec §13): my presence file is written when my activity changes and every 60 s
// while an activity is set (an idle device writes nothing); others' activities are judged stale by watching their
// `seq` change on this device's monotonic clock (seeded at start-up from the connection state and lastSeen).
import { PRESENCE_HEARTBEAT_MS, PresenceTracker, hasActivity } from '../core/sync/presence';
import { parserFor } from '../core/model/parse';
import { classifyPath } from '../core/model/paths';
import { instant, parseRfc3339 } from '../core/model/time';
import type { ClassId, DeviceId } from '../core/model/ids';
import type { PresenceFile } from '../core/model/files';
import type { AppContext } from './context';
import { Store } from './store';
import type { SyncServiceImpl } from './sync';
import type { AppServices, ClassStore } from './types/common';
import type { PresenceService } from './types/sync';

type Others = Record<DeviceId, { activity: PresenceFile['activity']; stale: boolean; power: PresenceFile['power'] }>;

/** Additive (T-SYNC): what ClassService and the library read. */
export interface PresenceServiceImpl extends PresenceService {
  activityOf(deviceId: DeviceId): { activity: PresenceFile['activity'] | null; stale: boolean } | null;
  /** My current activity. */
  mine(): PresenceFile['activity'];
}

export function createPresenceService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): PresenceServiceImpl {
  const { platform, clock } = ctx;
  const { store, classId } = cls;
  const tracker = new PresenceTracker();
  const others = new Store<Others>({});
  let activity: PresenceFile['activity'] = {};
  let seq = 0;
  let heartbeat: (() => void) | null = null;
  let staleTimer: (() => void) | null = null;
  let seeded = false;
  let writing: Promise<void> = Promise.resolve();
  const me = () => ctx.device.get()?.deviceId ?? '';
  const sync = () => app().sync as SyncServiceImpl;

  function publish() {
    const nowMono = clock.mono();
    const nowWall = clock.now();
    const next: Others = {};
    for (const d of tracker.devices()) {
      if (d === me()) continue;
      const f = tracker.file(d)!;
      const act = tracker.activity(d, nowMono, nowWall);
      next[d] = { activity: act ?? {}, stale: tracker.stale(d, nowMono) || act === null, power: f.power };
    }
    if (JSON.stringify(next) !== JSON.stringify(others.get())) others.set(next);
    staleTimer?.();
    const at = tracker.nextStaleAt(nowMono);
    staleTimer = at === null ? null : clock.setTimeout(publish, at - nowMono + 1);
  }

  async function readAll(paths?: string[]) {
    const index = store.state.get().index;
    const list = paths ?? [...index.machine.keys()];
    let stats: Record<DeviceId, { lastSeen: string | null }> | null = null;
    for (const path of list) {
      const info = classifyPath(path);
      if (info.kind !== 'presence' || !info.deviceId || info.deviceId === me()) continue;
      const loaded = await store.readJson(path, parserFor('tramado.presence'));
      if (!loaded || loaded.value.deviceId !== info.deviceId) {
        if (!index.machine.has(path)) tracker.forget(info.deviceId);
        continue;
      }
      if (!seeded && !tracker.changedAt(info.deviceId)) {
        stats ??= await platform.sync.deviceStats().catch(() => ({}));
        const conn = sync().connectionOf?.(info.deviceId);
        const ls = stats[info.deviceId]?.lastSeen ?? conn?.lastSeen ?? null;
        tracker.observe(info.deviceId, loaded.value, clock.mono(), clock.now(), { connected: !!conn?.connected, lastSeenWall: ls ? parseRfc3339(ls) : null });
      } else tracker.observe(info.deviceId, loaded.value, clock.mono(), clock.now());
    }
    seeded = true;
    publish();
  }

  async function write() {
    const deviceId = me();
    const identity = ctx.identity.get();
    if (!deviceId || !identity || !store.state.get().entry.shared || store.state.get().entry.leaving) return;
    const power = await platform.system.power().catch(() => ({ source: 'unknown' as const, percent: null }));
    const file: PresenceFile = {
      format: 'tramado.presence', version: 1, deviceId, memberId: identity.memberId, seq: ++seq, hlc: ctx.hlc.tick(), updatedAt: instant(clock.now()),
      power: power.source, activity, heartbeatS: hasActivity(activity) ? 60 : 0,
    };
    const path = `.tramado/presence/${deviceId}.json`;
    await store.writeJson(path, file, { own: true });
    await platform.sync.scan(classId, path).catch(() => undefined);
  }

  function scheduleHeartbeat() {
    heartbeat?.();
    heartbeat = null;
    if (!hasActivity(activity)) return;
    heartbeat = clock.setTimeout(() => {
      writing = writing.then(write).catch(() => undefined);
      scheduleHeartbeat();
    }, PRESENCE_HEARTBEAT_MS);
  }

  store.onChange(['presence'], (paths) => void readAll(paths));
  store.state.subscribe(() => {
    if (store.state.get().status === 'ready' && !seeded) void readAll();
  });
  queueMicrotask(() => {
    try {
      sync().connections?.subscribe(publish);
    } catch {
      // services disposed
    }
  });

  return {
    others,
    activityOf(d) {
      const o = others.get()[d];
      return o ? { activity: o.activity, stale: o.stale } : null;
    },
    mine: () => activity,
    async setActivity(a) {
      // Continue my seq after a restart (readers judge staleness by seq changes).
      if (seq === 0) {
        const prev = await store.readJson(`.tramado/presence/${me()}.json`, parserFor('tramado.presence')).catch(() => null);
        seq = prev?.value.seq ?? 0;
      }
      const next: PresenceFile['activity'] = a === null ? {} : { ...activity };
      if (a) for (const [k, v] of Object.entries(a) as Array<[keyof PresenceFile['activity'], unknown]>) {
        if (v === undefined || v === null) delete next[k];
        else (next as Record<string, unknown>)[k] = v;
      }
      if (JSON.stringify(next) === JSON.stringify(activity)) return;
      activity = next;
      writing = writing.then(write).catch(() => undefined);
      await writing;
      scheduleHeartbeat();
    },
  };
}
