// Invites (sync spec §7): encode/decode `tri1_` codes, validation (§7.3), size reduction to ≤ 2,000 characters,
// the reduced QR invite (first device, ≤ 2 addresses, no s/lt/tm/lg), the address selection order of §7.1,
// the device choice of §7.1, and `findCode(text)` (§7.2 parsing; `trp` codes are pairing, v1.1).
import { fromBase64, toBase64 } from '../bytes';
import { deviceIdChecks } from '../model/sig';
import { isClassId, isColourHex, isIconName, isLang, isMemberId, dashed, dashless, type ClassId, type DeviceId } from '../model/ids';
import type { InviteV1 } from '../model/files';

export const CODE_PREFIX = 'tri1_';
export const LINK_PREFIX = 'tramado://join/';
export const MAX_CODE = 4096;
export const TARGET_CODE = 2000;
/** The static join page (sync spec §25 Q4): '' until it is live; links and the QR then use `tramado://join/`. */
export const JOIN_PAGE = '';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

const toB64Url = (b: Uint8Array) => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s: string) => {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(std + '='.repeat((4 - (std.length % 4)) % 4));
};

/** The compact JSON of an invite with its keys in the order of §7.1 (no spaces). */
export function inviteJson(inv: InviteV1): string {
  const o: Record<string, unknown> = { v: inv.v, f: inv.f, l: inv.l };
  if (inv.s !== undefined) o.s = inv.s;
  o.c = inv.c;
  o.i = inv.i;
  if (inv.lt !== undefined) o.lt = inv.lt;
  if (inv.tm !== undefined) o.tm = inv.tm;
  if (inv.lg !== undefined) o.lg = inv.lg;
  o.m = inv.m;
  o.n = inv.n;
  o.d = inv.d.map((d) => ({ id: d.id, a: d.a }));
  o.t = inv.t;
  if (inv.x !== undefined) o.x = inv.x;
  return JSON.stringify(o);
}

export const encodeInvite = (inv: InviteV1): string => CODE_PREFIX + toB64Url(enc.encode(inviteJson(inv)));
export const inviteLink = (code: string): string => LINK_PREFIX + code;
export const inviteWeb = (code: string): string | null => (JOIN_PAGE ? `${JOIN_PAGE}#${code}` : null);

const CODE_RE = /\btr([ip])(\d+)_([A-Za-z0-9_-]{40,4096})/;

export type FoundCode = { kind: 'invite' | 'pair'; version: number; code: string; payload: string };

/** The first `tr[ip]<n>_…` code in pasted text, a file or a link (§7.2), or null. */
export function findCode(text: string): FoundCode | null {
  const m = CODE_RE.exec(text);
  if (!m) return null;
  return { kind: m[1] === 'i' ? 'invite' : 'pair', version: Number(m[2]), code: m[0], payload: m[3]! };
}

export type InviteProblem = 'invalid' | 'newer' | 'pair' | 'tooLong';

export interface DecodedInvite {
  code: string;
  invite: InviteV1;
  /** Canonical IDs of the valid devices, in order. */
  devices: Array<{ deviceId: DeviceId; addresses: string[] }>;
  old: boolean;
}

const ADDR = /^(tcp|quic):\/\/(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$|^relay:\/\/(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):\d{1,5}\/\?id=[A-Z2-7-]{56,63}(&.*)?$/;
export const validAddress = (a: unknown): a is string => typeof a === 'string' && a.length <= 512 && ADDR.test(a);

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined);

/**
 * Decodes and validates a code (§7.3) in TypeScript, for the preview. Rust decodes it again itself when joining
 * (§9.5). Throws an `InviteProblem` string.
 */
export function decodeInvite(text: string, nowSec: number): DecodedInvite {
  const found = findCode(text);
  if (!found) throw 'invalid' satisfies InviteProblem;
  if (found.kind === 'pair') throw 'pair' satisfies InviteProblem;
  if (found.version > 1) throw 'newer' satisfies InviteProblem;
  if (found.version !== 1) throw 'invalid' satisfies InviteProblem;
  if (found.code.length > MAX_CODE) throw 'tooLong' satisfies InviteProblem;
  let raw: unknown;
  try {
    raw = JSON.parse(dec.decode(fromB64Url(found.payload)));
  } catch {
    throw 'invalid' satisfies InviteProblem;
  }
  if (typeof raw !== 'object' || raw === null) throw 'invalid' satisfies InviteProblem;
  const o = raw as Record<string, unknown>;
  if (typeof o.v === 'number' && o.v > 1) throw 'newer' satisfies InviteProblem;
  if (o.v !== 1 || !isClassId(o.f) || !Array.isArray(o.d)) throw 'invalid' satisfies InviteProblem;
  const devices: DecodedInvite['devices'] = [];
  for (const d of (o.d as unknown[]).slice(0, 3)) {
    if (typeof d !== 'object' || d === null) continue;
    const id = (d as Record<string, unknown>).id;
    if (typeof id !== 'string' || !/^[A-Z2-7]{56}$/.test(id)) continue;
    const deviceId = dashed(id);
    if (!deviceIdChecks(deviceId)) continue;
    const a = (d as Record<string, unknown>).a;
    devices.push({ deviceId, addresses: Array.isArray(a) ? a.filter(validAddress).slice(0, 5) : [] });
  }
  if (devices.length === 0) throw 'invalid' satisfies InviteProblem;
  const invite: InviteV1 = {
    v: 1, f: o.f, l: str(o.l, 120) ?? o.f, c: isColourHex(o.c) ? o.c : '#8d8d86', i: isIconName(o.i) ? o.i : 'book-open',
    m: isMemberId(o.m) ? o.m : '', n: str(o.n, 64) ?? '', d: devices.map((d) => ({ id: dashless(d.deviceId), a: d.addresses })),
    t: typeof o.t === 'number' ? o.t : 0,
  };
  const s = str(o.s, 12);
  if (s) invite.s = s;
  const lt = str(o.lt, 80);
  if (lt) invite.lt = lt;
  const tm = str(o.tm, 40);
  if (tm) invite.tm = tm;
  if (isLang(o.lg)) invite.lg = o.lg;
  if (typeof o.x === 'number') invite.x = o.x;
  return { code: found.code, invite, devices, old: invite.x !== undefined && invite.x < nowSec };
}

