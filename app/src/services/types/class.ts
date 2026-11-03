// Architecture §11.2 (verbatim declarations): service contracts of the `class` domain.
// Signature-frozen at gate G1: later packages may add members, never rename, remove or retype them.
import type { ClassId, ColourHex, DeviceId, IconName, Instant, Lang, MemberId, Ulid } from '../../core/model/ids';
import type { ConsentLine, MemberFile, MetaFile, PresenceFile } from '../../core/model/files';
import type { ClassView } from './viewModels';
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
}

export interface EffectiveMeta {
  name: string; shortName: string; colour: ColourHex; icon: IconName; lecturer: string | null; term: string | null;
  language: Lang | 'auto'; description: string | null; vocabulary: string | null; askBeforeAdmit: boolean; largeClassAck: boolean;
  dirs: { lectures: string; documents: string; exams: string; notes: string; fromChat: string };
}

export interface ConsentInput {
  kind: 'record' | 'share'; scope: 'class' | 'lecture'; lectureId?: Ulid; share?: 'audio+transcript' | 'transcript-only';
  textId: 'record.dialog.consent.v1' | 'record.dialog.consentShare.v1';      // catalog keys = textId (§14)
  textLang: Lang; text: string; lecturer?: string;                            // the exact sentence shown (folder spec §8.5)
}

export interface NotificationService {   // translates `notify.*` keys (UX §5.22) with the UI locale, honours prefs notify.*
  notify(kind: 'mention' | 'pin' | 'join' | 'transcript' | 'chat' | 'exam' | 'sync' | 'recording' | 'model', key: string /* notify.<id> */, vars: Record<string, string | number>, tag?: string): Promise<void>;
}
