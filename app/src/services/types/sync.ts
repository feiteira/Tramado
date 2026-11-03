// Architecture §11.2 (verbatim declarations): service contracts of the `sync` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ClassPath, DeviceId, EpochMs, Hex64, MemberId, ShortId, Ulid } from '../../core/model/ids';
import type { ClaimFile, InviteV1, PresenceFile } from '../../core/model/files';
import type { DeviceSpec, FolderOfferView, FolderView, JoinRequestView, Picked, RestoreItem, SyncSettings, SyncStatus, VersionEntry } from '../../platform/types';
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
}

export interface PresenceService {
  setActivity(a: Partial<PresenceFile['activity']> | null): Promise<void>;   // writes on change; 60 s heartbeat while non-empty
  others: ReadableStore<Record<DeviceId, { activity: PresenceFile['activity']; stale: boolean; power: PresenceFile['power'] }>>;
}

export interface TrustService extends TrustGate {
  pass(): Promise<{ checked: number; untrusted: number }>;            // start-up pass, sync spec §12.1
  noteRemote(path: ClassPath, modifiedBy: ShortId, mono: number): void;   // from sync:event remoteChange (kept 10 min)
}

export interface ClaimView { deviceId: DeviceId; who: string; status: ClaimFile['status']; progress: number | null; etaMs: number | null; health: 'healthy' | 'slow' | 'stale'; sinceMs: number; mine: boolean }

export interface ClaimEngine {          // per class; owns claims/<lectureId>/<me>.json and the §14.5 round
  claims(lectureId: Ulid, kind: 'transcribe' | 'fold'): ReadableStore<ClaimView[]>;
  winner(lectureId: Ulid, kind: 'transcribe' | 'fold'): ClaimView | null;
  tryClaim(lectureId: Ulid, kind: 'transcribe' | 'fold', input: { engine: ClaimFile['engine']; audioSha256: Hex64 | null; supersedeStale: boolean; newRound?: boolean }): Promise<'won' | 'lost'>;
  onLost(lectureId: Ulid, cb: () => void): () => void;      // fires when a running claim stops winning (abort the job)
  setStatus(lectureId: Ulid, kind: 'transcribe' | 'fold', patch: Partial<Pick<ClaimFile, 'status' | 'progress' | 'etaMs' | 'error' | 'finishedAt' | 'transcriptRevision'>>): Promise<void>;
  remove(lectureId: Ulid, kind: 'transcribe' | 'fold'): Promise<void>;
  sweep(): Promise<void>;                                     // retention rules folder spec §8.10
}
