// Dialogs of the documents tab (UX §3.7.1): name a folder or rename a file, move to a folder, delete for everyone
// (with "Remove from this computer only" as the secondary), a duplicate, a recording picked as a document.
import React, { useState } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { TextField } from '../../ui/components/Field';
import { useI18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';

/** A name for a new folder, or a file's new name (Enter saves; the error stays in the dialog). */
export function NameDialog({ title, label, initial, submitLabel, onSubmit, onClose, testid }: {
  title: string; label: string; initial: string; submitLabel: string; onSubmit(name: string): Promise<void>; onClose(): void; testid: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    onSubmit(v).then(onClose, (e: unknown) => {
      setBusy(false);
      setError(t(`errors.${toPlatformError(e).code}` as 'errors.INVALID'));
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="sm"
      onSubmit={submit}
      data-testid={testid}
      footer={
        <>
          <Button onClick={onClose} data-testid={`${testid}-cancel`}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy} disabled={!name.trim()} data-testid={`${testid}-save`}>{submitLabel}</Button>
        </>
      }
    >
      <TextField
        label={label}
        value={name}
        onChange={setName}
        error={error ?? undefined}
        data-autofocus
        onFocus={(e) => {
          // Select the name without its extension, as file managers do.
          const v = e.currentTarget.value;
          const dot = v.lastIndexOf('.');
          e.currentTarget.setSelectionRange(0, dot > 0 ? dot : v.length);
        }}
        data-testid={`${testid}-input`}
      />
    </Dialog>
  );
}

/** "Move to…": the class's folders as a list (the current folder is disabled). */
export function MoveDialog({ file, folders, docsDir, current, onMove, onClose }: {
  file: string; folders: string[]; docsDir: string; current: string; onMove(dest: string): Promise<void>; onClose(): void;
}) {
  const { t } = useI18n();
  const [dest, setDest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = [docsDir, ...folders];
  const label = (p: string) => (p === docsDir ? t('documents.folders.documents') : p.slice(docsDir.length + 1).split('/').join(' › '));
  const depth = (p: string) => (p === docsDir ? 0 : p.slice(docsDir.length + 1).split('/').length);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('documents.move.title', { file })}
      size="sm"
      data-testid="doc-move-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!dest}
            onClick={() => {
              if (!dest) return;
              setBusy(true);
              onMove(dest).then(onClose, () => setBusy(false));
            }}
            data-testid="doc-move-confirm"
          >
            {t('documents.move.confirm')}
          </Button>
        </>
      }
    >
      <div className="doc-move__list" role="listbox" aria-label={t('documents.move.title', { file })}>
        {all.map((p) => {
          const disabled = p === current;
          const Icon = dest === p ? FolderOpen : Folder;
          return (
            <button
              key={p}
              type="button"
              role="option"
              aria-selected={dest === p}
              aria-disabled={disabled}
              disabled={disabled}
              className={cx('doc-move__item', dest === p && 'doc-move__item--on')}
              style={{ paddingInlineStart: `calc(var(--s-3) + ${depth(p) * 16}px)` }}
              onClick={() => setDest(p)}
              onDoubleClick={() => !disabled && onMove(p).then(onClose, () => undefined)}
              data-testid="doc-move-folder"
              data-doc-path={p}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              <span>{p === docsDir ? label(p) : p.slice(p.lastIndexOf('/') + 1)}</span>
              {disabled ? <span className="t-muted t-small">{t('documents.move.here')}</span> : null}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

/** "Delete for everyone?" with the danger primary and "Remove from this computer only" as the secondary. */
export function DeleteDialog({ file, className, shared, onDelete, onRemoveLocal, onClose }: {
  file: string; className: string; shared: boolean; onDelete(): void; onRemoveLocal(): void; onClose(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onClose}
      title={shared ? t('documents.deleteConfirm.title', { file, class: className }) : t('documents.deleteConfirm.titleLocal', { file })}
      size={shared ? 'md' : 'sm'}
      data-testid="doc-delete-dialog"
      footer={
        <>
          <Button onClick={onClose} data-autofocus data-testid="doc-delete-cancel">{t('common.cancel')}</Button>
          {shared ? <Button onClick={() => { onClose(); onRemoveLocal(); }} data-testid="doc-delete-local">{t('documents.deleteConfirm.local')}</Button> : null}
          <Button variant="danger" onClick={() => { onClose(); onDelete(); }} data-testid="doc-delete-confirm">
            {shared ? t('documents.deleteConfirm.confirm') : t('common.delete')}
          </Button>
        </>
      }
    >
      <p>{shared ? t('documents.deleteConfirm.body') : t('documents.deleteConfirm.bodyLocal')}</p>
    </Dialog>
  );
}

/** The same file is already in the class: [Open theirs] [Add anyway] [Skip]. */
export function DuplicateDialog({ text, onOpen, onAnyway, onSkip }: { text: string; onOpen(): void; onAnyway(): void; onSkip(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onSkip}
      title={t('documents.adding.duplicateTitle')}
      size="sm"
      data-testid="doc-duplicate"
      footer={
        <>
          <Button onClick={onSkip} data-autofocus data-testid="doc-duplicate-skip">{t('common.skip')}</Button>
          <Button onClick={onAnyway} data-testid="doc-duplicate-anyway">{t('documents.adding.addAnyway')}</Button>
          <Button variant="primary" onClick={onOpen} data-testid="doc-duplicate-open">{t('documents.adding.openTheirs')}</Button>
        </>
      }
    >
      <p>{text}</p>
    </Dialog>
  );
}

/** An audio or video file picked in Documents: "Add it as a lecture?" */
export function RecordingDialog({ file, onLecture, onDocument, onCancel }: { file: string; onLecture(): void; onDocument(): void; onCancel(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('documents.adding.recording.title', { file })}
      size="sm"
      data-testid="doc-recording"
      footer={
        <>
          <Button onClick={onDocument} data-testid="doc-recording-document">{t('documents.adding.recording.document')}</Button>
          <Button variant="primary" onClick={onLecture} data-autofocus data-testid="doc-recording-lecture">{t('documents.adding.recording.lecture')}</Button>
        </>
      }
    >
      <p>{t('documents.adding.recording.body')}</p>
    </Dialog>
  );
}
