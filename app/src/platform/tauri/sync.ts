// Bindings of architecture §6.7 (commands/sync.rs → tramado-sync). R-SYNC owns this file in wave 1.
import type {
  CaughtUp, ClassEntry, DeviceStat, ExistingSyncthing, FileSyncInfo, FolderError, FolderView, Platform, Sig, SyncDiagnostics,
  SyncIdentity, SyncSnapshot, SyncStatus, VersionEntry,
} from '../types';
import { body, call, h } from './index';

export function createSyncBindings(): Platform['sync'] {
  return {
    identity: () => call<SyncIdentity>('sync_identity'),
    resolveCopiedIdentity: (action) => call<SyncIdentity>('sync_identity_resolve', { action }),
    start: () => call<SyncStatus>('sync_start'),
    restart: () => call<SyncStatus>('sync_restart'),
    status: () => call<SyncStatus>('sync_status'),
    snapshot: () => call<SyncSnapshot>('sync_snapshot'),
    applySettings: (settings) => call<void>('sync_settings_apply', { settings }),
    setPolicy: (policy) => call<void>('sync_policy_set', { policy }),
    sign: (classId, path, canonical) => call<Sig>('sync_sign', body(canonical), { 'x-class': h(classId), 'x-path': h(path) }),
    shareClass: (classId, label) => call<ClassEntry>('sync_share_class', { classId, label }),
    joinClass: (req) => call<ClassEntry>('sync_join_class', { req }),
    cancelJoin: (classId) => call<void>('sync_cancel_join', { classId }),
    acceptFolder: (req) => call<ClassEntry>('sync_accept_folder', { req }),
    leaveClass: (classId, opts) => call<void>('sync_leave_class', { classId, opts }),
    admit: (classId, deviceId) => call<void>('sync_admit', { classId, deviceId }),
    decline: (classId, deviceId) => call<void>('sync_decline', { classId, deviceId }),
    resolveMassDelete: (classId, action) => call<void>('sync_mass_delete_resolve', { classId, action }),
    normalizeIds: (ids) => call<Array<string | null>>('sync_normalize_ids', { ids }),
    ownAddresses: () => call<string[]>('sync_own_addresses'),
    fileInfo: (classId, paths) => call<FileSyncInfo[]>('sync_file_info', { classId, paths }),
    waitAvailable: (classId, path, minDevices, timeoutMs) => call<boolean>('sync_wait_available', { classId, path, minDevices, timeoutMs }),
    waitCaughtUp: (classId, timeoutMs) => call<CaughtUp>('sync_wait_caught_up', { classId, timeoutMs }),
    deviceStats: () => call<Record<string, DeviceStat>>('sync_device_stats'),
    folderStatus: (classId) => call<FolderView>('sync_folder_status', { classId }),
    versions: (classId) => call<VersionEntry[]>('sync_versions', { classId }),
    restore: (classId, items) => call<void>('sync_restore', { classId, items }),
    folderErrors: (classId) => call<FolderError[]>('sync_folder_errors', { classId }),
    pauseClass: (classId, paused) => call<void>('sync_pause_class', { classId, paused }),
    scan: (classId, path) => call<void>('sync_scan', { classId, ...(path !== undefined ? { path } : {}) }),
    diagnostics: () => call<SyncDiagnostics>('sync_diagnostics'),
    existing: () => call<ExistingSyncthing>('sync_existing'),
  };
}
