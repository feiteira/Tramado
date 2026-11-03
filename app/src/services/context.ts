// What every service is created with (architecture §11.2). Frozen after M0.
import type { ColourHex, DeviceId, Hlc, Instant, MemberId, ShortId, ClassId } from '../core/model/ids';
import type { Locator, SourceRef } from '../core/model/files';
import type { AppInfo, Platform, PrivacyLevel } from '../platform/types';
import type { ReadableStore } from './store';
import type { PrefsStore } from './prefs';
import type { DocSummary, TextCache } from './types/documents';
import type { Passage } from './types/search';

export type { Parsed } from '../core/model/parse';
export type { PrefsStore };

export interface Clock { now(): number; mono(): number; setTimeout(f: () => void, ms: number): () => void }
export interface ImagePrep { prepare(bytes: Uint8Array, mime: string, maxSide: number, quality: number): Promise<{ jpeg: Uint8Array; width: number; height: number }> }
export interface PdfRender { pages(bytes: Uint8Array): Promise<number>; renderJpeg(bytes: Uint8Array, page: number, maxSide: number): Promise<Uint8Array> }
export interface AppContext {
  platform: Platform; info: AppInfo; clock: Clock; rand: () => number;
  prefs: PrefsStore;                               // typed view of prefs.json (§13.3)
  identity: ReadableStore<Identity | null>;
  device: ReadableStore<{ deviceId: DeviceId; shortId: ShortId } | null>;   // from sync.identity()
  hlc: HlcClock;
  imagePrep: ImagePrep; pdfRender: PdfRender;      // DOM/worker-backed in the app, fakes in tests
  indexHost: IndexHost; extractHost: ExtractHost;  // worker-backed in main.tsx and demo/boot.ts; createInlineHost() in Vitest
  log: (level: 'error' | 'warn' | 'info', msg: string, data?: object) => void;
}
export interface Identity { memberId: MemberId; name: string; deviceName: string; colour: ColourHex | null; personPub: string; createdAt: Instant }
export interface HlcClock {
  tick(): Hlc;                                     // folder spec §3.3 (persists the ceiling before use)
  observe(stamp: Hlc): 'ok' | 'ahead';             // 'ahead' = more than 1 h in the future: ordered, not observed
  override(current: Hlc | null): Hlc;              // max(tick(), succ(current)) for LWW registers (folder spec §3.4)
}
export interface IndexHost {                       // workers/rpc.ts; same messages as search.worker (§11.7)
  load(classId: ClassId, docs: Array<{ key: string; text: string; units: TextCache['units'] }>): Promise<void>;
  upsert(classId: ClassId, key: string, text: string, units: TextCache['units']): Promise<void>;
  remove(classId: ClassId, key: string): Promise<void>;
  query(scope: ClassId | 'all', q: string, opts?: { limit?: number; kinds?: Array<SourceRef['kind']>; exclude?: string[] }): Promise<Passage[]>;
  passage(classId: ClassId, id: string, opts?: { offset?: number; max?: number }): Promise<(Passage & { hasMore: boolean }) | null>;
  find(scope: ClassId | 'all', q: string, opts?: { limit?: number }): Promise<Array<{ classId: ClassId; key: string; before: string; match: string; after: string; start: number }>>;
  stats(classId: ClassId): Promise<{ docs: number; chars: number }>;
}
export interface ExtractHost {
  extract(bytes: Uint8Array, kind: DocSummary['kind'], name: string, onProgress: (p: number) => void, signal: AbortSignal): Promise<TextCache>;
}
export interface CatalogModel {                    // core/ai/catalog.ts, from GET /models (24 h cache)
  id: string; label: string /* UX §8 OQ13 */; free: boolean; context: number; tools: boolean; vision: boolean;
  levels: PrivacyLevel[];                          // privacy levels at which at least one endpoint serves it
}
export type { Locator };

/** The real clock (desktop and demo; the demo's freeze() makes Date.now() fixed). */
export const systemClock: Clock = {
  now: () => Date.now(),
  mono: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (f, ms) => {
    const id = setTimeout(f, ms);
    return () => clearTimeout(id);
  },
};

/** A manual clock for tests: `advance(ms)` runs due timers in order. */
export function createManualClock(startMs = 0): Clock & { advance(ms: number): void } {
  let now = startMs;
  let mono = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; f: () => void }>();
  return {
    now: () => now,
    mono: () => mono,
    setTimeout(f, ms) {
      const id = ++seq;
      timers.set(id, { at: mono + Math.max(0, ms), f });
      return () => timers.delete(id);
    },
    advance(ms) {
      const end = mono + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now += due[1].at - mono;
        mono = due[1].at;
        due[1].f();
      }
      now += end - mono;
      mono = end;
    },
  };
}
