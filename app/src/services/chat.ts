// Class chat (folder spec §8.16, sync spec §15): reads the two most recent month files of every device plus any month
// file that changes (older ones on demand), folds them (core/sync/chat.ts: identity by device + id, edits and deletes
// by the author's person, redaction, replies after their parent, attribution to the bound person), maps them to the
// UX ChatMessageView, and writes my lines (message, edit, delete + redaction under a per-path lock, thanks). Delivery
// ticks come from `fileInfo` availability (≤ 1 poll / 2 s while unsent lines exist, on indexUpdated); unread and
// mentions from `private/<classId>/chat-state.json`; notifications for mentions and @everyone from organisers.
import { PlatformError } from '../core/errors';
import { newUlid } from '../core/ids';
import { parserFor } from '../core/model/parse';
import { classifyPath } from '../core/model/paths';
import { sanitize, unique } from '../core/model/sanitize';
import { instant } from '../core/model/time';
import { isHlc, type ClassId, type ClassPath, type DeviceId, type Hlc, type MemberId } from '../core/model/ids';
import type { ChatAi, ChatLine, Citation as StorageCitation, Locator as StorageLocator, MsgRef } from '../core/model/files';
import {
  CHAT_TEXT_MAX, chatLineOk, chatMonthOf, chatPath, chatTokens, foldChat, msgKey, notifiesMe, redactedLine, type ChatSourceLine, type FoldedMessage,
} from '../core/sync/chat';
import { jsonlLine } from '../core/json';
import type { ClassServiceImpl } from './class';
import type { AppContext } from './context';
import { Store } from './store';
import type { SyncServiceImpl } from './sync';
import type { AppServices, ClassStore } from './types/common';
import type { ChatService, ChatView } from './types/chat';
import type { AiAnswerView, ChatMessageView, Citation, Locator, ModelLabel, SourceRef } from './types/viewModels';

const POLL_MIN_MS = 2000;
const dec = new TextDecoder();
const enc = new TextEncoder();
const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', webm: 'audio/webm', mp3: 'audio/mpeg', mp4: 'video/mp4',
};
const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

interface FileState { lines: ChatSourceLine[]; size: number; skipped: number; newer: number }

/** The view-side model label of a model id ("google/gemma-4-31b-it:free" → "gemma-4-31b-it (free)"). */
export function modelLabel(id: string): ModelLabel {
  const free = id.endsWith(':free');
  const base = id.replace(/:free$/, '');
  return { id, label: `${base.slice(base.indexOf('/') + 1)}${free ? ' (free)' : ''}`, free };
}

function viewLocator(l: StorageLocator): Locator {
  switch (l.type) {
    case 'page': return { kind: 'page', page: l.page, ...(l.pageLabel ? { label: l.pageLabel } : {}) };
    case 'article': return { kind: 'article', label: l.article, page: l.pages?.[0] ?? 0, ...(l.pages && l.pages[1] !== l.pages[0] ? { pageEnd: l.pages[1] } : {}) };
    case 'slide': return { kind: 'slide', slide: l.slide };
    case 'segment': return { kind: 'time', ms: l.startMs, endMs: l.endMs, segmentId: l.segmentId };
    case 'heading': return { kind: 'heading', path: l.path };
    default: return { kind: 'none' };
  }
}

/** Storage citations of an `ai` line → the UX view citations (numbered by first appearance in the text). */
export function viewCitations(classId: ClassId, text: string, cites: StorageCitation[]): Citation[] {
  const order: string[] = [];
  for (const m of text.matchAll(/\[(S\d{1,3})(?:,[^\]]*)?\]/g)) if (!order.includes(m[1]!)) order.push(m[1]!);
  for (const c of cites) if (!order.includes(c.ref)) order.push(c.ref);
  return order.map((ref, i) => {
    const c = cites.find((x) => x.ref === ref);
    if (!c) return { n: i + 1, ref, pin: null, source: null, status: 'hallucinated' as const };
    const s = c.source;
    const source: SourceRef = {
      type: s.kind, classId, title: c.label, locator: viewLocator(c.locator), quote: c.quote ?? { exact: '', prefix: '', suffix: '' },
      ...(s.kind === 'document' || s.kind === 'note' ? { relPath: s.path, sha256: s.sha256 } : {}),
      ...(s.kind === 'lecture' ? { lectureId: s.lectureId } : {}),
      ...(s.kind === 'exam' ? { examId: s.examId } : {}),
    };
    return { n: i + 1, ref, pin: c.pin ?? null, source, status: 'ok' as const };
  });
}

