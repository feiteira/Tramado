import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { typedMatches } from '../confirmMatch';
import { useI18n } from '../i18n';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { TextField } from './Field';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A destructive action: the confirm button is red. */
  danger?: boolean;
  /** The confirm button stays disabled until this exact text is typed (a project's name). */
  typeToConfirm?: string;
  /** The prompt above the typing box; defaults to "Type {text} to confirm". */
  typePrompt?: string;
  'data-testid'?: string;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * "Are you sure?" with an optional typed confirmation. The cancel button takes the focus first,
 * so Enter pressed by habit does not destroy anything.
 */
export function ConfirmDialog({ open, onConfirm, onCancel, busy, title, body, confirmLabel, cancelLabel, danger, typeToConfirm, typePrompt, ...rest }: ConfirmDialogProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const ok = typeToConfirm === undefined || typedMatches(typed, typeToConfirm);
  const close = () => {
    setTyped('');
    onCancel();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      size="sm"
      dismissible={!busy}
      data-testid={rest['data-testid'] ?? 'confirm-dialog'}
      onSubmit={() => {
        if (ok && !busy) {
          setTyped('');
          onConfirm();
        }
      }}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy} data-autofocus={typeToConfirm === undefined ? true : undefined} data-testid="confirm-cancel">
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ok} busy={busy} data-testid="confirm-ok">
            {confirmLabel ?? t('common.ok')}
          </Button>
        </>
      }
    >
      {body ? <div className="t-secondary">{body}</div> : null}
      {typeToConfirm !== undefined ? (
        <TextField
          label={typePrompt ?? `${t('common.continue')}: ${typeToConfirm}`}
          value={typed}
          onChange={setTyped}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          data-testid="confirm-type"
        />
      ) : null}
    </Dialog>
  );
}

type Confirm = (opts: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Confirm | null>(null);

/** `await confirm({...})` resolves true when confirmed, false when cancelled. */
export function useConfirm(): Confirm {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConfirm outside ConfirmProvider');
  return v;
}

/**
 * Holds the one confirmation dialog of the app; a second request waits for the first. Mount it
 * keyed on what is open (App.tsx), so locking answers "no" to a question left on screen.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const queue = useRef<(ConfirmOptions & { resolve: (v: boolean) => void })[]>([]);
  const next = useCallback(() => setCurrent(queue.current.shift() ?? null), []);
  const confirm = useCallback<Confirm>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        queue.current.push({ ...opts, resolve });
        setCurrent((cur) => cur ?? queue.current.shift() ?? null);
      }),
    [],
  );
  // Unmounted (the library locked under an open question): every pending question is a no.
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(
    () => () => {
      currentRef.current?.resolve(false);
      for (const q of queue.current.splice(0)) q.resolve(false);
    },
    [],
  );
  const settle = (v: boolean) => {
    current?.resolve(v);
    next();
  };
  const value = useMemo(() => confirm, [confirm]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {current ? <ConfirmDialog key={JSON.stringify([current.title, current.typeToConfirm])} open {...current} onConfirm={() => settle(true)} onCancel={() => settle(false)} /> : null}
    </Ctx.Provider>
  );
}
