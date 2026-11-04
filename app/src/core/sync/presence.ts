// Presence staleness (folder spec §8.4, sync spec §13): judged on the reader's own monotonic clock by watching each
// presence file's `seq` change, never by comparing remote timestamps. A file first seen at start-up is seeded at
// "now" when its writer is connected, otherwise at max(lastSeen, now − 3 min). An activity whose `updatedAt` is more
// than 24 h older than the reader's wall clock is ignored.
import { parseRfc3339 } from '../model/time';
import type { DeviceId } from '../model/ids';
import type { PresenceFile } from '../model/files';

export const PRESENCE_STALE_MS = 180_000;
export const PRESENCE_HEARTBEAT_MS = 60_000;
export const PRESENCE_MAX_AGE_MS = 86_400_000;

export interface PresenceSeed { connected: boolean; lastSeenWall: number | null }

export class PresenceTracker {
  private readonly seen = new Map<DeviceId, { seq: number; at: number; file: PresenceFile }>();

  /**
   * Records a presence file read at monotonic `nowMono` / wall `nowWall`. `seed` is consulted only the first time a
   * device's file is seen (sync spec §13 start-up rule).
   */
  observe(deviceId: DeviceId, file: PresenceFile, nowMono: number, nowWall: number, seed?: PresenceSeed): void {
    const prev = this.seen.get(deviceId);
    if (!prev) {
      let at = nowMono;
      if (seed && !seed.connected) {
        const ago = seed.lastSeenWall === null ? PRESENCE_STALE_MS : Math.min(PRESENCE_STALE_MS, Math.max(0, nowWall - seed.lastSeenWall));
        at = nowMono - ago;
      }
      this.seen.set(deviceId, { seq: file.seq, at, file });
      return;
    }
    if (file.seq !== prev.seq) this.seen.set(deviceId, { seq: file.seq, at: nowMono, file });
    else this.seen.set(deviceId, { ...prev, file });
  }

  forget(deviceId: DeviceId): void {
    this.seen.delete(deviceId);
  }

  /** The last monotonic time this device's `seq` changed, or null. */
  changedAt(deviceId: DeviceId): number | null {
    return this.seen.get(deviceId)?.at ?? null;
  }

  stale(deviceId: DeviceId, nowMono: number): boolean {
    const s = this.seen.get(deviceId);
    return !s || nowMono - s.at >= PRESENCE_STALE_MS;
  }

  /** The device's activity when it may be used (not stale, not older than 24 h by `updatedAt`), else null. */
  activity(deviceId: DeviceId, nowMono: number, nowWall: number): PresenceFile['activity'] | null {
    const s = this.seen.get(deviceId);
    if (!s) return null;
    const updated = parseRfc3339(s.file.updatedAt);
    if (updated !== null && nowWall - updated > PRESENCE_MAX_AGE_MS) return null;
    return s.file.activity ?? {};
  }

  file(deviceId: DeviceId): PresenceFile | null {
    return this.seen.get(deviceId)?.file ?? null;
  }

  devices(): DeviceId[] {
    return [...this.seen.keys()];
  }

  /** When the next device goes stale (for a timer), or null. */
  nextStaleAt(nowMono: number): number | null {
    let next: number | null = null;
    for (const s of this.seen.values()) {
      const t = s.at + PRESENCE_STALE_MS;
      if (t > nowMono && (next === null || t < next)) next = t;
    }
    return next;
  }
}

/** Whether an activity object has anything set (writes heartbeat only while it does). */
export const hasActivity = (a: PresenceFile['activity'] | null | undefined): boolean =>
  !!a && (a.recording !== undefined || a.transcribing !== undefined || a.editing !== undefined);
