// Architecture §9 (verbatim): the TypeScript side of the IPC contract (§6–§7). A field added here MUST be
// added to the Rust twin in the same change (§19.2: additive changes only, by the owning work package).
import type { ClassId, ClassPath, DeviceId, EpochMs, ErrorCode, Instant, MemberId, PickToken, ShortId } from './common';
export type SyncState = 'stopped' | 'starting' | 'running' | 'restarting' | 'error';
export interface SyncIdentity { deviceId: DeviceId; shortId: ShortId; syncPort: number }
export interface SyncStatus {
  state: SyncState; deviceId: DeviceId | null; version: string | null; syncPort: number | null;
  localOnly: boolean; paused: boolean; startedAt: Instant | null; restarts: number; error: ErrorCode | null;
}
export type FolderState = 'idle' | 'scanning' | 'syncing' | 'sync-preparing' | 'sync-waiting' | 'scan-waiting' | 'error' | 'paused' | 'unknown';
export type RemoteState = 'valid' | 'notSharing' | 'paused' | 'unknown';
export interface FolderView {
  classId: ClassId; label: string; path: string; paused: boolean; state: FolderState;
  globalFiles: number; inSyncFiles: number; needFiles: number; needBytes: number; pullErrors: number; error: string | null;
  devices: DeviceId[];
  completion: Record<DeviceId, { completion: number; needItems: number; remoteState: RemoteState }>;
}
export interface DeviceView {
  deviceId: DeviceId; name: string; connected: boolean; relay: boolean; address: string | null; paused: boolean;
  lastSeen: Instant | null; folders: ClassId[]; provisional: boolean; ignored: boolean;
}
export interface JoinRequestView { classId: ClassId; deviceId: DeviceId; name: string; address: string; at: Instant }
export interface FolderOfferView { folderId: ClassId; label: string; offeredBy: DeviceId; offeredByName: string; at: Instant }
export interface ExistingSyncthing { running: boolean; configFound: boolean }
export interface SyncSnapshot {
  status: SyncStatus; folders: FolderView[]; devices: DeviceView[];
  joinRequests: JoinRequestView[]; folderOffers: FolderOfferView[]; existing: ExistingSyncthing;
}
export interface SyncSettings { localOnly: boolean; paused: boolean; maxSendKbps: number; maxRecvKbps: number;
  deviceName: string }   // "<person> (<computer>)", announced only while a class is joining; otherwise "Tramado" (sync spec §9.4)
export interface RosterDevice { deviceId: DeviceId; memberId: MemberId; name: string; deviceName: string; addresses: string[] }
export interface ClassPolicy {
  classId: ClassId; label: string;             // label = effective meta name (Syncthing folder label)
  askBeforeAdmit: boolean;                     // effective, organiser-filtered (folder spec §8.2)
  roster: RosterDevice[];                      // devices with a TRUSTED member file (sync spec §10)
  knownDevices: DeviceId[];                    // devices with a trusted member file whose person proof verifies (sync spec §9.2 known_member)
  bannedDevices: DeviceId[];                   // effective bans expanded to devices (§18.1)
  updatedAt: Instant;
}
export interface GlobalPolicy { ownDevices: DeviceId[]; pairingOpenUntil: EpochMs | null }   // Rust state (v1.1 pairing); TS uses it in decide() vectors only
export interface DeviceSpec { deviceId: DeviceId; name: string; addresses: string[] }       // decoded invite device (InvitePreview)
export interface JoinRequest {
  code: string;                                                // the invite code text; Rust decodes and validates it (sync spec §8, §9.5)
  dirName: string;                                             // sanitize(invite label) made unique by TS (folder spec §5.4)
  parent?: PickToken;                                          // default: classes root
  includeAudio: boolean;                                       // false → "(?d)/**/audio.webm" + skipAudio
}
export interface AcceptFolderRequest { folderId: ClassId; offeredBy: DeviceId; label: string; dirName: string; parent?: PickToken; includeAudio: boolean }   // devices [me, offeredBy]
export interface LeaveOptions { afterwards: 'keepLocal' | 'trash' }   // sync spec §17; keepLocal = forked local class
export interface Sig { cert: string; value: string }               // folder spec §6.6
export type MassDeleteAction = 'restore' | 'confirm';
export interface FileSyncInfo {
  path: ClassPath; localModifiedBy: ShortId | null; localDeleted: boolean; localSize: number | null;
  localBlocksHash: string | null; localModified: Instant | null; localVersion: string[]; localSequence: number | null;
  globalModifiedBy: ShortId | null; globalDeleted: boolean;
  availability: DeviceId[];                                    // entries with fromTemporary == false only; never this device
}
export interface CaughtUp { complete: boolean; waitedMs: number; pending: DeviceId[] }
export interface DeviceStat { lastSeen: Instant | null; lastConnectionDurationS: number }
export interface VersionEntry { path: ClassPath; versionTime: Instant; modTime: Instant; size: number }
export interface RestoreItem { path: ClassPath; versionTime: Instant }
export interface FolderError { path: ClassPath; error: string }
export interface SyncDiagnostics {
  status: SyncStatus; ports: { sync: number | null; guiOpen: boolean }; listeners: Record<string, string | null>;
  connections: number; relayed: number; lastErrors: Array<{ when: Instant; message: string }>; logTail: string[];
}


// ── Architecture §7.1 (verbatim) ──
export type SyncEvent =
  | { type: 'status'; status: SyncStatus }
  | { type: 'gap' }                                                    // events were dropped: re-read sync_snapshot
  | { type: 'remoteChange'; classId: ClassId; path: ClassPath; action: 'modified' | 'deleted';
      modifiedBy: ShortId }                                             // RemoteChangeDetected, type == file only (loop B);
                                                                        // a trigger to re-judge the path, never a verdict (§12)
  | { type: 'folder'; folder: FolderView }                              // FolderSummary / StateChanged / paused / resumed
  | { type: 'completion'; classId: ClassId; deviceId: DeviceId; completion: number; needItems: number;
      remoteState: RemoteState }                                        // FolderCompletion
  | { type: 'indexUpdated'; classId: ClassId; remote: boolean }         // Local/RemoteIndexUpdated (delivery ticks)
  | { type: 'connection'; deviceId: DeviceId; connected: boolean; relay: boolean; address: string | null }
  | { type: 'joinRequest'; request: JoinRequestView }                   // ask-before-admit queue (§9.3)
  | { type: 'joinRequestGone'; classId: ClassId; deviceId: DeviceId }
  | { type: 'admitted'; classId: ClassId; deviceId: DeviceId; name: string }   // this device shared the folder with a joiner
  | { type: 'admittedMe'; classId: ClassId; byDevice: DeviceId }       // joiner side: remoteState valid (§8)
  | { type: 'folderOffer'; offer: FolderOfferView }                     // unknown tramado-* folder offered
  | { type: 'foreignWrite'; classId: ClassId; path: ClassPath; modifiedBy: ShortId; healed: boolean }
  | { type: 'massDelete'; classId: ClassId; count: number; sample: ClassPath[] }   // local guard; folder already paused
  | { type: 'massDeleteRemote'; classId: ClassId; by: ShortId; count: number; sample: ClassPath[] }   // receiving guard
  | { type: 'folderErrors'; classId: ClassId; errors: FolderError[] }
  | { type: 'markerMissing'; classId: ClassId }
  | { type: 'listenAddresses'; addresses: string[] };                  // ListenAddressesChanged (member file refresh)
