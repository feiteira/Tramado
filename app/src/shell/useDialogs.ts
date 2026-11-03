// Opening the registry's dialogs (architecture §11.4): useDialogs().open(id, props). The dialog host in
// Layout.tsx renders the open dialog lazily from DIALOGS; the demo's `dialog=` parameter uses the same ids.
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { DialogId, DialogPropsMap } from '../features/registry';

export interface OpenDialog<I extends DialogId = DialogId> { id: I; props: DialogPropsMap[I]; key: number }

export interface DialogsValue {
  open<I extends DialogId>(id: I, props: DialogPropsMap[I]): void;
  close(): void;
  current: OpenDialog | null;
}

const Ctx = createContext<DialogsValue | null>(null);

export function DialogsProvider({ children, initial }: { children: ReactNode; initial?: { id: DialogId; props: DialogPropsMap[DialogId] } | null }) {
  const [current, setCurrent] = useState<OpenDialog | null>(initial ? { ...initial, key: 0 } : null);
  const open = useCallback(<I extends DialogId>(id: I, props: DialogPropsMap[I]) => setCurrent((c) => ({ id, props, key: (c?.key ?? 0) + 1 }) as OpenDialog), []);
  const close = useCallback(() => setCurrent(null), []);
  const value = useMemo(() => ({ open, close, current }), [open, close, current]);
  return createElement(Ctx.Provider, { value }, children);
}

export function useDialogs(): DialogsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDialogs outside DialogsProvider');
  return v;
}
