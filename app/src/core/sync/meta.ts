// Class metadata (folder spec §8.2): last-writer-wins registers per field across the trusted meta files,
// with the validation rules, the authority filter of `askBeforeAdmit` (organiser at the register's HLC),
// the organiser replay with the monotonic vacancy clause (pseudo-code verbatim), and the override stamp of
// §3.4 for writers. Pure: binding lookups (`personAt`) come from core/sync/members.ts.
import { succHlc, maxHlc } from '../hlc';
import { isColourHex, isHlc, isIconName, isLang, type DeviceId, type Hlc, type MemberId } from '../model/ids';
import { sanitize } from '../model/sanitize';
import type { MetaFile, Reg } from '../model/files';

export type MetaField = keyof MetaFile['fields'];
export const META_FIELDS: readonly MetaField[] = [
  'name', 'shortName', 'colour', 'icon', 'lecturer', 'term', 'language', 'description', 'vocabulary', 'dirs', 'askBeforeAdmit', 'largeClassAck',
];
export type MetaValues = { [K in MetaField]: NonNullable<MetaFile['fields'][K]>['value'] };
export type ClassDirsValue = MetaValues['dirs'];

/** One trusted meta file and the device that wrote it (the device named in its path). */
export interface MetaInput { deviceId: DeviceId; file: MetaFile }
/** The person bound to a device at a stamp (core/sync/members.ts `personAt`). */
export type PersonAt = (deviceId: DeviceId, hlc: Hlc) => MemberId | null;

// C0/C1 controls and the bidi overrides U+202A–U+202E, U+2066–U+2069 (folder spec §8.2 validation).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const cleanText = (s: unknown, min: number, max: number): s is string =>
  typeof s === 'string' && s.length >= min && s.length <= max && s.normalize('NFC') === s && !FORBIDDEN_TEXT.test(s);
const optText = (s: unknown, max: number, strict: boolean): boolean =>
  s === null || (typeof s === 'string' && s.length <= max && (!strict || (s.normalize('NFC') === s && !FORBIDDEN_TEXT.test(s))));

const DIR_KEYS = ['lectures', 'documents', 'exams', 'notes', 'fromChat'] as const;

/** Whether a `dirs` value passes §8.2: sanitised, no '/', no leading '.', five distinct names (NFC, case-insensitive). */
export function validDirs(v: unknown): v is ClassDirsValue {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const seen = new Set<string>();
  for (const k of DIR_KEYS) {
    const s = o[k];
    if (typeof s !== 'string' || s === '' || s.includes('/') || s.startsWith('.')) return false;
    if (sanitize(s, '\u0000') !== s) return false;
    const folded = s.normalize('NFC').toLowerCase();
    if (seen.has(folded)) return false;
    seen.add(folded);
  }
  return true;
}

/** Whether `value` is a valid value of `field` (folder spec §8.2; an invalid register counts as absent). */
export function validValue(field: MetaField, value: unknown): boolean {
  switch (field) {
    case 'name': return cleanText(value, 1, 120);
    case 'shortName': return cleanText(value, 1, 12);
    case 'colour': return isColourHex(value);
    case 'icon': return isIconName(value);
    case 'lecturer': return value === null || cleanText(value, 0, 80);
    case 'term': return value === null || cleanText(value, 0, 40);
    case 'language': return value === 'auto' || isLang(value);
    case 'description': return optText(value, 2000, false);
    case 'vocabulary': return optText(value, 500, false);
    case 'dirs': return validDirs(value);
    case 'askBeforeAdmit':
    case 'largeClassAck': return typeof value === 'boolean';
  }
}

/** Whether a register is well-formed and valid. */
export function validRegister(field: MetaField, reg: unknown): reg is Reg<unknown> {
  if (typeof reg !== 'object' || reg === null) return false;
  const r = reg as Record<string, unknown>;
  return isHlc(r.hlc) && 'value' in r && validValue(field, r.value);
}

// ── Organisers (folder spec §8.2 replay) ─────────────────────────────────────────────────────────
export interface OrganiserReplay {
  /** The organisers now. */
  organisers: ReadonlySet<MemberId>;
  /** The set after every op stamped at or before `hlc`. */
  at(hlc: Hlc): ReadonlySet<MemberId>;
  isOrganiserAt(memberId: MemberId | null, hlc: Hlc): boolean;
}

/**
 * Replays every `organiserOps` entry of the trusted meta files in HLC order (ties: the writer's full device ID,
 * then the position in the file), exactly as folder spec §8.2:
 * ```
 * S = { creator }
 * for op in all organiserOps sorted by hlc:
 *   author = person bound to the device whose file holds op (at op.hlc)
 *   valid  = author ∈ S or (op.op == "add" and op.memberId == author and S ⊆ vacated)
 *   if valid and op.op == "add" and author ∉ S: S = S − vacated
 *   if valid: add or remove op.memberId
 * ```
 */
