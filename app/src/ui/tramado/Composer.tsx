// Composer (UX §2.11, §3.10.2): Enter sends, Shift+Enter makes a new line (chat and Ask). With `mentions`, "@"
// opens the mention popover (members, AI, everyone); a picked person shows as "@Name" while typing and is sent as
// the chat token `<@memberId>` (folder spec §8.16). `@ai`, `@ia`, `@AI` and `@IA` are accepted when AI is offered.
// Picked files show as removable chips. The chat owns the reply bar and the edit-last-message gesture.
import React, { useId, useMemo, useRef, useState } from 'react';
import { FileText, Paperclip, SendHorizontal, Sparkles, Users, X } from 'lucide-react';
import type { Picked } from '../../platform/types';
import type { MsgRef } from '../../core/model/files';
import { IconButton } from '../components/Button';
import { TextArea } from '../components/Field';
import { cx } from '../cx';
import { useI18n } from '../i18n';
import { Avatar } from './Avatar';
import './group.css';

export interface MentionOption { id: string; name: string }

export interface ComposerProps {
  placeholder: string;
  onSend(text: string, attachments: Picked[], replyTo: MsgRef | null): void;
  mentions: MentionOption[];
  disabled?: string;
  onAttach?(): Promise<Picked[]>;
  replyTo?: MsgRef | null;
  className?: string;
  'data-testid'?: string;
}

const AI_WORDS = /(^|[^\p{L}\p{N}_<])@(ai|ia)(?![\p{L}\p{N}_])/giu;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The "@query" being typed right before the caret, or null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\p{L}\p{N}._'’-]*)$/u.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

/** Options whose name (or id, for ai/everyone) starts a word with the query; accents and case ignored. */
export function filterMentions(options: readonly MentionOption[], query: string): MentionOption[] {
  const q = fold(query);
  if (!q) return [...options];
  return options.filter((o) => {
    const names = [o.name, ...(o.id === 'ai' ? ['ai', 'ia'] : o.id === 'everyone' ? ['everyone', 'todos'] : [])];
    return names.some((n) => fold(n).split(/\s+/).some((w) => w.startsWith(q)) || fold(n).startsWith(q));
  });
}

/**
 * The text as sent: "@Name" of each offered person becomes `<@memberId>` (longest names first), `@ai`/`@ia` become
 * `<@ai>` when AI is offered, `@everyone` becomes `<@everyone>` when offered. Existing tokens are kept.
 */
