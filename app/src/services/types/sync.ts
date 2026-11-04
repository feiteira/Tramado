// Architecture §11.2 (verbatim declarations): service contracts of the `sync` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ClassPath, DeviceId, EpochMs, Hex64, Hlc, MemberId, ShortId, Ulid } from '../../core/model/ids';
import type { ClaimKind } from '../../core/sync/claims';
import type { ClaimFile, InviteV1, PresenceFile } from '../../core/model/files';
import type { DeviceSpec, FolderOfferView, FolderView, JoinRequestView, Picked, RestoreItem, SyncEvent, SyncSettings, SyncStatus, VersionEntry } from '../../platform/types';
import type { ReadableStore } from '../store';
import type { TrustGate } from './common';

export interface InvitePreview { code: string; invite: InviteV1; devices: DeviceSpec[]; warnings: Array<'old' | 'ownInvite' | 'alreadyMember'>; classId: ClassId; checkWords: string }

export interface SyncUiState {
  status: SyncStatus | null; folders: Record<ClassId, FolderView>; joinRequests: JoinRequestView[]; offers: FolderOfferView[];
  massDelete: Array<{ classId: ClassId; count: number; sample: ClassPath[] }>;
  massDeleteRemote: Array<{ classId: ClassId; by: ShortId; byName: string; count: number; sample: ClassPath[] }>;
  foreignWrites: number; markerMissing: ClassId[]; identityCopied: boolean;
  joinStalled: ClassId[];                                  // not admitted 90 s after connecting (sync spec §8)
}

export interface SyncService {
  state: ReadableStore<SyncUiState>;
  boot(): Promise<void>;                                   // snapshot, trust pass, policy push, event routing
  ensureStarted(): Promise<void>;
  restart(): Promise<void>;
  share(classId: ClassId): Promise<void>;
  invite(classId: ClassId, opts?: { expiresAt?: EpochMs }): Promise<{ code: string; link: string; web: string | null; qrText: string; fileName: string; fileText: string }>;
      // qrText = the reduced invite as `web` (when JOIN_PAGE is set) or `link` (sync spec §7.2); fileText = link + "\n" + sentence
  parseCode(text: string): Promise<InvitePreview>;         // a pairing code (v1.1) → PlatformError NEWER_FORMAT with data.pair = true
  join(preview: InvitePreview, opts: { includeAudio: boolean; parent?: Picked }): Promise<ClassId>;   // passes preview.code to Rust
  cancelJoin(classId: ClassId): Promise<void>;
  leave(classId: ClassId, opts: { afterwards: 'keepLocal' | 'trash'; deleteMyNotes: boolean }): Promise<void>;   // sync spec §17
  admit(classId: ClassId, deviceId: DeviceId): Promise<void>;
  decline(classId: ClassId, deviceId: DeviceId): Promise<void>;     // organiser → ban entry; others → temporary ignore on this computer
  ban(classId: ClassId, target: { memberId: MemberId } | { deviceId: DeviceId }, reason?: string): Promise<void>;   // also sets askBeforeAdmit
  unban(classId: ClassId, target: { memberId: MemberId } | { deviceId: DeviceId }): Promise<void>;
  answerOffer(offer: FolderOfferView, accept: boolean): Promise<void>;
  applySettings(s: Partial<SyncSettings>): Promise<void>;
  versions(classId: ClassId): Promise<VersionEntry[]>;   // "Recently deleted": versions of paths deleted now, filtered per sync spec §22.1
  restore(classId: ClassId, items: RestoreItem[]): Promise<void>;   // Undo toasts and "Recently deleted"
  resolveMassDelete(classId: ClassId, action: 'restore' | 'confirm'): Promise<void>;
  resolveRemoteMassDelete(classId: ClassId, by: ShortId, action: 'restore' | 'keep'): Promise<void>;   // restore from the local trashcan
  resolveCopiedIdentity(action: 'new' | 'same'): Promise<void>;
  diagnosticsText(): Promise<string>;
  // ── G1 (T-SYNC, additive) ──
  /** Peer devices: connected, relay, last seen (from the snapshot, `connection` events and deviceStats). */
  connections: ReadableStore<Record<DeviceId, ConnectionState>>;
  connectionOf(deviceId: DeviceId): ConnectionState | null;
  /** `indexUpdated` events per class (chat delivery ticks, sync spec §15). */
  onIndexUpdated(cb: (classId: ClassId) => void): () => void;
  noteForeignWrite(classId: ClassId, path: ClassPath): void;
  /** Forks a class kept after leaving or adopted with foreign member files (sync spec §17). */
  fork(classId: ClassId): Promise<ClassId>;
  /** Finishes the forks of classes left with "keep a copy" once Rust finished leaving them. */
  completeForks(): Promise<void>;
  // ── G2 (UI-GROUP, additive) ──
  /** "Try again" of a stalled join (sync spec §8): re-runs the knock (cancel, then join again with the same invite and options). */
  retryJoin(classId: ClassId): Promise<ClassId>;
  /** The invite a class is being joined with (this session), for the join dialog's waiting states; null when not joining. */
  joining(classId: ClassId): { preview: InvitePreview; since: EpochMs; connectedAt: EpochMs | null } | null;
}

/**
 * G2 (UI-GROUP): the `left` sync event (plan §15 item 15, §16 item 3). Rust emits it when `finish_leaving` ran
 * (sync spec §17): the folder is gone and, with `keepLocal`, the class waits to be forked. The integrator adds it to
 * `platform/types/sync.ts` `SyncEvent` at G2 (and the Rust emission); until then services code against this union.
 */
