// The newer-format notice (UX §3.15.8, G14): "Made with a newer Tramado — update to edit it." Wherever an item has
// `newerFormat`, screens show this and make the item read-only. Exported for every screen.
import React from 'react';
import { Info } from 'lucide-react';
import { Notice } from '../ui/components/Feedback';
import { useI18n } from '../ui/i18n';
import { cx } from '../ui/cx';

export function NewerFormatNotice({ className, 'data-testid': testid = 'newer-format' }: { className?: string; 'data-testid'?: string }) {
  const { t } = useI18n();
  return (
    <Notice tone="info" icon={Info} className={cx('newer-format', className)} data-testid={testid}>
      {t('app.newerFormat')}
    </Notice>
  );
}