const isLan = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;                         // IPv6 ULA
  return h === 'localhost' || /^127\./.test(h) || h === '::1';
};
const hostOf = (a: string) => /^[a-z]+:\/\/(\[[^\]]+\]|[^:/]+)/.exec(a)?.[1] ?? '';

/** §7.1 per-device address order: up to 2 LAN tcp, 1 relay, 1 public tcp, 1 LAN quic (at most 5). */
export function selectInviteAddresses(addresses: readonly string[]): string[] {
  const valid = [...new Set(addresses.filter(validAddress))];
  const lanTcp = valid.filter((a) => a.startsWith('tcp://') && isLan(hostOf(a))).slice(0, 2);
  const relay = valid.filter((a) => a.startsWith('relay://')).slice(0, 1);
  const pubTcp = valid.filter((a) => a.startsWith('tcp://') && !isLan(hostOf(a))).slice(0, 1);
  const lanQuic = valid.filter((a) => a.startsWith('quic://') && isLan(hostOf(a))).slice(0, 1);
  return [...lanTcp, ...relay, ...pubTcp, ...lanQuic];
}

export interface InviteCandidate { deviceId: DeviceId; addresses: string[]; connected: boolean; organiser: boolean; lastSeenMs: number | null }

/** §7.1: my own device first; then up to 2 roster devices: connected first, then organisers', then most recently seen. */
export function chooseInviteDevices(me: InviteCandidate, others: readonly InviteCandidate[]): InviteCandidate[] {
  const rest = others
    .filter((o) => o.deviceId !== me.deviceId)
    .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.organiser) - Number(a.organiser)
      || (b.lastSeenMs ?? -1) - (a.lastSeenMs ?? -1) || (a.deviceId < b.deviceId ? -1 : 1));
  return [me, ...rest.slice(0, 2)];
}

/** Writers keep codes ≤ 2,000 characters by dropping, in order: quic, public tcp, the 3rd then 2nd device, lt, tm (§7.2). */
export function reduceInvite(inv: InviteV1, limit = TARGET_CODE): InviteV1 {
  let cur: InviteV1 = { ...inv, d: inv.d.map((d) => ({ ...d, a: [...d.a] })) };
  const fits = (x: InviteV1) => encodeInvite(x).length <= limit;
  const steps: Array<(x: InviteV1) => InviteV1> = [
    (x) => ({ ...x, d: x.d.map((d) => ({ ...d, a: d.a.filter((a) => !a.startsWith('quic://')) })) }),
    (x) => ({ ...x, d: x.d.map((d) => ({ ...d, a: d.a.filter((a) => !(a.startsWith('tcp://') && !isLan(hostOf(a)))) })) }),
    (x) => ({ ...x, d: x.d.slice(0, 2) }),
    (x) => ({ ...x, d: x.d.slice(0, 1) }),
    (x) => {
      const { lt: _lt, ...rest } = x;
      return rest;
    },
    (x) => {
      const { tm: _tm, ...rest } = x;
      return rest;
    },
  ];
  for (const step of steps) {
    if (fits(cur)) return cur;
    cur = step(cur);
  }
  return cur;
}

/** The reduced QR invite (§7.2): the first device only, ≤ 2 addresses, no s, lt, tm, lg. */
export function qrInvite(inv: InviteV1): InviteV1 {
  const { s: _s, lt: _lt, tm: _tm, lg: _lg, ...rest } = inv;
  return { ...rest, d: inv.d.slice(0, 1).map((d) => ({ id: d.id, a: d.a.slice(0, 2) })) };
}

/** What the QR encodes: the reduced invite as `web` when the build has a join page, otherwise as `link`. */
export function qrText(inv: InviteV1): string {
  const code = encodeInvite(qrInvite(inv));
  return inviteWeb(code) ?? inviteLink(code);
}

/** The `.tramado-invite` file name: "<short name or name>.tramado-invite" (sanitised by the caller). */
export const inviteFileName = (inv: InviteV1): string => `${inv.s ?? inv.l}.tramado-invite`;

export type { ClassId };
