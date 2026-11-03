// The desktop platform: every call goes to the Rust shell over Tauri's local IPC (architecture §6, §10).
// Nothing here opens a network connection. Helpers ported from Trama's platform/tauri.ts.
import { invoke } from '@tauri-apps/api/core';
import { toPlatformError } from '../../core/errors';
import type { Platform } from '../types';
import { createAppBindings } from './app';
import { createClassesBindings, createFsBindings } from './classes';
import { createDialogBindings } from './dialogs';
import { createAiBindings, createSecretBindings } from './ai';
import { createSystemBindings, createNotificationBindings, createWindowBindings } from './system';
import { createEventBindings } from './events';
import { createMediaBindings } from './media';
import { createSyncBindings } from './sync';
import { createSpeechBindings } from './speech';

export { toPlatformError };

export type Args = Record<string, unknown> | Uint8Array;

/** Invokes a shell command; rejections become PlatformError (`{code, message, data}` or Tauri strings). */
export async function call<T>(cmd: string, args?: Args, headers?: Record<string, string>): Promise<T> {
  try {
    return await invoke<T>(cmd, args, headers ? { headers } : undefined);
  } catch (e) {
    throw toPlatformError(e);
  }
}

/** Binary responses arrive as an ArrayBuffer; older IPC paths may hand back a number array. */
export function toBytes(r: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (r instanceof Uint8Array) return r;
  if (r instanceof ArrayBuffer) return new Uint8Array(r);
  return Uint8Array.from(r);
}

/** A raw body is sent whole; a view into a larger buffer is copied so only its bytes go. */
export function body(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/** Header values are percent-encoded: headers cannot carry non-ASCII paths (the shell decodes). */
export const h = (v: string): string => encodeURIComponent(v);

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function createTauriPlatform(): Platform {
  const app = createAppBindings();
  return {
    kind: 'desktop',
    info: app.info,
    log: app.log,
    appFiles: app.appFiles,
    privateFiles: app.privateFiles,
    cache: app.cache,
    person: app.person,
    storage: app.storage,
    classes: createClassesBindings(),
    fs: createFsBindings(),
    dialogs: createDialogBindings(),
    secrets: createSecretBindings(),
    ai: createAiBindings(),
    sync: createSyncBindings(),
    speech: createSpeechBindings(),
    media: createMediaBindings(),
    notifications: createNotificationBindings(),
    window: createWindowBindings(),
    system: createSystemBindings(),
    events: createEventBindings(),
  };
}
