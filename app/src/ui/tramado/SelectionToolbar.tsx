// SelectionToolbar (UX §2.11): role="toolbar" over a text selection, roving focus (arrow keys).
// Highlight opens the five meanings (important, didn't get it, exam, to do, other) and calls
// onAction('highlight', colour). It stays inside the window (above the selection, or below when there is no room).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
const COLOURS = ['important', 'confused', 'exam', 'todo', 'other'] as const;

export function SelectionToolbar({ anchor, actions, onAction, className, ...rest }: SelectionToolbarProps) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: Math.max(0, anchor.top - 44) });
  const [colours, setColours] = useState(false);
  const id = rest['data-testid'] ?? 'selection-toolbar';

  useLayoutEffect(() => {
    const el = box.current;
    const w = el?.offsetWidth ?? 320;
    const h = el?.offsetHeight ?? 40;
    const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
    const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - w / 2), Math.max(8, vw - w - 8));
    const above = anchor.top - h - 8;
    const top = above >= 8 ? above : Math.min(vh - h - 8, anchor.top + anchor.height + 8);
    setPos({ left, top });
  }, [anchor.left, anchor.top, anchor.width, anchor.height, colours]);

  // Esc closes the colours first (the owner of the toolbar closes the toolbar itself).
  useEffect(() => {
    if (!colours) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setColours(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [colours]);

  return (
    <div
      ref={box}
      className={['selection-toolbar', className].filter(Boolean).join(' ')}
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.preventDefault()}
      data-testid={id}
    >
      {colours ? (
        <Toolbar label={t('lectures.selection.highlight')} roving>
          {COLOURS.map((c) => (
            <Button key={c} size="sm" variant="ghost" onClick={() => onAction('highlight', c)} data-testid={`selection-highlight-${c}`}>
              <span className="selection-toolbar__swatch" data-mk={c} aria-hidden />
              {t(`lectures.selection.highlightKinds.${c}`)}
            </Button>
          ))}
        </Toolbar>
      ) : (
        <Toolbar label={t('lectures.selection.label')} roving>
          {actions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant="ghost"
              icon={ICON[a]}
              onClick={() => (a === 'highlight' ? setColours(true) : onAction(a))}
              className={a === 'explain' || a === 'ask' ? 'selection-toolbar__ai' : undefined}
              data-testid={`selection-${a}`}
            >
              {t(`lectures.selection.${a}`)}
            </Button>
          ))}
        </Toolbar>
      )}
    </div>
  );
}
