// Adding documents (UX §3.7.1 "Adding"): from the file picker, a drop, or the palette/Today action. Recordings
// picked here are offered as lectures; duplicates (same SHA-256 already in the class) ask [Open theirs] [Add anyway]
// [Skip]; a progress toast while copying and reading, then "Added {n} files to {class}." with [Undo].
import React, { useCallback, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { toPlatformError } from '../../core/errors';
import type { ClassId } from '../../core/model/ids';
import type { Picked } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import { useDialogs } from '../../shell/useDialogs';
import { useRouter } from '../../shell/router';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { DuplicateDialog, RecordingDialog } from './dialogs';
import { isRecordingName, PICK_EXTENSIONS } from './model';

type Ask =
  | { kind: 'recording'; file: string; resolve(v: 'lecture' | 'document' | 'cancel'): void }
  | { kind: 'duplicate'; text: string; resolve(v: 'open' | 'anyway' | 'skip'): void };

/** Picks waiting for the documents tab of a class (the palette/Today action opens the tab, then the tab adds them). */
let pending: { classId: ClassId; picks: Picked[] } | null = null;
const listeners = new Set<() => void>();
export function queueImport(classId: ClassId, picks: Picked[]): void {
  pending = { classId, picks };
  for (const l of [...listeners]) l();
}
/** A mounted documents tab hears about picks queued while it is open. */
export function onQueuedImport(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function takeQueuedImport(classId: ClassId): Picked[] | null {
  if (!pending || pending.classId !== classId) return null;
  const p = pending.picks;
  pending = null;
  return p;
}

export function useDocImport(classId: ClassId, services: AppServices): { pick(dest?: string): Promise<void>; add(picks: Picked[], dest?: string): Promise<void>; ui: ReactNode } {
  const { t, tp, date } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const { go } = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const running = useRef(false);
  const cls = services.forClass(classId);

  const className = () => services.library.classes.get().find((c) => c.id === classId)?.name ?? '';

  const askRecording = (file: string) => new Promise<'lecture' | 'document' | 'cancel'>((resolve) => setAsk({ kind: 'recording', file, resolve }));
  const askDuplicate = (text: string) => new Promise<'open' | 'anyway' | 'skip'>((resolve) => setAsk({ kind: 'duplicate', text, resolve }));

  const add = useCallback(async (picks: Picked[], dest?: string) => {
    if (running.current || !picks.length) return;
    running.current = true;
    try {
      const files = picks.filter((p) => !p.isDir);
      const lectures: Picked[] = [];
      const docs: Picked[] = [];
      for (const p of files) {
        if (!isRecordingName(p.name)) {
          docs.push(p);
          continue;
        }
        const a = await askRecording(p.name);
        setAsk(null);
        if (a === 'lecture') lectures.push(p);
        else if (a === 'document') docs.push(p);
      }
      if (docs.length) {
        const n = docs.length;
        const progress = toast.show({ message: tp('documents.adding.progress', n, { i: 0 }), durationMs: 120_000 });
        const results: Awaited<ReturnType<typeof cls.documents.import>> = [];
        try {
          // One file at a time, so the toast counts them ("… (2 of 5)").
          for (const [i, d] of docs.entries()) {
            results.push(...(await cls.documents.import([d], dest)));
            toast.update(progress, tp('documents.adding.progress', n, { i: i + 1 }));
          }
        } finally {
          toast.dismiss(progress);
        }
        const added = results.filter((r) => r.path).map((r) => r.path!);
        for (const r of results) {
          if (!r.error) continue;
          toast.show({ tone: 'danger', message: t('documents.adding.failed', { file: r.name, reason: t(`errors.${r.error}` as 'errors.INVALID') }) });
        }
        for (const r of results) {
          if (!r.duplicateOf || r.path) continue;
          const theirs = cls.documents.list.get().find((d) => d.path === r.duplicateOf);
          const file = r.duplicateOf.slice(r.duplicateOf.lastIndexOf('/') + 1);
          const when = theirs ? date(DateTime.fromMillis(theirs.mtimeMs), 'medium') : '';
          const text = !theirs?.addedBy || theirs.addedBy.self
            ? t('documents.adding.duplicateSelf', { file, date: when })
            : t('documents.adding.duplicate', { name: theirs.addedBy.name, file, date: when });
          const a = await askDuplicate(text);
          setAsk(null);
          if (a === 'open') go({ name: 'document', classId, relPath: r.duplicateOf });
          else if (a === 'anyway') {
            const pick = docs.find((p) => p.name === r.name);
            if (pick) {
              const again = await cls.documents.import([pick], dest, { allowDuplicate: true });
              for (const x of again) if (x.path) added.push(x.path);
            }
          }
        }
        if (added.length) {
          toast.show({
            tone: 'success',
            message: tp('documents.adding.done', added.length, { class: className() }),
            action: {
              label: t('common.undo'),
              testId: 'toast-undo',
              run: async () => {
                for (const p of added) await cls.documents.remove(p, 'everyone').catch(() => undefined);
                toast.show(t('documents.adding.undone'));
              },
            },
          });
        }
      }
      if (lectures.length) dialogs.open('import', { classId, picked: lectures });
    } catch (e) {
      toast.error(e);
    } finally {
      running.current = false;
      setAsk(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, services]);

  const pick = useCallback(async (dest?: string) => {
    try {
      const picks = await services.ctx.platform.dialogs.pickFiles({
        title: t('documents.tab.add'),
        filters: [{ name: t('documents.tab.pickFilter'), extensions: PICK_EXTENSIONS }, { name: t('documents.tab.pickAll'), extensions: ['*'] }],
        multiple: true,
      });
      await add(picks, dest);
    } catch (e) {
      if (toPlatformError(e).code !== 'CANCELLED') toast.error(e);
    }
  }, [add, services, t, toast]);

  const ui = ask?.kind === 'recording'
    ? <RecordingDialog file={ask.file} onLecture={() => ask.resolve('lecture')} onDocument={() => ask.resolve('document')} onCancel={() => ask.resolve('cancel')} />
    : ask?.kind === 'duplicate'
      ? <DuplicateDialog text={ask.text} onOpen={() => ask.resolve('open')} onAnyway={() => ask.resolve('anyway')} onSkip={() => ask.resolve('skip')} />
      : null;
  return { pick, add, ui };
}
