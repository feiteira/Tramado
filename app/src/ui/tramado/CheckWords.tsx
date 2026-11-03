// CheckWords (UX §2.11, §3.12.6): the two check words of a device, in mono, with a copy button.
import React from 'react';
import { Copy } from 'lucide-react';
import { checkWords } from '../../core/sync/checkWords';
import { IconButton } from '../components/Button';
import { useI18n } from '../i18n';

export interface CheckWordsProps {
  deviceId: string;
  className?: string;
  'data-testid'?: string;
}

export function CheckWords({ deviceId, className, ...rest }: CheckWordsProps) {
  const { t } = useI18n();
  let words = '';
  try {
    words = checkWords(deviceId);
  } catch {
    words = '—';
  }
  return (
    <span className={['check-words', className].filter(Boolean).join(' ')} data-testid={rest['data-testid'] ?? 'check-words'} data-device-id={deviceId}>
      <span className="visually-hidden">{t('members.checkWords.label')}: </span>
      <code translate="no">{words}</code>
      <IconButton icon={Copy} label={t('members.checkWords.copy')} size="sm" onClick={() => void navigator.clipboard?.writeText(words)} data-testid="check-words-copy" />
    </span>
  );
}