export function encodeMentions(text: string, options: readonly MentionOption[]): string {
  let out = text;
  const people = options.filter((o) => o.id !== 'ai' && o.id !== 'everyone' && o.name.trim()).sort((a, b) => b.name.length - a.name.length);
  for (const p of people) {
    const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}_<])@${esc}(?![\\p{L}\\p{N}_])`, 'gu'), (_m, pre: string) => `${pre}<@${p.id}>`);
  }
  if (options.some((o) => o.id === 'ai')) out = out.replace(AI_WORDS, (_m, pre: string) => `${pre}<@ai>`);
  if (options.some((o) => o.id === 'everyone')) out = out.replace(/(^|[^\p{L}\p{N}_<])@(everyone|todos)(?![\p{L}\p{N}_])/giu, (_m, pre: string) => `${pre}<@everyone>`);
  return out;
}

/** The editable text of a stored message: tokens back to "@Name" (unknown members keep their token). */
export function decodeMentions(text: string, options: readonly MentionOption[]): string {
  return text.replace(/<@(everyone|ai|[a-z2-7]{26})>/g, (raw, id: string) => {
    if (id === 'ai') return '@AI';
    if (id === 'everyone') return '@everyone';
    const o = options.find((x) => x.id === id);
    return o ? `@${o.name}` : raw;
  });
}

const presets = new Map<string, string>();
/** Text the next Composer mounted with this test id starts with (e.g. "Report a problem" pre-fills the class chat). */
export function presetComposerText(testid: string, text: string): void {
  presets.set(testid, text);
}

export function Composer({ placeholder, onSend, mentions, disabled, onAttach, replyTo = null, className, ...rest }: ComposerProps) {
  const { t } = useI18n();
  const [text, setText] = useState(() => {
    const key = rest['data-testid'] ?? 'composer';
    const preset = presets.get(key) ?? '';
    presets.delete(key);
    return preset;
  });
  const [files, setFiles] = useState<Picked[]>([]);
  const [caret, setCaret] = useState(() => text.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const id = rest['data-testid'] ?? 'composer';
  // Child ids: `chat-composer` → `chat-input`, `chat-send`, `chat-attach` (UX §3.10.2); other roots keep `${id}-input`.
  const child = (part: string) => (id.endsWith('-composer') ? `${id.slice(0, -'-composer'.length)}-${part}` : `${id}-${part}`);
  const q = mentions.length ? mentionQuery(text, caret) : null;
  const options = useMemo(() => (q ? filterMentions(mentions, q.query).slice(0, 8) : []), [q?.query, mentions]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = !!q && options.length > 0 && dismissed !== q.start && !disabled;
  const sel = Math.min(active, Math.max(0, options.length - 1));
  // AI is not offered (off on this computer) but someone typed @AI: say so (UX §3.10.2).
  const aiOff = mentions.length > 0 && !mentions.some((m) => m.id === 'ai') && new RegExp(AI_WORDS.source, 'iu').test(text);

  const send = () => {
    if (disabled || (!text.trim() && !files.length)) return;
    onSend(encodeMentions(text, mentions), files, replyTo);
    setText('');
    setFiles([]);
    setCaret(0);
  };
  const pick = (o: MentionOption) => {
    if (!q) return;
    const label = o.id === 'ai' ? t('chat.mention.ai') : o.id === 'everyone' ? t('chat.mention.everyone') : o.name;
    const next = `${text.slice(0, q.start)}@${label} ${text.slice(caret)}`;
    const at = q.start + label.length + 2;
    setText(next);
    setCaret(at);
    setActive(0);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
    });
  };
  const track = (e: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart ?? 0);

  return (
    <div className={cx('composer', disabled && 'composer--disabled', className)} data-testid={id}>
      {files.length ? (
        <div className="composer__files" data-testid={child('files')}>
          {files.map((f, i) => (
            <span key={`${f.token}-${i}`} className="composer__file" title={f.name}>
              <FileText size={14} aria-hidden strokeWidth={1.75} />
              <span>{f.name}</span>
              <IconButton icon={X} size="sm" label={t('common.remove')} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} data-testid={child('file-remove')} />
            </span>
          ))}
        </div>
      ) : null}
      {onAttach ? (
        <IconButton icon={Paperclip} label={t('chat.attach')} disabled={!!disabled} onClick={() => void onAttach().then((p) => setFiles((f) => [...f, ...p]))} data-testid={child('attach')} />
      ) : null}
      <TextArea
        ref={input}
        fieldClassName="composer__input"
        label={<span className="visually-hidden">{placeholder}</span>}
        value={text}
        onChange={(v) => {
          setText(v);
          setCaret(input.current?.selectionStart ?? v.length);
          setDismissed(null);
        }}
        onSelect={track}
        onKeyUp={track}
        onClick={track}
        placeholder={disabled ?? placeholder}
        disabled={!!disabled}
        autoGrow
        minHeight={36}
        maxHeight={200}
        aria-controls={open ? listId : undefined}
        aria-autocomplete={mentions.length ? 'list' : undefined}
        aria-activedescendant={open ? `${listId}-${sel}` : undefined}
        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((sel + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pick(options[sel]!);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDismissed(q!.start);
              return;
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        data-testid={child('input')}
      />
      <IconButton icon={SendHorizontal} variant="secondary" label={t('chat.send')} disabled={!!disabled || (!text.trim() && !files.length)} onClick={send} data-testid={child('send')} />
      {aiOff ? <p className="composer__hint" data-testid={child('ai-off')}>{t('chat.ai.off')}</p> : null}
      {open ? (
        <ul className="composer__mentions" role="listbox" id={listId} aria-label={t('chat.mention.label')} data-testid="chat-mention-popover">
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === sel}
              className="composer__mention"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              data-testid="chat-mention-option"
              data-mention-id={o.id}
            >
              {o.id === 'ai' ? (
                <span className="composer__mention-icon composer__mention-icon--ai" aria-hidden><Sparkles size={15} strokeWidth={1.75} /></span>
              ) : o.id === 'everyone' ? (
                <span className="composer__mention-icon" aria-hidden><Users size={15} strokeWidth={1.75} /></span>
              ) : (
                <Avatar name={o.name} memberId={o.id} size={28} />
              )}
              <span className="composer__mention-text">
                <span className="composer__mention-name">{o.id === 'ai' ? t('chat.mention.ai') : o.id === 'everyone' ? `@${t('chat.mention.everyone')}` : o.name}</span>
                {o.id === 'ai' ? <span className="composer__mention-hint">{t('chat.mention.aiHint')}</span> : null}
                {o.id === 'everyone' ? <span className="composer__mention-hint">{t('chat.mention.everyoneHint')}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
