// Architecture §9 (verbatim): the TypeScript side of the IPC contract (§6–§7). A field added here MUST be
// added to the Rust twin in the same change (§19.2: additive changes only, by the owning work package).
import type { ClassId, ErrorCode, Instant, MemberId } from './common';
import type { SyncDiagnostics } from './sync';
import type { ModelState } from './speech';
export interface AppInfo {
  version: string;
  os: 'linux' | 'macos' | 'windows' | 'web';
  arch: string;
  webview: string | null;                  // e.g. "WebKitGTK 2.52.6"; null in the demo
  devIsolated: boolean;                    // TRAMADO_DATA_DIR set (dev / e2e)
  e2e: boolean;                            // TRAMADO_E2E=1
  startedHidden: boolean;                  // launched by autostart with --hidden
  mediaBase: string;                       // 'tramado-media://localhost' | 'http://tramado-media.localhost' | 'blob:' (demo)
  paths: { config: string; data: string; cache: string };   // display only (Storage, diagnostics)
  mediaAudio?: 'scheme' | 'blob';          // R-SHELL addition: how <audio> plays recordings here; 'blob' on Linux
                                           // (WebKitGTK cannot play a custom scheme; media self-test, critique R3)
  traySupported?: boolean;                 // R-SHELL addition: false → "close to tray" must quit (no tray icon here)
}
export type AppFileName = 'prefs.json' | 'identity.json' | 'hlc.json';
export type CacheKey = string;   // ^(text/[0-9a-f]{64}\.json|peaks/[0-9a-f]{64}-\d{2,5}\.json|models-catalog\.json|ocr/[0-9a-f]{64}\.json)$
export interface Power { source: 'ac' | 'battery' | 'unknown'; percent: number | null }
export interface RustDiagnostics {
  app: { version: string; os: string; arch: string; webview: string | null; cpu: { avx2: boolean; fma: boolean; f16c: boolean } };
  sync: SyncDiagnostics | null;
  speech: { cpuOk: boolean; models: ModelState[]; vad: boolean };
  ai: { lastCodes: Array<{ at: Instant; code: ErrorCode }> };             // last 20, no content
  logTail: string[];                                                       // app.log, device IDs truncated to ShortId
}
export type TrayAction = 'open' | 'pause-sharing' | 'resume-sharing' | 'quit';
export interface PersonInfo { memberId: MemberId; pub: string }                 // base64url public key (folder spec §8.3.1)
export interface PersonProof { pub: string; sig: string }
export interface StorageUsage {
  classes: Array<{ classId: ClassId; total: number; audio: number; trash: number }>;   // bytes; trash = <root>/.stversions
  models: number; cache: number; privateData: number;
}

