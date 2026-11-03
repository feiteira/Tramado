// M0 placeholders (plan §2.3 item 7): a screen, tab, section or dialog renders its root test id, a heading
// from its namespace and `<pre data-testid="placeholder-data">` with a JSON summary of the store(s) it will
// show. Stubs that throw show "NOT_IMPLEMENTED". Wave-2 owners replace their files and stop using this.
import React, { useEffect, useState, type ReactNode } from 'react';
import { Hammer } from 'lucide-react';
import { toPlatformError } from '../core/errors';
import type { ReadableStore } from '../services/store';
import { Dialog } from '../ui/components/Dialog';
import { Button } from '../ui/components/Button';
import { EmptyState } from '../ui/components/Feedback';
import { useI18n } from '../ui/i18n';
import { useStore } from '../shell/useStore';
import { ScreenHeader } from '../shell/ScreenHeader';

/** Runs `f`; a thrown stub becomes its error code (e.g. "NOT_IMPLEMENTED"). */
export function safe<T>(f: () => T): T | string {
  try {
    return f();
  } catch (e) {
    return toPlatformError(e).code;
  }
}

/** A store's value, or the error code its stub threw. */
export function useStoreSafe<T>(get: () => ReadableStore<T>): T | string {
  const store = safe(get);
  const fallback: ReadableStore<T | string> = { get: () => store as string, subscribe: () => () => undefined };
  return useStore<T | string>(typeof store === 'string' ? fallback : store);
}

/** An async summary (e.g. a stub's promise), "…" while pending, the error code when it rejects. */
export function useAsyncSafe<T>(load: () => Promise<T>, deps: unknown[]): T | string {
  const [v, setV] = useState<T | string>('…');
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(load)
      .then((x) => live && setV(x), (e: unknown) => live && setV(toPlatformError(e).code));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

/** First titles and a count, for list summaries. */
export function summary<T>(list: readonly T[] | string, title: (t: T) => string): unknown {
  if (typeof list === 'string') return list;
  return { count: list.length, first: list.slice(0, 3).map(title) };
}

function Data({ data }: { data: unknown }) {
  return (
    <pre className="placeholder__data" data-testid="placeholder-data">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

/** A route screen placeholder: the shared top bar, the root test id, the data. */
export function PlaceholderScreen({ testid, title, subtitle, data, actions, children }: { testid: string; title: string; subtitle?: ReactNode; data: unknown; actions?: ReactNode; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <ScreenHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="placeholder" data-testid={testid}>
        {children}
        <EmptyState icon={Hammer} title={title}>
          {t('errors.NOT_IMPLEMENTED')}
        </EmptyState>
        <Data data={data} />
      </div>
    </>
  );
}

/** A class tab or settings section placeholder (inside a screen that already has its h1). */
export function PlaceholderPanel({ testid, ready, title, data, children }: { testid: string; ready?: string; title: string; data: unknown; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="placeholder placeholder--panel" data-testid={testid} aria-label={title}>
      <h2 className="placeholder__title">{title}</h2>
      <div data-testid={ready}>
        {children}
        <EmptyState icon={Hammer} title={title}>
          {t('errors.NOT_IMPLEMENTED')}
        </EmptyState>
      </div>
      <Data data={data} />
    </section>
  );
}

/** A dialog placeholder: a real Dialog with its UX root id. */
export function PlaceholderDialog({ testid, title, data, close, size = 'md' }: { testid: string; title: string; data: unknown; close(): void; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={close}
      title={title}
      size={size}
      data-testid={testid}
      footer={
        <Button variant="primary" onClick={close} data-testid={`${testid}-close`}>
          {t('common.close')}
        </Button>
      }
    >
      <p className="t-muted">{t('errors.NOT_IMPLEMENTED')}</p>
      <Data data={data} />
    </Dialog>
  );
}