export function replayOrganisers(creator: MemberId | null, metas: readonly MetaInput[], personAt: PersonAt, vacated: ReadonlySet<MemberId>): OrganiserReplay {
  type Op = { op: 'add' | 'remove'; memberId: MemberId; hlc: Hlc; deviceId: DeviceId; i: number };
  const ops: Op[] = [];
  for (const m of metas) {
    const list = Array.isArray(m.file.organiserOps) ? m.file.organiserOps : [];
    list.forEach((o, i) => {
      if (o && (o.op === 'add' || o.op === 'remove') && typeof o.memberId === 'string' && isHlc(o.hlc)) {
        ops.push({ op: o.op, memberId: o.memberId, hlc: o.hlc, deviceId: m.deviceId, i });
      }
    });
  }
  ops.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.i - b.i));
  let S = new Set<MemberId>(creator ? [creator] : []);
  const initial = new Set(S);
  const snapshots: Array<{ hlc: Hlc; set: ReadonlySet<MemberId> }> = [];
  for (const op of ops) {
    const author = personAt(op.deviceId, op.hlc);
    const subsetVacated = [...S].every((m) => vacated.has(m));
    const valid = (author !== null && S.has(author)) || (op.op === 'add' && author !== null && op.memberId === author && subsetVacated);
    if (valid && op.op === 'add' && author !== null && !S.has(author)) S = new Set([...S].filter((m) => !vacated.has(m)));
    if (valid) {
      S = new Set(S);
      if (op.op === 'add') S.add(op.memberId);
      else S.delete(op.memberId);
    }
    snapshots.push({ hlc: op.hlc, set: S });
  }
  const at = (hlc: Hlc): ReadonlySet<MemberId> => {
    let cur: ReadonlySet<MemberId> = initial;
    for (const s of snapshots) {
      if (s.hlc > hlc) break;
      cur = s.set;
    }
    return cur;
  };
  return { organisers: S, at, isOrganiserAt: (m, hlc) => m !== null && at(hlc).has(m) };
}

// ── Effective values ─────────────────────────────────────────────────────────────────────────────
export interface FoldedMeta {
  values: Partial<MetaValues>;
  /** HLC of the register in effect per field (the `w` of the override rule). */
  hlcs: Partial<Record<MetaField, Hlc>>;
  /** Device whose register is in effect per field. */
  writers: Partial<Record<MetaField, DeviceId>>;
}

/**
 * The effective value of each field: the valid register with the greatest HLC across the trusted meta files
 * (equal stamps: the greater writer device ID wins, §3.2). `askBeforeAdmit` counts only when `mayAdmit(device,
 * hlc)` says the writer's person was an organiser at the register's stamp.
 */
export function foldMeta(metas: readonly MetaInput[], mayAdmit: (deviceId: DeviceId, hlc: Hlc) => boolean): FoldedMeta {
  const out: FoldedMeta = { values: {}, hlcs: {}, writers: {} };
  for (const field of META_FIELDS) {
    let best: { hlc: Hlc; value: unknown; deviceId: DeviceId } | null = null;
    for (const m of metas) {
      const reg = (m.file.fields as Record<string, unknown> | undefined)?.[field];
      if (!validRegister(field, reg)) continue;
      if (field === 'askBeforeAdmit' && !mayAdmit(m.deviceId, reg.hlc)) continue;
      if (!best || reg.hlc > best.hlc || (reg.hlc === best.hlc && m.deviceId > best.deviceId)) best = { hlc: reg.hlc, value: reg.value, deviceId: m.deviceId };
    }
    if (best) {
      (out.values as Record<string, unknown>)[field] = best.value;
      out.hlcs[field] = best.hlc;
      out.writers[field] = best.deviceId;
    }
  }
  return out;
}

/**
 * The stamp for a new register value (folder spec §3.4): `max(tick, succ(w))` where `w` is the stamp in effect.
 * `tick` is the device's fresh stamp; `node` its HLC node. (services/hlcClock `override` does the same.)
 */
export function overrideStamp(tick: Hlc, current: Hlc | null | undefined, node: string): Hlc {
  return current ? maxHlc(tick, succHlc(current, node)) : tick;
}

/** The greatest `hlc` of a set of whole-file records (no-rollback bookkeeping). */
export const greatest = (hlcs: Iterable<Hlc>): Hlc | null => {
  let g: Hlc | null = null;
  for (const h of hlcs) if (g === null || h > g) g = h;
  return g;
};
