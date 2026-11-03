// Identifiers of the class folder format (docs/spec/class-folder-v1.md §2): plain string aliases
// (no branded types, architecture §9), their regexes and validators, and the device-ID helpers.

export type ClassId = string;        // ^tramado-[a-z2-7]{26}$ (= Syncthing folder ID)
export type Nonce = string;          // ^[a-z2-7]{26}$
export type DeviceId = string;       // canonical ^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$
export type ShortId = string;        // ^[A-Z2-7]{7}$
export type MemberId = string;       // ^[a-z2-7]{26}$
export type Ulid = string;           // ^[0-7][0-9A-HJKMNP-TV-Z]{25}$
export type SegmentId = string;      // ^s_[0-9A-Za-z]{5,8}$
export type QuestionId = string;     // ^q_[0-9A-Za-z]{6,8}$
export type Hlc = string;            // ^\d{15}-[0-9a-z]{5}-[a-z2-7]{7}$
export type Hex64 = string;          // ^[0-9a-f]{64}$
export type Hex40 = string;          // ^[0-9a-f]{40}$
export type Instant = string;        // RFC 3339, UTC, Z, milliseconds
export type LocalDateTime = string;  // RFC 3339 with offset
export type EpochMs = number;        // integer ≥ 0
export type ClassPath = string;      // §1: relative, '/', NFC, no '.' or '..'
export type ColourHex = string;      // ^#[0-9a-f]{6}$
export type IconName = string;       // ^[a-z0-9-]{1,40}$
export type Lang = string;           // BCP 47
export type ModelId = string;        // ^[a-z0-9-]{1,40}$ (registry: turbo, small, large-v3)

export const RE_CLASS_ID = /^tramado-[a-z2-7]{26}$/;
export const RE_NONCE = /^[a-z2-7]{26}$/;
export const RE_DEVICE_ID = /^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$/;
export const RE_DEVICE_ID_DASHLESS = /^[A-Z2-7]{56}$/;
export const RE_SHORT_ID = /^[A-Z2-7]{7}$/;
export const RE_MEMBER_ID = /^[a-z2-7]{26}$/;
export const RE_ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const RE_SEGMENT_ID = /^s_[0-9A-Za-z]{5,8}$/;
export const RE_QUESTION_ID = /^q_[0-9A-Za-z]{6,8}$/;
export const RE_HLC = /^\d{15}-[0-9a-z]{5}-[a-z2-7]{7}$/;
export const RE_HEX64 = /^[0-9a-f]{64}$/;
export const RE_HEX40 = /^[0-9a-f]{40}$/;
export const RE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const RE_LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
export const RE_COLOUR_HEX = /^#[0-9a-f]{6}$/;
export const RE_ICON_NAME = /^[a-z0-9-]{1,40}$/;
export const RE_MODEL_ID = /^[a-z0-9-]{1,40}$/;
export const RE_LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** Any hex colour a person might type (#rgb or #rrggbb, either case); used by ui/color.ts. */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const isClassId = (s: unknown): s is ClassId => typeof s === 'string' && RE_CLASS_ID.test(s);
export const isNonce = (s: unknown): s is Nonce => typeof s === 'string' && RE_NONCE.test(s);
export const isDeviceId = (s: unknown): s is DeviceId => typeof s === 'string' && RE_DEVICE_ID.test(s);
export const isShortId = (s: unknown): s is ShortId => typeof s === 'string' && RE_SHORT_ID.test(s);
export const isMemberId = (s: unknown): s is MemberId => typeof s === 'string' && RE_MEMBER_ID.test(s);
export const isUlid = (s: unknown): s is Ulid => typeof s === 'string' && RE_ULID.test(s);
export const isSegmentId = (s: unknown): s is SegmentId => typeof s === 'string' && RE_SEGMENT_ID.test(s);
export const isQuestionId = (s: unknown): s is QuestionId => typeof s === 'string' && RE_QUESTION_ID.test(s);
export const isHlc = (s: unknown): s is Hlc => typeof s === 'string' && RE_HLC.test(s);
export const isHex64 = (s: unknown): s is Hex64 => typeof s === 'string' && RE_HEX64.test(s);
export const isHex40 = (s: unknown): s is Hex40 => typeof s === 'string' && RE_HEX40.test(s);
export const isInstant = (s: unknown): s is Instant => typeof s === 'string' && RE_INSTANT.test(s);
export const isLocalDateTime = (s: unknown): s is LocalDateTime => typeof s === 'string' && RE_LOCAL_DATE_TIME.test(s);
export const isEpochMs = (n: unknown): n is EpochMs => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export const isColourHex = (s: unknown): s is ColourHex => typeof s === 'string' && RE_COLOUR_HEX.test(s);
export const isIconName = (s: unknown): s is IconName => typeof s === 'string' && RE_ICON_NAME.test(s);
export const isModelId = (s: unknown): s is ModelId => typeof s === 'string' && RE_MODEL_ID.test(s);
export const isLang = (s: unknown): s is Lang => typeof s === 'string' && RE_LANG.test(s);

/** The first 7 characters of a device ID: what Syncthing reports as `modifiedBy`. */
export function shortIdOf(d: DeviceId): ShortId {
  return d.slice(0, 7);
}

/** The HLC node of a device: its ShortId in lower case (folder spec §3.1). */
export function hlcNodeOf(d: DeviceId): string {
  return shortIdOf(d).toLowerCase();
}

/** The canonical ID without its 7 dashes (56 characters; invites only). */
export function dashless(d: DeviceId): string {
  return d.replace(/-/g, '');
}

/** A 56-character dashless ID back in canonical dashed form (upper case). */
export function dashed(s: string): DeviceId {
  const u = s.replace(/-/g, '').toUpperCase();
  return u.match(/.{1,7}/g)?.join('-') ?? '';
}

/**
 * Whether two language tags match (folder spec §2 `Lang`): equal primary subtags and, when both
 * carry a region, equal regions. Case-insensitive; `es` matches `es-ES`, `pt-PT` does not match `pt-BR`.
 */
export function langMatches(a: Lang, b: Lang): boolean {
  const pa = a.toLowerCase().split('-');
  const pb = b.toLowerCase().split('-');
  if (pa[0] !== pb[0]) return false;
  const ra = pa.slice(1).find((p) => /^[a-z]{2}$|^\d{3}$/.test(p));
  const rb = pb.slice(1).find((p) => /^[a-z]{2}$|^\d{3}$/.test(p));
  return !ra || !rb || ra === rb;
}
