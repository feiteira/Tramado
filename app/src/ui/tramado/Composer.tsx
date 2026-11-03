// Composer (UX §2.11): Enter sends, Shift+Enter makes a new line (chat and Ask). Mentions are offered as
// `<@id>` tokens by the chat owner (UI-GROUP); M0 keeps the props and the basic behaviour.
import React, { useState } from 'react';
import { Paperclip, SendHorizontal } from 'lucide-react';
import type { Picked } from '../../platform/types';
import type { MsgRef } from '../../core/model/files';
import { IconButton } from '../components/Button';
import { TextArea } from '../components/Field';
import { useI18n } from '../i18n';

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

export function Composer({ placeholder, onSend, mentions, disabled, onAttach, replyTo = null, className, ...rest }: ComposerProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const send = () => {
    if (disabled || (!text.trim() && !files.length)) return;
    onSend(text, files, replyTo);
    setText('');
    setFiles([]);
  };
  void mentions;
  const id = rest['data-testid'] ?? 'composer';
  return (
    <div className={['composer', className].filter(Boolean).join(' ')} data-testid={id}>
      {onAttach ? (
        <IconButton icon={Paperclip} label={t('chat.attach')} disabled={!!disabled} onClick={() => void onAttach().then((p) => setFiles((f) => [...f, ...p]))} data-testid={`${id}-attach`} />
      ) : null}
      <TextArea
        className="composer__input"
        label={<span className="visually-hidden">{placeholder}</span>}
        value={text}
        onChange={setText}
        placeholder={disabled ?? placeholder}
        disabled={!!disabled}
        autoGrow
        minHeight={40}
        maxHeight={200}
        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        data-testid={`${id}-input`}
      />
      <IconButton icon={SendHorizontal} label={t('chat.send')} disabled={!!disabled || (!text.trim() && !files.length)} onClick={send} data-testid={`${id}-send`} />
    </div>
  );
}