export function createChatService(ctx: AppContext, app: () => AppServices, cls: { store: ClassStore; classId: ClassId }): ChatService {
  const { platform, clock } = ctx;
  const { store, classId } = cls;
  const view = new Store<ChatView>({ items: [], pins: [], unread: 0, mentions: 0, olderAvailable: false, newerFormatLines: 0 });
  const files = new Map<ClassPath, FileState>();
  const loadedMonths = new Map<DeviceId, Set<string>>();
  const sent = new Set<string>();
  const locks = new Map<ClassPath, Promise<unknown>>();
  const notified = new Set<string>();
  let readHlc: Hlc = '';
  let stateLoaded = false;
  let initialised = false;
  let lastPoll = -Infinity;
  let pollTimer: (() => void) | null = null;
  let folded: FoldedMessage[] = [];
  const me = () => ctx.device.get()?.deviceId ?? '';
  const info = () => app().forClass(classId).info as ClassServiceImpl;

  const withLock = <T>(path: ClassPath, f: () => Promise<T>): Promise<T> => {
    const prev = locks.get(path) ?? Promise.resolve();
    const next = prev.then(f, f);
    locks.set(path, next.catch(() => undefined));
    return next;
  };

  async function loadState() {
    if (stateLoaded) return;
    stateLoaded = true;
    try {
      const raw = await platform.privateFiles.read(classId, 'chat-state.json');
      if (raw) {
        const s = JSON.parse(dec.decode(raw)) as { readHlc?: unknown };
        if (isHlc(s.readHlc)) readHlc = s.readHlc;
      }
    } catch {
      readHlc = '';
    }
  }

  /** Every chat month file of the index, grouped by device, newest first. */
  function monthsByDevice(): Map<DeviceId, Array<{ month: string; path: ClassPath }>> {
    const out = new Map<DeviceId, Array<{ month: string; path: ClassPath }>>();
    for (const p of store.state.get().index.machine.keys()) {
      const i = classifyPath(p);
      if (i.kind !== 'chat' || !i.deviceId || !i.month) continue;
      out.set(i.deviceId, [...(out.get(i.deviceId) ?? []), { month: i.month, path: p }]);
    }
    for (const list of out.values()) list.sort((a, b) => (a.month < b.month ? 1 : -1));
    return out;
  }

  async function readFile(path: ClassPath) {
    const i = classifyPath(path);
    if (i.kind !== 'chat' || !i.deviceId) return;
    const loaded = await store.readJsonl(path, parserFor('tramado.chat'));
    if (loaded.verdict.kind === 'untrusted' && loaded.verdict.reason !== 'pending') {
      // a foreign write without the trusted prefix: keep what was trusted before
      if (files.has(path)) return;
    }
    if (loaded.verdict.kind === 'untrusted' && files.has(path)) return;
    let unknown = 0;
    const lines: ChatSourceLine[] = [];
    loaded.lines.forEach(({ value }, seq) => {
      if (chatLineOk(value)) lines.push({ deviceId: i.deviceId!, line: value, seq });
      else unknown++;
    });
    files.set(path, { lines, size: loaded.consumed, skipped: loaded.skipped, newer: loaded.newer + unknown });
    if (!loadedMonths.has(i.deviceId)) loadedMonths.set(i.deviceId, new Set());
    loadedMonths.get(i.deviceId)!.add(i.month!);
  }

  async function refresh(changed: ClassPath[] | null) {
    await loadState();
    const months = monthsByDevice();
    const wanted = new Set<ClassPath>();
    for (const [d, list] of months) {
      const loaded = loadedMonths.get(d);
      list.forEach((m, i) => {
        if (i < 2 || loaded?.has(m.month)) wanted.add(m.path);
      });
    }
    for (const p of changed ?? []) if (classifyPath(p).kind === 'chat') wanted.add(p);
    for (const p of [...files.keys()]) if (!store.state.get().index.machine.has(p) && !wanted.has(p)) files.delete(p);
    const toRead = changed === null ? [...wanted] : [...wanted].filter((p) => !files.has(p) || changed.includes(p));
    for (const p of toRead) await readFile(p);
    recompute();
  }

  function recompute() {
    const ci = info();
    const m = ci.model.get();
    const all = [...files.values()].flatMap((f) => f.lines);
    const fold = foldChat(all, { personAt: (d, h) => m.bindings.personAt(d, h) });
    folded = fold.messages;
    const mine = ctx.identity.get()?.memberId ?? '';
    const myDevice = me();
    const byKey = new Map(folded.map((x) => [x.key, x]));
    const items: ChatMessageView[] = folded.map((x) => toView(x, byKey, ci));
    let unread = 0;
    let mentions = 0;
    const fresh: FoldedMessage[] = [];
    for (const x of folded) {
      const self = x.ref.deviceId === myDevice || (x.author !== null && x.author === mine && !x.unverified);
      if (self || x.deleted || x.displayKey <= readHlc) continue;
      unread++;
      if (notifiesMe(x, mine, m.organisers.isOrganiserAt)) mentions++;
      if (initialised && !notified.has(x.key)) fresh.push(x);
    }
    for (const x of folded) notified.add(x.key);
    initialised = true;
    const months = monthsByDevice();
    const olderAvailable = [...months].some(([d, list]) => list.some((l) => !loadedMonths.get(d)?.has(l.month)));
    const newerFormatLines = [...files.values()].reduce((n, f) => n + f.newer, 0);
    const next: ChatView = { items, pins: [], unread, mentions, olderAvailable, newerFormatLines };
    if (JSON.stringify(next) !== JSON.stringify(view.get())) view.set(next);
    for (const x of fresh) {
      const why = notifiesMe(x, mine, m.organisers.isOrganiserAt);
      if (!why) continue;
      void app().notifications.notify('mention', why === 'mention' ? 'notify.mention' : 'notify.everyone', {
        name: ci.nameOf(x.ref.deviceId), class: ci.detail.get().meta.name, classId,
      }, `chat-${x.key}`).catch(() => undefined);
    }
    if (hasUnsent()) schedulePoll(0);
  }

  function toView(x: FoldedMessage, byKey: Map<string, FoldedMessage>, ci: ClassServiceImpl): ChatMessageView {
    const m = ci.model.get();
    const author = ci.deviceRef(x.ref.deviceId);
    const docs = store.state.get().index.documents;
    const line = x.line;
    const parent = x.replyTo ? byKey.get(msgKey(x.replyTo)) : undefined;
    const attachments = line.type === 'message' && !x.deleted && Array.isArray(line.attachments)
      ? line.attachments.map((a) => ({ relPath: a.path, name: a.name, size: a.size, arrived: docs.some((d) => d.path === a.path && d.size === a.size) }))
      : [];
    const nameOfMember = (id: MemberId | 'ai' | 'everyone') =>
      id === 'ai' || id === 'everyone' ? id : m.bindings.people.find((p) => p.memberId === id)?.name ?? id;
    const v: ChatMessageView = {
      id: x.key, author, at: instant(line.ms), text: x.deleted ? '' : x.text,
      kind: x.kind === 'thanks' ? 'thanks' : x.kind === 'ai' ? 'ai' : 'message',
      replyTo: x.replyTo ? { id: msgKey(x.replyTo), author: parent ? ci.nameOf(parent.ref.deviceId) : '', excerpt: parent && !parent.deleted ? parent.text.slice(0, 80) : '' } : null,
      attachments, mentions: x.mentions.map((id) => ({ memberId: id, name: nameOfMember(id) })), edited: x.edited, deleted: x.deleted, hiddenBy: null, pinned: false,
      delivery: x.ref.deviceId === me() ? (isSent(x) ? 'sent' : 'local') : 'sent', examDate: null, unverified: x.unverified,
    };
    if (line.type === 'thanks') {
      // ChatMessageView has no thanks fields (frozen): the lecture id travels in `text`, the thanked person in `mentions`.
      v.text = line.lectureId;
      v.mentions = [{ memberId: line.to, name: nameOfMember(line.to) }];
    }
    if (line.type === 'ai' && !x.deleted) v.ai = aiView(line, author, ci);
    return v;
  }

  function aiView(line: ChatAi, author: ChatMessageView['author'], _ci: ClassServiceImpl): AiAnswerView {
    const citations = viewCitations(classId, line.text, Array.isArray(line.citations) ? line.citations : []);
    const valid = citations.filter((c) => c.status === 'ok').length;
    return {
      text: line.text, citations, unverified: [], model: modelLabel(line.model), requested: modelLabel(line.requestedModel ?? line.model),
      fallback: !!line.requestedModel && line.requestedModel !== line.model, askedBy: author, at: instant(line.ms), mode: 'quick',
      grounded: citations.length ? valid / citations.length : 0, insufficient: line.status === 'error', sent: { passages: 0, chars: 0 },
    };
  }

  // ── delivery ticks (sync spec §15) ──────────────────────────────────────────────────────────────
  const isSent = (x: FoldedMessage): boolean => sent.has(x.key);
  const hasUnsent = () => folded.some((x) => x.ref.deviceId === me() && !sent.has(x.key));

  function schedulePoll(delay: number) {
    if (!store.state.get().entry.shared || pollTimer) return;
    const wait = Math.max(delay, lastPoll + POLL_MIN_MS - clock.mono());
    pollTimer = clock.setTimeout(() => {
      pollTimer = null;
      void poll();
    }, Math.max(0, wait));
  }
  async function poll() {
    lastPoll = clock.mono();
    const mine = [...files.keys()].filter((p) => classifyPath(p).deviceId === me());
    if (!mine.length) return;
    try {
      const infos = await platform.sync.fileInfo(classId, mine);
      let changed = false;
      for (const i of infos) {
        const f = files.get(i.path);
        // Another device holds the current version of the file, so every line it has is delivered.
        if (!f || i.availability.length === 0 || i.localSize === null || i.localSize < f.size) continue;
        for (const l of f.lines) {
          const key = `${l.deviceId}:${l.line.id}`;
          if (!sent.has(key)) {
            sent.add(key);
            changed = true;
          }
        }
      }
      if (changed) recompute();
    } catch {
      // no Syncthing here: lines stay "saved"
    }
  }

  // ── writing ────────────────────────────────────────────────────────────────────────────────────
  async function append(line: Omit<ChatLine, 'format' | 'version' | 'id' | 'hlc' | 'ms' | 'memberId'> & { type: ChatLine['type'] }): Promise<MsgRef> {
    const deviceId = me();
    const memberId = ctx.identity.get()?.memberId;
    if (!deviceId || !memberId) throw new PlatformError('INVALID', 'no identity');
    const now = clock.now();
    const hlc = ctx.hlc.tick();
    const id = newUlid(now, ctx.rand);
    const full = { format: 'tramado.chat', version: 1, id, hlc, ms: now, memberId, ...line } as ChatLine;
    const path = chatPath(deviceId, chatMonthOf(hlc));
    jsonlLine(full);   // throws INVALID over 65 536 bytes
    await withLock(path, () => store.appendLine(path, full));
    await platform.sync.scan(classId, `.tramado/chat/${deviceId}`).catch(() => undefined);
    await readFile(path);
    recompute();
    schedulePoll(0);
    return { deviceId, id };
  }

  async function copyAttachments(picks: NonNullable<Parameters<ChatService['send']>[0]['attachments']>) {
    if (picks.length > 10) throw new PlatformError('INVALID', 'at most 10 attachments');
    const dir = `${store.dir('documents')}/${store.dir('fromChat')}`;
    await store.mkdir(dir).catch(() => undefined);
    const siblings = (await platform.fs.list(classId, dir, { recursive: false }).catch(() => [])).map((e) => e.name);
    const out = [];
    for (const p of picks) {
      const name = unique(siblings, sanitize(p.name, 'file'));
      siblings.push(name);
      const stamp = await platform.fs.importFile(classId, p.token, `${dir}/${name}`);
      out.push({ path: stamp.path, name, size: stamp.size, sha256: stamp.sha256 ?? (await platform.fs.hash(classId, stamp.path)), mime: mimeOf(name) });
    }
    return out;
  }

  store.onChange(['chat'], (paths) => void refresh(paths).catch((e: unknown) => ctx.log('warn', 'chat refresh failed', { error: String(e) })));
  store.onChange(['members', 'document'], () => {
    if (initialised) recompute();
  });
  queueMicrotask(() => {
    try {
      (app().sync as SyncServiceImpl).onIndexUpdated?.((c) => {
        if (c === classId && hasUnsent()) schedulePoll(0);
      });
      info().model.subscribe(() => {
        if (initialised) recompute();
      });
    } catch {
      // services disposed
    }
  });

  const service: ChatService = {
    view,
    async send(input) {
      const text = input.text.normalize('NFC');
      if (text.length > CHAT_TEXT_MAX) throw new PlatformError('INVALID', 'a message has at most 8 000 characters');
      if (!text.trim() && !input.attachments?.length) throw new PlatformError('INVALID', 'empty message');
      const attachments = input.attachments?.length ? await copyAttachments(input.attachments) : [];
      const mentions = chatTokens(text);
      const ref = await append({
        type: 'message', text, ...(input.replyTo ? { replyTo: input.replyTo } : {}), ...(mentions.length ? { mentions } : {}),
        ...(attachments.length ? { attachments } : {}),
      } as never);
      service.markRead();
      if (mentions.includes('ai')) {
        void app().forClass(classId).ask.askInChat(ref).catch((e: unknown) => ctx.log('warn', '@AI failed', { error: String(e) }));
      }
      return ref;
    },
    async edit(ref, text) {
      const target = folded.find((x) => x.key === msgKey(ref));
      const mine = ctx.identity.get()?.memberId;
      if (!target || target.author !== mine || target.deleted || target.kind !== 'message') throw new PlatformError('PERMISSION_DENIED', 'only your own messages');
      if (text.length > CHAT_TEXT_MAX) throw new PlatformError('INVALID', 'a message has at most 8 000 characters');
      const mentions = chatTokens(text);
      await append({ type: 'edit', target: ref, text, ...(mentions.length ? { mentions } : {}) } as never);
    },
    async remove(ref) {
      const target = folded.find((x) => x.key === msgKey(ref));
      const mine = ctx.identity.get()?.memberId;
      if (!target || target.author !== mine) throw new PlatformError('PERMISSION_DENIED', 'only your own messages');
      await append({ type: 'delete', target: ref } as never);
      if (ref.deviceId !== me()) return;   // a line in my other computer's file: that computer redacts it
      const path = chatPath(ref.deviceId, chatMonthOf(target.line.hlc));
      await withLock(path, async () => {
        const bytes = await store.readBytes(path);
        if (!bytes) return;
        const out = dec.decode(bytes).split('\n').map((l) => {
          if (!l.trim()) return l;
          try {
            const v = JSON.parse(l) as ChatLine;
            return v.id === ref.id && !v.redacted ? JSON.stringify(redactedLine(v)) : l;
          } catch {
            return l;
          }
        });
        await store.writeBytes(path, enc.encode(out.join('\n')), { own: true });
      });
      await platform.sync.scan(classId, path).catch(() => undefined);
      await readFile(path);
      recompute();
    },
    async thank(memberId, lectureId) {
      await append({ type: 'thanks', to: memberId, lectureId } as never);
    },
    async loadOlder() {
      for (const [d, list] of monthsByDevice()) {
        const next = list.find((l) => !loadedMonths.get(d)?.has(l.month));
        if (next) await readFile(next.path);
      }
      recompute();
    },
    markRead() {
      const last = folded[folded.length - 1]?.displayKey;
      if (!last || last <= readHlc) return;
      readHlc = last;
      recompute();
      void platform.privateFiles.write(classId, 'chat-state.json', enc.encode(JSON.stringify({ format: 'tramado.chat-state', version: 1, readHlc, offsets: {} }))).catch(() => undefined);
    },
  };
  return service;
}
