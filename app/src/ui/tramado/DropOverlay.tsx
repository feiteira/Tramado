// DropOverlay (UX §2.11): a full-main overlay with a dashed accent border on squared paper.
import React from 'react';
import { Upload } from 'lucide-react';
import { useI18n } from '../i18n';

export interface DropOverlayProps {
  classId: string;
  target: 'documents' | 'exam' | 'lecture';
  className?: string;
  'data-testid'?: string;
  /** The class name for the documents sentence (UX §5.2 app.drop.documents); an M0 addition, optional. */
  classLabel?: string;
}

export function DropOverlay({ classId, target, className, classLabel, ...rest }: DropOverlayProps) {
  const { t } = useI18n();
  const text = target === 'documents' ? t('app.drop.documents', { class: classLabel ?? '' }) : t(`app.drop.${target}`);
  return (
    <div className={['drop-overlay', 'paper-grid', className].filter(Boolean).join(' ')} data-class-id={classId} data-testid={rest['data-testid'] ?? 'drop-overlay'}>
      <Upload size={40} strokeWidth={1.5} aria-hidden />
      <p>{text}</p>
    </div>
  );
}
