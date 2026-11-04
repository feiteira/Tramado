// The class chat (UX §3.10): the message list (day separators, author groups within 5 min, replies, attachments,
// mentions, edits and deletions, delivery ticks, @AI answers as AiCards with CitationChips, thanks and joined lines,
// unverified authors, newer-format count), the composer with mentions, replies and attachments, the @AI flow's
// local notices, the find bar (Ctrl/⌘+F) and the empty, loading and offline states. 0.1 has no reactions, pins or
// hides (v1.1): their actions and the pins strip are not shown.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { MessagesSquare, Search, UserPlus, X } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { MsgRef } from '../../core/model/files';
import type { Picked } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { ChatMessageView } from '../../services/types/viewModels';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { EmptyState, Notice } from '../../ui/components/Feedback';
import { SearchField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { Composer, decodeMentions, encodeMentions, type MentionOption } from '../../ui/tramado/Composer';
import { useI18n } from '../../ui/i18n';
import { chatRows, excerpt, findMatches, lastEditable, mentionsMe, visibleItems, WINDOW } from './model';
import { ChatLine, type LineContext } from './ChatLine';
import './chat.css';

const parseRef = (id: string): MsgRef => {
  const i = id.lastIndexOf(':');
  return { deviceId: id.slice(0, i), id: id.slice(i + 1) };
};

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const confirm = useConfirm();
  const dialogs = useDialogs();
  const { route, go } = useRouter();
  const cls = services.forClass(classId);
  const view = useStore(cls.chat.view);
  const aiLocal = useStore(cls.chat.ai);
  const detail = useStore(cls.info.detail);
  const model = useStore(cls.info.model);
  const classes = useStore(services.library.classes);
  const aiSettings = useStore(services.ai.settings);
  const lectures = useStore(cls.lectures.list);
  const classView = classes.find((c) => c.id === classId);
  const me = detail.me;

  const [extra, setExtra] = useState(0);
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [attachNotice, setAttachNotice] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [announce, setAnnounce] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seen = useRef<Set<string> | null>(null);

  // Thanks and "joined" lines (chat.system.*): joined comes from the members' files (the creator's is the class itself).
  const people = useMemo(() => new Map(detail.people.map((p) => [p.memberId, p])), [detail.people]);
  const joinedLines = useMemo<ChatMessageView[]>(() => {
    const creator = model.classFile?.createdBy?.memberId ?? null;
    const first = new Map<string, { at: string; deviceId: string; name: string }>();
    for (const [deviceId, m] of model.members) {
      const who = model.bindings.bound.get(deviceId);
      if (!who || who === creator || !m.file.joinedAt) continue;
      const cur = first.get(who);
      if (!cur || m.file.joinedAt < cur.at) first.set(who, { at: m.file.joinedAt, deviceId, name: people.get(who)?.name ?? m.file.name });
    }
    return [...first].map(([memberId, j]) => ({
      id: `joined:${memberId}`, kind: 'system' as const, at: j.at, text: t('chat.system.joined', { name: j.name }),
      author: { deviceId: j.deviceId, deviceName: '', memberId, memberName: j.name, self: memberId === me.memberId },
      replyTo: null, attachments: [], mentions: [], edited: false, deleted: false, hiddenBy: null, pinned: false, delivery: 'sent' as const, unverified: false,
    }));
  }, [model, people, me.memberId, t]);

  const all = useMemo(() => {
    const lines = visibleItems(view.items);
    if (!joinedLines.length || !view.loaded) return lines;
    const first = lines[0]?.at;
    // Joins older than the loaded window are left out (they would sort above "Loading earlier…").
    const joins = joinedLines.filter((j) => !first || !view.olderAvailable || j.at >= first);
    return [...lines, ...joins].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [view.items, view.loaded, view.olderAvailable, joinedLines]);
  const hidden = Math.max(0, all.length - (WINDOW + extra));
  const shown = useMemo(() => all.slice(hidden), [all, hidden]);
  const rows = useMemo(() => chatRows(shown), [shown]);

  const nameOf = useCallback((m: ChatMessageView) => (m.unverified ? t('chat.unverifiedAuthor', { device: m.author.deviceName || m.author.deviceId.slice(0, 7) }) : m.author.memberName), [t]);
  const matches = useMemo(() => (findOpen ? findMatches(shown, query, nameOf) : []), [findOpen, shown, query, nameOf]);
  const currentHit = matches.length ? matches[Math.min(hit, matches.length - 1)]! : null;

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const list: MentionOption[] = detail.people.filter((p) => !p.isMe && !p.banned).map((p) => ({ id: p.memberId, name: p.name }));
    if (aiSettings.enabled) list.push({ id: 'ai', name: t('chat.mention.ai') });
    if (me.isOrganiser) list.push({ id: 'everyone', name: t('chat.mention.everyone') });
    return list;
  }, [detail.people, aiSettings.enabled, me.isOrganiser, t]);
  const allNames = useMemo<MentionOption[]>(() => detail.people.map((p) => ({ id: p.memberId, name: p.name })), [detail.people]);

  const scrollToBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Stick to the bottom while the reader is there; announce new messages from others (role=log, polite).
  useLayoutEffect(() => {
    if (!view.loaded) return;
    if (atBottom.current) scrollToBottom();
    const ids = new Set(view.items.map((m) => m.id));
    if (seen.current) {
      const fresh = view.items.filter((m) => !seen.current!.has(m.id) && !m.author.self && m.kind !== 'system');
      const last = fresh[fresh.length - 1];
      if (last) setAnnounce(t('chat.newMessage', { name: nameOf(last), text: excerpt(decodeMentions(last.text, allNames), 140) }));
    }
    seen.current = ids;
  }, [view.items, view.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // A local @AI notice under my last message keeps the end in view.
  useLayoutEffect(() => {
    if (atBottom.current) scrollToBottom();
  }, [aiLocal]);

  // Read while the chat is open and the end is in view.
  useEffect(() => {
    if (view.loaded && atBottom.current && view.unread > 0) cls.chat.markRead();
  }, [view.loaded, view.unread, cls.chat]);

  // A route with messageId (a notification, a reply quote): scroll to the message and flash it.
  const target = route.name === 'class' ? route.messageId : undefined;
  useEffect(() => {
    if (!target || !view.loaded) return;
    reveal(target);
  }, [target, view.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function reveal(id: string) {
    const idx = all.findIndex((m) => m.id === id);
    if (idx < 0) return;
    if (idx < hidden) setExtra(all.length - WINDOW - idx + 20);
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      setFlash(id);
      setFocusId(id);
      el.focus({ preventScroll: true });
      window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
    });
  }

  useEffect(() => {
    if (currentHit) reveal(currentHit);
  }, [currentHit]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadEarlier() {
    if (hidden > 0) {
      const el = scroller.current;
      const before = el ? el.scrollHeight - el.scrollTop : 0;
      setExtra((x) => x + WINDOW);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
      return;
    }
    if (!view.olderAvailable || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      await cls.chat.loadOlder();
    } finally {
      setLoadingOlder(false);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    }
  }

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current && view.unread > 0) cls.chat.markRead();
    if (el.scrollTop < 80 && (hidden > 0 || view.olderAvailable)) void loadEarlier();
  };

  async function send(text: string, attachments: Picked[], reply: MsgRef | null) {
    try {
      atBottom.current = true;
      await cls.chat.send({ text, ...(reply ? { replyTo: reply } : {}), ...(attachments.length ? { attachments } : {}) });
      setReplyTo(null);
    } catch (e) {
      toast.error(e);
    }
  }

  async function attach(): Promise<Picked[]> {
    try {
      const picked = await services.ctx.platform.dialogs.pickFiles({ title: t('chat.attach'), filters: [], multiple: true });
      if (picked.length) {
        const ui = await cls.info.uiState().catch(() => ({}) as Record<string, unknown>);
        if (!ui['chat.attachNoticeSeen']) {
          setAttachNotice(true);
          void cls.info.setUiState({ 'chat.attachNoticeSeen': true }).catch(() => undefined);
        }
      }
      return picked;
    } catch (e) {
      toast.error(e);
      return [];
    }
  }

  async function remove(m: ChatMessageView) {
    const ok = await confirm({ title: t('chat.deleteConfirm.title'), confirmLabel: t('chat.deleteConfirm.confirm'), danger: true, 'data-testid': 'confirm-dialog' });
    if (!ok) return;
    try {
      await cls.chat.remove(parseRef(m.id));
    } catch (e) {
      toast.error(e);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const { id, text } = editing;
    const m = all.find((x) => x.id === id);
    setEditing(null);
    if (!m || text.trim() === decodeMentions(m.text, allNames).trim()) return;
    try {
      await cls.chat.edit(parseRef(id), encodeMentions(text, mentionOptions));
    } catch (e) {
      toast.error(e);
    }
  }

  function startEdit(m: ChatMessageView) {
    setEditing({ id: m.id, text: decodeMentions(m.text, allNames) });
  }

  async function copy(m: ChatMessageView) {
    const text = m.kind === 'ai' && m.ai ? m.ai.text.replace(/\[S\d{1,3}(?:,[^\]]*)?\]/g, '').trim() : decodeMentions(m.text, allNames);
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: t('common.copied'), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  }

  // The find bar takes the focus however it opens (Ctrl/⌘+F or the "Find in chat" link), so Esc closes it.
  const openFind = () => {
    setFindOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-testid="chat-find-input"]')?.focus());
  };
  // Closing it hands the focus back to the composer (the find field it had is gone).
  const closeFind = () => {
    setFindOpen(false);
    setQuery('');
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')?.focus());
  };

  // Keys: Ctrl/⌘+F find, Esc closes the reply bar / find bar, PageUp at the top loads earlier, ↑ in an empty
  // composer edits my last message, ↑/↓ move between messages in the list.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
      return;
    }
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if (editing) return;
      if (findOpen) {
        e.preventDefault();
        closeFind();
        return;
      }
      if (replyTo) {
        e.preventDefault();
        setReplyTo(null);
      }
      return;
    }
    if (e.key === 'PageUp' && (scroller.current?.scrollTop ?? 1) <= 0) void loadEarlier();
    const target = e.target as HTMLElement;
    if (e.key === 'ArrowUp' && target.tagName === 'TEXTAREA' && target.closest('[data-testid="chat-composer"]') && !(target as HTMLTextAreaElement).value) {
      const last = lastEditable(all);
      if (last) {
        e.preventDefault();
        startEdit(last);
      }
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return;
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, [role="toolbar"]')) return;
    const ids = shown.filter((m) => m.kind === 'message' || m.kind === 'ai').map((m) => m.id);
    if (!ids.length) return;
    e.preventDefault();
    const cur = focusId ? ids.indexOf(focusId) : -1;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, (cur < 0 ? ids.length : cur) + (e.key === 'ArrowDown' ? 1 : -1)));
    const id = ids[next]!;
    setFocusId(id);
    scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)?.focus();
  };

  const ctx: LineContext = {
    classId, services, me, people, allNames, lectures, aiLocal, folder: `${detail.meta.dirs.documents} › ${detail.meta.dirs.fromChat}`, aiLabel: (id) => services.ai.label(id), nameOf,
    mine: (m) => m.author.self && !m.unverified,
    mentionsMe: (m) => mentionsMe(m, me.memberId),
    lastMine: [...shown].reverse().find((m) => m.author.self && (m.kind === 'message' || m.kind === 'ai'))?.id ?? null,
    // A focused message that left the window (deleted, older than the window) gives the Tab stop back to the newest.
    editing, setEditing, saveEdit, flash, focusId: focusId && shown.some((m) => m.id === focusId) ? focusId : null, setFocusId,
    defaultFocus: [...shown].reverse().find((m) => m.kind === 'message' || m.kind === 'ai')?.id ?? null, match: currentHit, matches: new Set(matches),
    reply: (m) => {
      setReplyTo(m);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')?.focus());
    },
    copy, edit: startEdit, remove, reveal,
    retryAi: (m) => void cls.chat.retryAi(parseRef(m.id)).catch((e: unknown) => toast.error(e)),
    setUpAi: () => go({ name: 'settings', section: 'ai' }),
    openDoc: (relPath) => go({ name: 'document', classId, relPath }),
    go,
  };

  const othersExist = detail.people.some((p) => !p.isMe);
  const empty = view.loaded && all.filter((m) => m.kind !== 'system').length === 0;
  const short = classView?.shortName || detail.meta.shortName || detail.meta.name;

  return (
    <section className="chat" data-testid="class-chat" aria-label={t('chat.label')} onKeyDown={onKeyDown}>
      {view.newerFormatLines > 0 ? (
        <Notice tone="info" className="chat__notice" data-testid="chat-newer-format">{tp('chat.newerLines', view.newerFormatLines)}</Notice>
      ) : null}
      {findOpen ? (
        <div className="chat__find" role="search" data-testid="chat-find">
          <SearchField
            aria-label={t('chat.find')}
            placeholder={t('chat.find')}
            fieldClassName="chat__find-field"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setHit(0);
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matches.length) setHit((h) => (e.shiftKey ? (h - 1 + matches.length) % matches.length : (h + 1) % matches.length));
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeFind();
              }
            }}
            data-testid="chat-find-input"
          />
          <span className="chat__find-count t-small" aria-live="polite" data-testid="chat-find-count">
            {query.trim() ? t('chat.findCount', { n: matches.length ? Math.min(hit, matches.length - 1) + 1 : 0, total: matches.length }) : ''}
          </span>
          <IconButton icon={X} label={t('common.close')} onClick={closeFind} data-testid="chat-find-close" />
        </div>
      ) : null}
      <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
        <div className="chat__list" role="log" aria-live="off" aria-label={t('chat.label')} data-testid="chat-list" onKeyDown={onListKeyDown}>
          {hidden > 0 || view.olderAvailable ? (
            <div className="chat__earlier">
              <Button variant="ghost" size="sm" busy={loadingOlder} onClick={() => void loadEarlier()} data-testid="chat-load-earlier">
                {loadingOlder ? t('chat.loadingEarlier') : t('chat.loadEarlier')}
              </Button>
            </div>
          ) : null}
          {!view.loaded ? (
            <div className="chat__skeletons" aria-busy="true" aria-label={t('common.loading')} data-testid="chat-loading">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="chat__skeleton">
                  <span className="chat__skeleton-avatar" />
                  <span className="chat__skeleton-lines"><span /><span /></span>
                </div>
              ))}
            </div>
          ) : empty ? (
            othersExist ? (
              <EmptyState icon={MessagesSquare} title={t('chat.empty.quiet')} data-testid="chat-empty-quiet" />
            ) : (
              <EmptyState
                icon={MessagesSquare}
                title={t('chat.empty.aloneTitle')}
                actions={<Button variant="primary" icon={UserPlus} onClick={() => dialogs.open('invite', { classId })} data-testid="chat-invite">{t('chat.empty.invite')}</Button>}
                data-testid="chat-empty"
              >
                {t('chat.empty.aloneBody')}
              </EmptyState>
            )
          ) : (
            rows.map((r) =>
              r.kind === 'day' ? (
                <div key={r.key} className="chat__day" role="separator" data-testid="chat-day">
                  <span>{dayLabel(r.day, i18n)}</span>
                </div>
              ) : (
                <ChatLine key={r.key} row={r} ctx={ctx} />
              ),
            )
          )}
        </div>
      </div>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">{announce}</div>
      <div className="chat__bottom">
        {attachNotice ? (
          <Notice
            tone="info"
            className="chat__attach-notice"
            actions={<IconButton icon={X} size="sm" label={t('common.dismiss')} onClick={() => setAttachNotice(false)} data-testid="chat-attach-notice-close" />}
            data-testid="chat-attach-notice"
          >
            {t('chat.attachNotice')}
          </Notice>
        ) : null}
        {replyTo ? (
          <div className="chat__reply-bar" data-testid="chat-reply-bar">
            <span className="chat__reply-bar-text">
              {t('chat.replyingTo', { name: nameOf(replyTo), excerpt: excerpt(decodeMentions(replyTo.text, allNames) || (replyTo.attachments[0]?.name ?? ''), 50) })}
            </span>
            <IconButton icon={X} size="sm" label={t('chat.cancelReply')} onClick={() => setReplyTo(null)} data-testid="chat-reply-cancel" />
          </div>
        ) : null}
        <Composer
          placeholder={t('chat.placeholder', { class: short })}
          onSend={(text, files, reply) => void send(text, files, reply)}
          mentions={mentionOptions}
          onAttach={attach}
          replyTo={replyTo ? parseRef(replyTo.id) : null}
          className={replyTo ? 'composer--replying' : undefined}
          data-testid="chat-composer"
        />
        {!findOpen ? (
          <div className="chat__hint t-small">
            <button type="button" className="chat__find-open" onClick={openFind} data-testid="chat-find-open">
              <Search size={13} aria-hidden strokeWidth={1.75} /> {t('chat.find')}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function dayLabel(day: string, i18n: ReturnType<typeof useI18n>): string {
  const d = DateTime.fromISO(day);
  if (!d.isValid) return day;
  const today = DateTime.now().startOf('day');
  const diff = Math.round(today.diff(d.startOf('day'), 'days').days);
  if (diff === 0) return capitalise(i18n.t('common.relative.today'), i18n.meta.bcp47);
  if (diff === 1) return capitalise(i18n.t('common.relative.yesterday'), i18n.meta.bcp47);
  return capitalise(d.setLocale(i18n.meta.bcp47).toLocaleString({ weekday: 'long', day: 'numeric', month: 'long', ...(d.year !== today.year ? { year: 'numeric' } : {}) }), i18n.meta.bcp47);
}

const capitalise = (s: string, locale: string) => (s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s);
