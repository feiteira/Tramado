// Architecture §11.2 (verbatim declarations): service contracts of the `class` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ColourHex, DeviceId, Hlc, IconName, Instant, Lang, MemberId, Ulid } from '../../core/model/ids';
import type { ClassFile, ConsentLine, MemberFile, MetaFile, PresenceFile } from '../../core/model/files';
import type { BanTarget, EffectiveBans } from '../../core/sync/bans';
import type { ActiveConsent } from '../../core/sync/consent';
import type { Bindings, MemberCheck } from '../../core/sync/members';
import type { FoldedMeta, OrganiserReplay } from '../../core/sync/meta';
import type { ModState } from '../../core/sync/mod';
import type { ClassPolicy } from '../../platform/types';
import type { ClassView, DeviceRef } from './viewModels';
import type { ReadableStore } from '../store';

export interface Person {
  memberId: MemberId; name: string; colour: ColourHex | null; isMe: boolean; isOrganiser: boolean; banned: boolean;
  devices: Array<{ deviceId: DeviceId; deviceName: string; verified: boolean; online: boolean; relay: boolean;
                   lastSeen: Instant | null; caps: MemberFile['caps']; app: MemberFile['app']; activity: PresenceFile['activity'] | null; stale: boolean }>;
}

export interface ClassDetail {                             // what the class header, settings and members screens need beyond ClassView
  classId: ClassId; meta: EffectiveMeta; organisers: MemberId[]; people: Person[]; unverified: Person[];
  me: { deviceId: DeviceId; memberId: MemberId; isOrganiser: boolean }; shared: boolean; readOnly: boolean; newerItems: number;
}

export interface ClassService {
  detail: ReadableStore<ClassDetail>;
  setMeta(patch: Partial<Record<keyof MetaFile['fields'], unknown>>): Promise<void>;   // writes own meta file (LWW)
  setOrganiser(memberId: MemberId, on: boolean): Promise<void>; becomeOrganiser(): Promise<void>;
  refreshOwnMemberFile(): Promise<void>;                        // caps, addresses (≤ 1 / 5 min), app version, formats
  consent: { record(input: ConsentInput): Promise<{ deviceId: DeviceId; id: Ulid }>; revoke(ref: { deviceId: DeviceId; id: Ulid }): Promise<void>; active(): ConsentLine[] };
  // ── G1 (T-SYNC, additive): what the other services of the class reach behind ClassService ──
  model: ReadableStore<ClassModel>;
  /** Resolves after the first full load of the class files. */
  ready(): Promise<void>;
  /** Re-reads every class file now. */
  reload(): Promise<void>;
  personAt(deviceId: DeviceId, hlc?: Hlc): MemberId | null;
  isOrganiserAt(memberId: MemberId | null, hlc: Hlc): boolean;
  /** UX DeviceRef of a device: the bound person (or the device's own claim when unbound). */
  deviceRef(deviceId: DeviceId): DeviceRef;
  /** "Ana Ribeiro" (bound person) or the device name. */
  nameOf(deviceId: DeviceId): string;
  /** The policy last computed (null before the first load). */
  policy(): ClassPolicy | null;
  /** Writes a ban/unban entry into my signed bans file (organisers only count, folder spec §8.19). */
  writeBan(target: BanTarget, state: 'banned' | 'unbanned', reason?: string): Promise<void>;
  /** Removes my member and presence files (leaving, sync spec §17). */
  removeOwnFiles(): Promise<void>;
  /** Forks the class (sync spec §17): the new class.json under the old ID, `platform.classes.fork`, then my meta and
   *  member file under the new ID. */
  writeFork(newClassId: ClassId, nonce: string): Promise<void>;
  /** Private UI state of the class (architecture §13.2 ui-state.json). */
  uiState(): Promise<Record<string, unknown>>;
  setUiState(patch: Record<string, unknown>): Promise<void>;
}

/** Everything the other services of a class need from its trusted machine files (G1: moved from services/class.ts). */
export interface ClassModel {
  revision: number;
  loaded: boolean;
  classFile: ClassFile | null;
  folded: FoldedMeta;
  meta: EffectiveMeta;
  organisers: OrganiserReplay;
  bindings: Bindings;
  bans: EffectiveBans;
  members: ReadonlyMap<DeviceId, { file: MemberFile; check: MemberCheck }>;
  consents: ActiveConsent[];
  mod: ModState;
  me: { deviceId: DeviceId; memberId: MemberId };
  /** Records of a newer format seen (G14). */
  newer: number;
  /** Devices that left, with the names of their last member file (attribution of their older records). */
  former: ReadonlyMap<DeviceId, { memberId: MemberId; name: string; deviceName: string }>;
}

export interface EffectiveMeta {
  name: string; shortName: string; colour: ColourHex; icon: IconName; lecturer: string | null; term: string | null;
  language: Lang | 'auto'; description: string | null; vocabulary: string | null; askBeforeAdmit: boolean; largeClassAck: boolean;
  dirs: { lectures: string; documents: string; exams: string; notes: string; fromChat: string };
}

export interface ConsentInput {
  kind: 'record' | 'share'; scope: 'class' | 'lecture'; lectureId?: Ulid; share?: 'audio+transcript' | 'transcript-only';
  textId: 'record.dialog.consent.v1' | 'record.dialog.consentShare.v1' | 'record.import.permission.v1';   // catalog keys = textId (§14)
  textLang: Lang; text: string; lecturer?: string;                            // the exact sentence shown (folder spec §8.5)
}

export interface NotificationService {   // translates `notify.*` keys (UX §5.22) with the UI locale, honours prefs notify.*
  notify(kind: 'mention' | 'pin' | 'join' | 'transcript' | 'chat' | 'exam' | 'sync' | 'recording' | 'model', key: string /* notify.<id> */, vars: Record<string, string | number>, tag?: string): Promise<void>;
  /** G1 (T-SYNC, additive): the last notifications shown (diagnostics and tests). */
  recent(): Array<{ kind: Parameters<NotificationService['notify']>[0]; key: string; text: string; tag?: string }>;
}
