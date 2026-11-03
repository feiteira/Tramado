import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { type Undoable, UndoManager, UndoRefusedError, type UndoState } from './undoManager';
import { isTextEntry, modalOpen } from '../ui/focus';
import { useToast } from '../ui/components/Toast';
import { useI18n } from '../ui/i18n';
import { stepDoneMessage, stepRefusedMessage } from './undoFeedback';

// The undo/redo stack (shell/undoManager.ts), shared by every screen. Screens
// record what a domain operation returns:
//   const { code, undo } = await createCode(project, {...});
//   record(undo);
// Ctrl/⌘+Z and Shift+Ctrl/⌘+Z (or Ctrl+Y) undo and redo outside text fields, where the field's
// own undo applies, and never while a dialog is open over the screen.

export interface UndoValue {
  manager: UndoManager;
  state: UndoState;
  record: (entry: Undoable) => void;
  /** Undoes the last step and says so on a toast; resolves true only when a step was undone. */
  undo: () => Promise<boolean>;
  /** Redoes the last undone step; resolves true only when a step was redone. */
  redo: () => Promise<boolean>;
}

const Ctx = createContext<UndoValue | null>(null);

export function useUndo(): UndoValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUndo outside UndoProvider');
  return v;
}

/** One stack for the ready phase. */
export function UndoProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => new UndoManager());
  const toast = useToast();
  const i18n = useI18n();
  useEffect(() => () => manager.clear(), [manager]);
  const state = useSyncExternalStore(
    useCallback((fn: () => void) => manager.subscribe(fn), [manager]),
    // `labels` builds a new object each call: cache by the values it holds.
    useMemo(() => {
      let last: UndoState | null = null;
      return () => {
        const next = manager.labels;
        if (last && JSON.stringify(last) === JSON.stringify(next)) return last;
        last = next;
        return next;
      };
    }, [manager]),
  );

  // Every undo and redo says what it did, on a toast (a polite live region) that offers the way
  // back: Ctrl+Z works from any screen, and a step reverted out of sight must not pass unnoticed.
  const step = useCallback(
    async (kind: 'undo' | 'redo'): Promise<boolean> => {
      // The step about to run, to name it if it is refused (the stack drops a refused step).
      const top = manager.labels[kind];
      let entry: Undoable | null;
      try {
        entry = await (kind === 'undo' ? manager.undo() : manager.redo());
      } catch (e) {
        if (e instanceof UndoRefusedError) {
          console.warn(e);
          toast.show({ message: stepRefusedMessage(kind, top, i18n), tone: 'danger', durationMs: 12_000 });
        } else toast.error(e);
        return false;
      }
      if (!entry) return false;
      const back = kind === 'undo' ? 'redo' : 'undo';
      toast.show({
        message: stepDoneMessage(kind, entry, i18n),
        action: { label: i18n.t(back === 'undo' ? 'common.undo' : 'common.redo'), run: () => void stepRef.current(back), testId: `toast-${back}` },
      });
      return true;
    },
    [manager, toast, i18n],
  );
  const stepRef = useRef(step);
  stepRef.current = step;
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);
  const record = useCallback((entry: Undoable) => manager.record(entry), [manager]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && !e.metaKey);
      if (!isUndo && !isRedo) return;
      if (isTextEntry(e.target) || modalOpen()) return;
      e.preventDefault();
      void (isUndo ? undo() : redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const value = useMemo(() => ({ manager, state, record, undo, redo }), [manager, state, record, undo, redo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
