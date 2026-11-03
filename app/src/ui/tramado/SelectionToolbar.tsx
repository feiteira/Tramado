// SelectionToolbar (UX §2.11): role="toolbar" over a text selection, roving focus.
import React from 'react';
import { Highlighter, MessageSquare, Quote, Sparkles } from 'lucide-react';
import type { Rect } from '../position';
import { Toolbar } from '../components/Feedback';
import { Button } from '../components/Button';
import { useI18n } from '../i18n';

export type SelectionAction = 'highlight' | 'comment' | 'explain' | 'ask' | 'copy';

export interface SelectionToolbarProps {
  anchor: Rect;
  actions: SelectionAction[];
  onAction(a: SelectionAction, kind?: string): void;
  className?: string;
  'data-testid'?: string;
}

const ICON = { highlight: Highlighter, comment: MessageSquare, explain: Sparkles, ask: Sparkles, copy: Quote } as const;

export function SelectionToolbar({ anchor, actions, onAction, className, ...rest }: SelectionToolbarProps) {
  const { t } = useI18n();
  return (
    <div className={['selection-toolbar', className].filter(Boolean).join(' ')} style={{ position: 'fixed', left: anchor.left, top: Math.max(0, anchor.top - 44) }} data-testid={rest['data-testid'] ?? 'selection-toolbar'}>
      <Toolbar label={t('lectures.selection.label')} roving>
        {actions.map((a) => (
          <Button key={a} size="sm" variant="ghost" icon={ICON[a]} onClick={() => onAction(a)} data-testid={`selection-${a}`}>
            {t(`lectures.selection.${a}`)}
          </Button>
        ))}
      </Toolbar>
    </div>
  );
}
