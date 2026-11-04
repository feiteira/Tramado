// One row of the class chat (UX §3.10.2): a message (header when it starts an author group, reply quote, text with
// mention pills, attachments, edited/deleted states, delivery), an @AI answer as an AiCard with CitationChips and a
// compact source list, or a centred thanks/joined line. Hover or focus shows the actions toolbar.
import React from 'react';
import { DateTime } from 'luxon';
import { Check, Clock3, Copy, CornerUpLeft, FileText, Pencil, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import type { Route } from '../../shell/routes';
import type { AppServices } from '../../services/types/common';
import type { ClassDetail, Person } from '../../services/types/class';
import type { ChatAiLocal } from '../../services/types/chat';
import type { ChatMessageView, LectureView, ModelLabel, ViewCitation } from '../../services/types/viewModels';
import { Button, IconButton } from '../../ui/components/Button';
import { Notice, Toolbar } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { Tooltip } from '../../ui/components/Tooltip';
import { AiCard } from '../../ui/tramado/AiCard';
import { Avatar } from '../../ui/tramado/Avatar';
import { CitationChip } from '../../ui/tramado/CitationChip';
import { SourceRow } from '../../ui/tramado/SourceRow';
import { MarkdownView } from '../../ui/tramado/MarkdownView';
import type { MentionOption } from '../../ui/tramado/Composer';
import { classStyle, memberColour } from '../../ui/classColor';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { formatSize } from '../sync/format';
import { excerpt } from './model';
import type { ChatRow } from './model';

export interface LineContext {
  classId: string;
  services: AppServices;
  me: ClassDetail['me'];
  people: Map<string, Person>;
  allNames: MentionOption[];
  lectures: LectureView[];
  /** "Documents › From chat" (where attachments are kept). */
  folder: string;
  aiLocal: Record<string, ChatAiLocal>;
  aiLabel(id: string): ModelLabel;
  nameOf(m: ChatMessageView): string;
  mine(m: ChatMessageView): boolean;
  mentionsMe(m: ChatMessageView): boolean;
  lastMine: string | null;
  editing: { id: string; text: string } | null;
  setEditing(e: { id: string; text: string } | null): void;
  saveEdit(): Promise<void>;
  flash: string | null;
  focusId: string | null;
  setFocusId(id: string): void;
  match: string | null;
  matches: Set<string>;
  reply(m: ChatMessageView): void;
  copy(m: ChatMessageView): Promise<void>;
  edit(m: ChatMessageView): void;
  remove(m: ChatMessageView): Promise<void>;
  reveal(id: string): void;
  retryAi(m: ChatMessageView): void;
  setUpAi(): void;
  openDoc(relPath: string): void;
  go(r: Route): void;
}

export function ChatLine({ row, ctx }: { row: Extract<ChatRow, { kind: 'line' }>; ctx: LineContext }) {
  const i18n = useI18n();
  const { t } = i18n;
  const m = row.message;
  const at = DateTime.fromISO(m.at);
  const time = at.isValid ? i18n.time(at) : '';

  if (m.kind === 'thanks' || m.kind === 'system') {
    let text = m.text;
    if (m.kind === 'thanks' && m.thanks) {
      const lecture = ctx.lectures.find((l) => l.id === m.thanks!.lectureId)?.title ?? t('chat.aLecture');
      const b = m.thanks.to.memberId === ctx.me.memberId ? t('common.you') : m.thanks.to.name;
      text = t('chat.system.thanks', { a: ctx.mine(m) ? capital(t('common.you'), i18n.meta.bcp47) : ctx.nameOf(m), b, lecture });
    }
    return (
      <div className="chat-system" data-testid="chat-system" data-message-id={m.id} data-kind={m.kind}>
        <span>{text}</span>
        <time dateTime={m.at} className="chat-system__time">{time}</time>
      </div>
    );
  }

  const person = ctx.people.get(m.author.memberId);
  const colour = memberColour(m.author.memberId, person?.colour ?? null);
  const mine = ctx.mine(m);
  const editing = ctx.editing?.id === m.id ? ctx.editing : null;
  const local = ctx.aiLocal[m.id];
  const mention = ctx.mentionsMe(m);
  const showDelivery = mine && (m.delivery === 'local' || m.id === ctx.lastMine);
  const name = ctx.nameOf(m);

  const renderMention = (target: string, key: string) => {
    const label = target === 'ai' ? `@${t('chat.mention.ai')}` : target === 'everyone' ? `@${t('chat.mention.everyone')}` : `@${ctx.allNames.find((x) => x.id === target)?.name ?? m.mentions.find((x) => x.memberId === target)?.name ?? '…'}`;
    const isMe = target === ctx.me.memberId || (target === 'everyone' && !mine);
    return <span key={key} className={cx('chat-mention', isMe && 'chat-mention--me', target === 'ai' && 'chat-mention--ai')} data-testid="chat-mention">{label}</span>;
  };

  const openCitation = (c: ViewCitation) => {
    const s = c.source;
    if (!s) return;
    if (s.type === 'lecture' && s.lectureId) {
      const l = s.locator;
      ctx.go({ name: 'lecture', classId: ctx.classId, lectureId: s.lectureId, ...(l.kind === 'time' ? { at: l.ms, ...(l.segmentId ? { segmentId: l.segmentId } : {}) } : {}), ...(s.quote.exact ? { quote: s.quote.exact } : {}) });
    } else if ((s.type === 'document' || s.type === 'note') && s.relPath) {
      const l = s.locator;
      if (s.type === 'note') ctx.go({ name: 'note', classId: ctx.classId, relPath: s.relPath, private: !!s.private });
      else ctx.go({ name: 'document', classId: ctx.classId, relPath: s.relPath, ...(s.sha256 ? { sha256: s.sha256 } : {}), ...(l.kind === 'page' || l.kind === 'article' ? { page: l.page } : {}), ...(l.kind === 'slide' ? { slide: l.slide } : {}), ...(s.quote.exact ? { quote: s.quote.exact } : {}) });
    } else if (s.type === 'exam' && s.examId) {
      ctx.go({ name: 'exam', classId: ctx.classId, examId: s.examId, ...(s.locator.kind === 'question' ? { questionId: s.locator.questionId } : {}) });
    }
  };

  const body = m.deleted ? (
    <p className="chat-msg__deleted" data-testid="chat-deleted">{t('chat.deleted')}</p>
  ) : editing ? (
    <div className="chat-msg__edit" data-testid="chat-edit-box">
      <TextArea
        label={<span className="visually-hidden">{t('chat.actions.edit')}</span>}
        value={editing.text}
        onChange={(v) => ctx.setEditing({ id: m.id, text: v })}
        autoGrow
        minHeight={36}
        maxHeight={240}
        autoFocus
        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void ctx.saveEdit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            ctx.setEditing(null);
          }
        }}
        data-testid="chat-edit-input"
      />
      <div className="chat-msg__edit-actions">
        <span className="t-small t-muted">{t('chat.editHint')}</span>
        <Button size="sm" variant="ghost" onClick={() => ctx.setEditing(null)} data-testid="chat-edit-cancel">{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" onClick={() => void ctx.saveEdit()} data-testid="chat-edit-save">{t('common.save')}</Button>
      </div>
    </div>
  ) : m.kind === 'ai' && m.ai ? (
    <AiCard
      className="chat-msg__ai"
      title={t('chat.ai.author')}
      model={ctx.aiLabel(m.ai.model.id)}
      askedBy={t('chat.ai.askedBy', { name: mine ? capital(t('common.you'), i18n.meta.bcp47) : name })}
      data-testid="chat-ai-card"
      footer={m.ai.citations.length ? (
        <div className="chat-msg__sources" data-testid="chat-ai-sources">
          {m.ai.citations.filter((c) => c.source).map((c) => <SourceRow key={c.n} citation={c} onOpen={openCitation} />)}
        </div>
      ) : undefined}
    >
      <MarkdownView
        source={m.ai.text}
        links="internal-only"
        citations
        renderCite={(refs, pin, key) => (
          <React.Fragment key={key}>
            {refs.map((ref) => {
              const c = m.ai!.citations.find((x) => x.ref === ref);
              return c ? <CitationChip key={`${key}-${ref}`} citation={pin && !c.pin ? { ...c, pin } : c} onOpen={openCitation} /> : null;
            })}
          </React.Fragment>
        )}
      />
    </AiCard>
  ) : m.text.trim() ? (
    <MarkdownView
      className="chat-msg__text"
      source={m.text}
      links="all"
      mentions
      renderMention={renderMention}
      onLink={(href) => {
        if (!/^https:\/\//i.test(href)) return;
        void ctx.services.ctx.platform.system.openExternal(href, { title: t('chat.link.title'), message: t('chat.link.body'), confirm: t('chat.link.open'), cancel: t('common.cancel') });
      }}
      data-testid="chat-text"
    />
  ) : null;

  const actions = !m.deleted && !editing ? (
    <Toolbar label={t('chat.actions.label')} roving className="chat-msg__actions" data-testid="chat-actions">
      <IconButton icon={CornerUpLeft} size="sm" label={t('chat.actions.reply')} onClick={() => ctx.reply(m)} data-testid="chat-reply" />
      <IconButton icon={Copy} size="sm" label={t('chat.actions.copy')} onClick={() => void ctx.copy(m)} data-testid="chat-copy" />
      {mine && m.kind === 'message' ? <IconButton icon={Pencil} size="sm" label={t('chat.actions.edit')} onClick={() => ctx.edit(m)} data-testid="chat-edit" /> : null}
      {mine ? <IconButton icon={Trash2} size="sm" variant="danger" label={t('chat.actions.delete')} onClick={() => void ctx.remove(m)} data-testid="chat-delete" /> : null}
    </Toolbar>
  ) : null;

  return (
    <article
      className={cx('chat-msg', row.first && 'chat-msg--first', row.last && 'chat-msg--last', mention && 'chat-msg--mention', ctx.flash === m.id && 'chat-msg--flash',
        ctx.match === m.id && 'chat-msg--match', ctx.matches.has(m.id) && 'chat-msg--hit', m.unverified && 'chat-msg--unverified', m.kind === 'ai' && 'chat-msg--ai')}
      tabIndex={ctx.focusId === m.id ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) ctx.setFocusId(m.id);
      }}
      aria-label={`${name}, ${time}`}
      data-testid="chat-message"
      data-message-id={m.id}
      data-mine={mine || undefined}
      data-delivery={mine ? m.delivery : undefined}
    >
      <div className="chat-msg__gutter" aria-hidden>
        {row.first ? <Avatar name={m.unverified ? '?' : m.author.memberName} memberId={m.author.memberId} colour={colour} size={28} /> : <time className="chat-msg__hover-time" dateTime={m.at}>{time}</time>}
      </div>
      <div className="chat-msg__main">
        {row.first ? (
          <header className="chat-msg__head">
            <span className={cx('chat-msg__author cls-scope', m.unverified && 'chat-msg__author--unverified')} style={classStyle(colour)} data-testid="chat-author">
              {m.unverified ? <ShieldAlert size={13} aria-hidden strokeWidth={1.75} /> : null}
              {mine ? t('common.youSuffix', { name }) : name}
            </span>
            <time className="chat-msg__time" dateTime={m.at}>{time}</time>
            {m.edited && !m.deleted ? <span className="chat-msg__edited">{t('chat.edited')}</span> : null}
            {showDelivery ? <Delivery m={m} /> : null}
          </header>
        ) : (m.edited && !m.deleted) || showDelivery ? (
          <div className="chat-msg__head chat-msg__head--sub">
            {m.edited && !m.deleted ? <span className="chat-msg__edited">{t('chat.edited')}</span> : null}
            {showDelivery ? <Delivery m={m} /> : null}
          </div>
        ) : null}
        {m.replyTo ? (
          <button type="button" className="chat-msg__quote" onClick={() => ctx.reveal(m.replyTo!.id)} data-testid="chat-reply-quote">
            <CornerUpLeft size={12} aria-hidden strokeWidth={1.75} />
            <span className="chat-msg__quote-author">{m.replyTo.author || '…'}</span>
            <span className="chat-msg__quote-text">{m.replyTo.excerpt ? excerpt(m.replyTo.excerpt.replace(/<@([a-z2-7]{26})>/g, (raw, id: string) => `@${ctx.allNames.find((x) => x.id === id)?.name ?? '…'}`), 80) : t('chat.deleted')}</span>
          </button>
        ) : null}
        {body}
        {m.attachments.length && !m.deleted ? (
          <div className="chat-msg__files">
            {m.attachments.map((a) => (
              <button
                key={a.relPath}
                type="button"
                className={cx('chat-file', !a.arrived && 'chat-file--arriving')}
                onClick={() => a.arrived && ctx.openDoc(a.relPath)}
                aria-disabled={!a.arrived || undefined}
                data-testid="chat-attachment"
                data-path={a.relPath}
              >
                <FileText size={18} aria-hidden strokeWidth={1.75} className="chat-file__icon" />
                <span className="chat-file__text">
                  <span className="chat-file__name">{a.name}</span>
                  <span className="chat-file__meta">{a.arrived ? t('chat.attachmentMeta', { size: formatSize(a.size, i18n), folder: ctx.folder }) : t('common.arriving')}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {local && mine ? <AiLocal state={local} m={m} ctx={ctx} /> : null}
      </div>
      {actions}
    </article>
  );
}

function Delivery({ m }: { m: ChatMessageView }) {
  const { t } = useI18n();
  if (m.delivery === 'local') {
    return (
      <span className="chat-msg__delivery chat-msg__delivery--local" data-testid="chat-delivery-local">
        <Clock3 size={12} aria-hidden strokeWidth={1.75} /> {t('chat.pending')}
      </span>
    );
  }
  return (
    <Tooltip label={t('chat.sentTooltip')}>
      <span className="chat-msg__delivery" tabIndex={0} data-testid="chat-delivery-sent">
        <Check size={12} aria-hidden strokeWidth={2} /> {t('chat.sent')}
      </span>
    </Tooltip>
  );
}

function AiLocal({ state, m, ctx }: { state: ChatAiLocal; m: ChatMessageView; ctx: LineContext }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  if (state.state === 'working') {
    const lectures = ctx.lectures.filter((l) => l.transcription.kind === 'done').length;
    const documents = ctx.services.forClass(ctx.classId).documents.list.get().length;
    return (
      <div className="chat-msg__ai-working" aria-busy="true" data-testid="chat-ai-working">
        <Sparkles size={14} aria-hidden strokeWidth={1.75} />
        <span>{t('chat.ai.working', { lectures: tp('common.count.lectures', lectures), documents: tp('common.count.documents', documents) })}</span>
      </div>
    );
  }
  if (state.state === 'noKey') {
    return (
      <Notice tone="info" className="chat-msg__ai-notice" actions={<Button size="sm" onClick={ctx.setUpAi} data-testid="chat-ai-setup">{t('chat.ai.setUp')}</Button>} data-testid="chat-ai-nokey">
        {t('chat.ai.noKey')}
      </Notice>
    );
  }
  const key = `errors.${state.code}`;
  const text = t(key as 'errors.AI_BUSY');
  return (
    <Notice tone="warning" className="chat-msg__ai-notice" actions={<Button size="sm" onClick={() => ctx.retryAi(m)} data-testid="chat-ai-retry">{t('common.tryAgain')}</Button>} data-testid="chat-ai-error">
      {text === key ? t('chat.ai.failed') : text}
    </Notice>
  );
}

const capital = (s: string, locale: string) => (s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s);