export interface SyncLeftEvent { type: 'left'; classId: ClassId; afterwards: 'keepLocal' | 'trash' }
export type SyncEventG2 = SyncEvent | SyncLeftEvent;

/** A peer device's connection (G1: moved from services/sync.ts). */
export interface ConnectionState { connected: boolean; relay: boolean; lastSeen: string | null }

export interface PresenceService {
  setActivity(a: Partial<PresenceFile['activity']> | null): Promise<void>;   // writes on change; 60 s heartbeat while non-empty
  others: ReadableStore<Record<DeviceId, { activity: PresenceFile['activity']; stale: boolean; power: PresenceFile['power'] }>>;
  // ── G1 (T-SYNC, additive) ──
  activityOf(deviceId: DeviceId): { activity: PresenceFile['activity'] | null; stale: boolean } | null;
  /** My current activity. */
  mine(): PresenceFile['activity'];
}

export interface TrustService extends TrustGate {
  pass(): Promise<{ checked: number; untrusted: number }>;            // start-up pass, sync spec §12.1
  noteRemote(path: ClassPath, modifiedBy: ShortId, mono: number): void;   // from sync:event remoteChange (kept 10 min)
  // ── G1 (T-SYNC, additive) ──
  /** Resolves once the trust cache is loaded. */
  ready(): Promise<void>;
  /** Paths whose last trusted bytes are kept (signed records that may now be deleted or untrusted). */
  keptPaths(): ClassPath[];
  /** The kept last trusted bytes of a path, or null. */
  kept(path: ClassPath): Promise<Uint8Array | null>;
  /** Whether a missing machine file's deletion counts (folder spec §6.2 rule 4). */
  deletionHonoured(path: ClassPath, writer: DeviceId | null): Promise<boolean>;
  /** Forget the kept copy of a path whose deletion counted. */
  dropKept(path: ClassPath): Promise<void>;
  /** Devices that left (sync spec §10 `left()`), with their last binding (folder spec §8.3.1). */
  left(): ReadonlyMap<DeviceId, FormerEntry>;
  noteLeft(deviceId: DeviceId, memberId: MemberId, hlc: Hlc, names?: { name: string; deviceName: string }): void;
  /** The monotonic set of vacated memberIds (folder spec §8.2). */
  vacated(): ReadonlySet<MemberId>;
  addVacated(ids: Iterable<MemberId>): void;
  /** The pinned transcript writer of a lecture (folder spec §6.2 rule 3). */
  pinnedWriter(lectureId: Ulid): { deviceId: DeviceId; round: number } | null;
  /** Untrusted versions seen (diagnostics `foreignWrites`). */
  foreignWrites(): number;
  /** The recent `remoteChange` hints (path → modifiedBy), for diagnostics. */
  recentRemote(path: ClassPath): ShortId | null;
  flush(): Promise<void>;
}

/** A device that left a class, with its last binding (G1: moved from services/trust.ts). */
export interface FormerEntry { memberId: MemberId; leftHlc: Hlc; name: string; deviceName: string }

export interface ClaimView { deviceId: DeviceId; who: string; status: ClaimFile['status']; progress: number | null; etaMs: number | null; health: 'healthy' | 'slow' | 'stale'; sinceMs: number; mine: boolean }

export interface ClaimEngine {          // per class; owns claims/<lectureId>/<me>.json and the §14.5 round
  claims(lectureId: Ulid, kind: 'transcribe' | 'fold'): ReadableStore<ClaimView[]>;
  winner(lectureId: Ulid, kind: 'transcribe' | 'fold'): ClaimView | null;
  tryClaim(lectureId: Ulid, kind: 'transcribe' | 'fold', input: { engine: ClaimFile['engine']; audioSha256: Hex64 | null; supersedeStale: boolean; newRound?: boolean }): Promise<'won' | 'lost'>;
  onLost(lectureId: Ulid, cb: () => void): () => void;      // fires when a running claim stops winning (abort the job)
  setStatus(lectureId: Ulid, kind: 'transcribe' | 'fold', patch: Partial<Pick<ClaimFile, 'status' | 'progress' | 'etaMs' | 'error' | 'finishedAt' | 'transcriptRevision'>>): Promise<void>;
  remove(lectureId: Ulid, kind: 'transcribe' | 'fold'): Promise<void>;
  sweep(): Promise<void>;                                     // retention rules folder spec §8.10
  // ── G1 (T-SYNC, additive) ──
  /** A trusted claim of a device, or null. */
  trustedClaim(lectureId: Ulid, kind: ClaimKind, deviceId: DeviceId): Promise<ClaimFile | null>;
  /** The device whose fold claim wins (§14.8), or null. */
  foldWinner(lectureId: Ulid): Promise<DeviceId | null>;
  /** §14.8 trigger: the transcript owner has no member file or was last seen more than 7 days ago. */
  foldTrigger(lectureId: Ulid): Promise<boolean>;
  /** Fires when a winner's claim goes stale (volunteers restart their delays, §14.3). */
  onReevaluate(cb: (lectureId: Ulid, kind: ClaimKind) => void): () => void;
  /** Sets every claimed/working claim of mine to `released` (leaving, §17; "Stop and let someone else do it", §14.8). */
  releaseAll(): Promise<void>;
  /** Resolves once the first load of the claim files finished. */
  ready(): Promise<void>;
}
