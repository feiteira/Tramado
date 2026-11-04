// Two versions of a class note (UX §3.8; sync spec §16.3–4): a side-by-side line diff of this computer's version
// (the note file) and the other version (a Syncthing conflict copy), with [Keep this one] [Keep the other]
// [Keep both]. "Keep both" renames the other version to "<base> (2).md" (the spec's name; UX's "(Bruno's copy)" is
// superseded, plan §15.12): the ShortId in a copy's name is not its author, so no name is shown for it.
import React, { useEffect, useMemo, useState } from 'react';
import { diffLines, sideBySide, splitLines } from '../../core/notes/lineDiff';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Spinner } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';

export function ConflictDialog({ services, classId, path, title, onClose, onResolved }: {
  services: AppServices; classId: ClassId; path: string; title: string; onClose(): void; onResolved(text: string | null): void;
}) {
  const { t, tp } = useI18n();
  const toast = useToast();
  const notes = services.forClass(classId).notes;
  const [data, setData] = useState<{ base: string; copies: Array<{ path: string; text: string }> } | null>(null);
  const [busy, setBusy] = useState<'mine' | 'theirs' | 'both' | null>(null);

  useEffect(() => {
    let live = true;
    void notes.conflicts(path).then((d) => live && setData(d), (e: unknown) => {
      toast.error(e);
      onClose();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const copy = data?.copies[0] ?? null;
  const rows = useMemo(() => (data && copy ? sideBySide(diffLines(splitLines(data.base), splitLines(copy.text))) : []), [data, copy]);

  const resolve = async (which: 'mine' | 'theirs' | 'both') => {
    if (!data || !copy) return;
    setBusy(which);
    try {
      if (which === 'both') {
        await notes.resolve(path, { keepBoth: true });
        const name = `${path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')} (2).md`;
        toast.show({ tone: 'success', message: t('notes.conflictBoth', { name }) });
        onResolved(null);
      } else {
        await notes.resolve(path, { keep: which === 'mine' ? 'base' : copy.path });
        toast.show({ tone: 'success', message: t('notes.conflictDone') });
        onResolved(which === 'mine' ? data.base : copy.text);
      }
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={t('notes.conflict.title', { title })}
      size="xl"
      data-testid="conflict-dialog"
      footer={
        <>
          <Button onClick={onClose} disabled={!!busy}>{t('common.cancel')}</Button>
          <Button onClick={() => void resolve('both')} busy={busy === 'both'} disabled={!copy || (!!busy && busy !== 'both')} data-testid="conflict-keep-both">{t('notes.conflict.keepBoth')}</Button>
          <Button onClick={() => void resolve('theirs')} busy={busy === 'theirs'} disabled={!copy || (!!busy && busy !== 'theirs')} data-testid="conflict-keep-theirs">{t('notes.conflict.keepTheirs')}</Button>
          <Button variant="primary" onClick={() => void resolve('mine')} busy={busy === 'mine'} disabled={!copy || (!!busy && busy !== 'mine')} data-testid="conflict-keep-mine">{t('notes.conflict.keepMine')}</Button>
        </>
      }
    >
      {!data ? <Spinner label={t('common.loading')} /> : (
        <div className="conflict">
          {data.copies.length > 1 ? <p className="t-small t-muted">{tp('notes.conflictOtherCopies', data.copies.length - 1)}</p> : null}
          <div className="conflict__legend t-small">
            <span><span className="conflict__key conflict__key--del" aria-hidden /> {t('notes.conflictLegend.mine')}</span>
            <span><span className="conflict__key conflict__key--add" aria-hidden /> {t('notes.conflictLegend.theirs')}</span>
          </div>
          <div className="conflict__grid" role="table" aria-label={t('notes.conflict.title', { title })} data-testid="conflict-diff">
            <div className="conflict__head" role="row">
              <span role="columnheader">{t('notes.conflict.mine')}</span>
              <span role="columnheader">{t('notes.conflict.theirsUnknown')}</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className={cx('conflict__row', `conflict__row--${r.op}`)} role="row">
                <span role="cell" className={cx('conflict__cell', r.left === null && 'conflict__cell--gap', (r.op === 'del' || r.op === 'change') && 'conflict__cell--del')}>{r.left ?? ''}</span>
                <span role="cell" className={cx('conflict__cell', r.right === null && 'conflict__cell--gap', (r.op === 'add' || r.op === 'change') && 'conflict__cell--add')}>{r.right ?? ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
