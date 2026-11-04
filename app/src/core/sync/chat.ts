// Class chat semantics (folder spec §8.16, sync spec §15): a message is identified by (device of its file, id);
// edits and deletes count only from the same person as the target's author device (greatest HLC edit wins, delete
// is final); reactions are per (member, target, emoji) by greatest HLC; redacted lines are deleted; display order is
// the display key (a reply never shows above its loaded parent), then the writer's full device ID, then the line
// number; every line is attributed to the person bound to its file's device (rule 6). Month files by the UTC month
// of the line's HLC. Pure and independent of the order lines arrive in.
import { parseHlc, succHlc } from '../hlc';
import { hlcNodeOf, isDeviceId, isHlc, isUlid, type DeviceId, type Hlc, type MemberId, type Ulid } from '../model/ids';
import type { ChatLine, ChatMessage, ChatAi, ChatThanks, MsgRef } from '../model/files';

export const CHAT_TEXT_MAX = 8000;
export const CHAT_TYPES = ['message', 'edit', 'delete', 'reaction', 'thanks', 'ai'] as const;

/** The UTC month (`YYYY-MM`) of an HLC's `ms` part: the month file a line goes into (§8.16). */
export function chatMonthOf(hlc: Hlc): string {
  const d = new Date(parseHlc(hlc).ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const chatPath = (deviceId: DeviceId, month: string): string => `.tramado/chat/${deviceId}/${month}.jsonl`;
export const msgKey = (r: MsgRef): string => `${r.deviceId}:${r.id}`;
export function msgRefOf(key: string): MsgRef | null {
  const i = key.lastIndexOf(':');
  const deviceId = key.slice(0, i);
  const id = key.slice(i + 1);
  return isDeviceId(deviceId) && isUlid(id) ? { deviceId, id } : null;
}

const TOKEN = /<@(everyone|ai|[a-z2-7]{26})>/g;
/** The `<@…>` tokens of a text, in order and without duplicates. */
export function chatTokens(text: string): Array<MemberId | 'everyone' | 'ai'> {
  const out: Array<MemberId | 'everyone' | 'ai'> = [];
  for (const m of text.matchAll(TOKEN)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** One line as read from a device's month file. */
export interface ChatSourceLine { deviceId: DeviceId; line: ChatLine; seq: number }

export interface ChatFoldContext {
  /** The person bound to a device (at a stamp: devices that left keep their binding before they left). */
  personAt(deviceId: DeviceId, hlc: Hlc): MemberId | null;
}

export interface FoldedMessage {
  key: string;
  ref: MsgRef;
  kind: 'message' | 'ai' | 'thanks';
  line: ChatMessage | ChatAi | ChatThanks;
  /** The person the message counts for (the bound person of the file's device), or null. */
  author: MemberId | null;
  /** The line's memberId differs from the bound person, or the device has no binding (rule 6). */
  unverified: boolean;
  text: string;
  mentions: Array<MemberId | 'everyone' | 'ai'>;
  edited: boolean;
  deleted: boolean;
  replyTo: MsgRef | null;
  displayKey: Hlc;
  /** emoji → members who currently react with it (read-only in 0.1). */
  reactions: Record<string, MemberId[]>;
  seq: number;
}

export interface ChatFold {
  messages: FoldedMessage[];
  /** Edits/deletes/reactions whose target is not loaded yet (kept, applied when it is). */
  waiting: number;
}

const validRef = (r: unknown): r is MsgRef =>
  typeof r === 'object' && r !== null && isDeviceId((r as MsgRef).deviceId) && isUlid((r as MsgRef).id);

/** Whether a parsed line has the fields 0.1 needs for its type (unknown types are counted by the caller). */
export function chatLineOk(l: unknown): l is ChatLine {
  if (typeof l !== 'object' || l === null) return false;
  const o = l as Record<string, unknown>;
  if (!isUlid(o.id) || !isHlc(o.hlc) || typeof o.ms !== 'number' || typeof o.memberId !== 'string') return false;
  if (o.redacted === true) return o.type === 'message';
  switch (o.type) {
    case 'message': return typeof o.text === 'string' && (o.replyTo === undefined || validRef(o.replyTo));
    case 'edit': return validRef(o.target) && typeof o.text === 'string';
    case 'delete': return validRef(o.target);
    case 'reaction': return validRef(o.target) && typeof o.emoji === 'string' && (o.op === 'add' || o.op === 'remove');
    case 'thanks': return typeof o.to === 'string' && isUlid(o.lectureId);
    case 'ai': return typeof o.text === 'string' && (o.status === 'ok' || o.status === 'error') && Array.isArray(o.citations) && (o.replyTo === undefined || validRef(o.replyTo));
    default: return false;
  }
}

const cmpOrder = (a: { displayKey: Hlc; ref: MsgRef; seq: number }, b: { displayKey: Hlc; ref: MsgRef; seq: number }) =>
  a.displayKey < b.displayKey ? -1 : a.displayKey > b.displayKey ? 1
    : a.ref.deviceId < b.ref.deviceId ? -1 : a.ref.deviceId > b.ref.deviceId ? 1 : a.seq - b.seq;

export function foldChat(lines: readonly ChatSourceLine[], ctx: ChatFoldContext): ChatFold {
  const messages = new Map<string, FoldedMessage>();
  const actions: ChatSourceLine[] = [];
  const seen = new Set<string>();
  for (const s of lines) {
    const l = s.line;
    const key = `${s.deviceId}:${l.id}`;
    if (seen.has(key)) continue;                     // the same line read twice
    seen.add(key);
    if (l.type === 'message' || l.type === 'ai' || l.type === 'thanks') {
      const author = ctx.personAt(s.deviceId, l.hlc);
      const redacted = l.redacted === true;
      const m = l as ChatMessage | ChatAi | ChatThanks;
      const text = redacted ? '' : m.type === 'thanks' ? '' : m.text;
      messages.set(key, {
        key, ref: { deviceId: s.deviceId, id: l.id }, kind: m.type, line: m, author,
        unverified: author === null || author !== l.memberId, text,
        mentions: m.type === 'message' && !redacted ? (Array.isArray(m.mentions) ? m.mentions.filter((x) => typeof x === 'string') : chatTokens(m.text)) : [],
        edited: false, deleted: redacted, replyTo: (m.type === 'message' || m.type === 'ai') && validRef(m.replyTo) ? m.replyTo : null,
        displayKey: l.hlc, reactions: {}, seq: s.seq,
      });
    } else actions.push(s);
  }
  // Edits, deletes and reactions, in HLC order (ties as display order).
  actions.sort((a, b) => cmpOrder({ displayKey: a.line.hlc, ref: { deviceId: a.deviceId, id: a.line.id }, seq: a.seq }, { displayKey: b.line.hlc, ref: { deviceId: b.deviceId, id: b.line.id }, seq: b.seq }));
  let waiting = 0;
  const lastEdit = new Map<string, Hlc>();
  const reactionState = new Map<string, { hlc: Hlc; on: boolean; member: MemberId; key: string; emoji: string }>();
  for (const s of actions) {
    const l = s.line as ChatLine & { target: MsgRef };
    const target = messages.get(msgKey(l.target));
    if (!target) {
      waiting++;
      continue;
    }
    const actor = ctx.personAt(s.deviceId, l.hlc);
    if (l.type === 'reaction') {
      if (!actor || actor !== l.memberId) continue;
      const rk = JSON.stringify([actor, target.key, l.emoji]);
      const cur = reactionState.get(rk);
      if (!cur || l.hlc > cur.hlc) reactionState.set(rk, { hlc: l.hlc, on: l.op === 'add', member: actor, key: target.key, emoji: l.emoji });
      continue;
    }
    // edit / delete: the actor's person must be the bound person of the target's author device.
    const targetPerson = ctx.personAt(target.ref.deviceId, target.line.hlc);
    if (!actor || !targetPerson || actor !== targetPerson) continue;
    if (target.kind !== 'message') {
      if (l.type === 'delete') target.deleted = true;
      continue;
    }
    if (l.type === 'delete') {
      target.deleted = true;
      target.text = '';
      continue;
    }
    if (l.type === 'edit' && !target.deleted) {
      const prev = lastEdit.get(target.key);
      if (!prev || l.hlc > prev) {
        lastEdit.set(target.key, l.hlc);
        target.text = l.text;
        target.mentions = Array.isArray(l.mentions) ? l.mentions : chatTokens(l.text);
        target.edited = true;
      }
    }
  }
  for (const st of reactionState.values()) {
    if (!st.on) continue;
    const m = messages.get(st.key);
    if (m) (m.reactions[st.emoji] ??= []).push(st.member);
  }
  for (const m of messages.values()) for (const e of Object.keys(m.reactions)) m.reactions[e]!.sort();
  // Display keys: a reply never shows above its loaded parent (max(hlc, succ(parent's display key))).
  const resolving = new Set<string>();
  const keyOf = (m: FoldedMessage): Hlc => {
    if (!m.replyTo || resolving.has(m.key)) return m.displayKey;
    const parent = messages.get(msgKey(m.replyTo));
    if (!parent || parent === m) return m.displayKey;
    resolving.add(m.key);
    const pk = keyOf(parent);
    resolving.delete(m.key);
    const after = succHlc(pk, hlcNodeOf(m.ref.deviceId));
    m.displayKey = m.line.hlc >= after ? m.line.hlc : after;
    return m.displayKey;
  };
  for (const m of messages.values()) keyOf(m);
  return { messages: [...messages.values()].sort(cmpOrder), waiting };
}

/** Whether a message notifies `me` (a mention, or @everyone by an organiser at the line's HLC). */
export function notifiesMe(m: FoldedMessage, me: MemberId, isOrganiserAt: (memberId: MemberId | null, hlc: Hlc) => boolean): 'mention' | 'everyone' | null {
  if (m.deleted || m.author === me || m.unverified) return null;
  if (m.mentions.includes(me)) return 'mention';
  if (m.mentions.includes('everyone') && isOrganiserAt(m.author, m.line.hlc)) return 'everyone';
  return null;
}

/** The redaction of a deleted line (§8.16 "Deleting for everyone"). */
export function redactedLine(l: ChatLine): ChatLine {
  return { format: l.format, version: l.version, type: 'message', id: l.id, hlc: l.hlc, ms: l.ms, memberId: l.memberId, redacted: true } as ChatLine;
}

export type { Ulid };
