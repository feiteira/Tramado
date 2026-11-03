// STUB (M0) → T-SYNC: createMemoryMesh(), the multi-device test harness (D56, sync spec §24; architecture §10).
// The signature is the contract; T-SYNC builds it on the MemoryPlatform.mem hooks without editing them.
import { notImplemented } from '../../core/errors';
import type { ClassId, ClassPath, DeviceId, MemberId } from '../../core/model/ids';
import type { MemoryPlatform } from './index';

export interface MeshOptions { seed: number; clockSkewMs?: Record<string, number>; autoFlush?: boolean; eventLag?: number }
export interface MemoryMesh {
  device(name: string, opts?: { deviceId?: DeviceId; memberId?: MemberId }): MemoryPlatform;   // creates a device
  flush(): Promise<void>;              // propagate every pending change between connected devices sharing a folder (one round)
  settle(maxRounds?: number): Promise<void>;   // flush until quiescent
  partition(...groups: string[][]): void;      // devices in different groups cannot exchange
  heal(): void;
  crash(name: string): void; restart(name: string): MemoryPlatform;   // drop in-memory services, keep files
  advance(ms: number): Promise<void>;          // fake clocks (monotonic + wall, per-device skew)
  forge(by: string, owner: string, classId: ClassId, path: ClassPath, bytes: Uint8Array): void;  // foreign write (critique V3)
  files(name: string, classId: ClassId): Map<ClassPath, Uint8Array>;
}

export function createMemoryMesh(_opts: MeshOptions): MemoryMesh {
  throw notImplemented('createMemoryMesh');
}
