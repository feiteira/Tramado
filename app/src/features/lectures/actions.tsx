// What the lectures tab, the lecture view and the transcription card can do to a lecture (UX §3.4 row menu,
// §3.5.1 [⋯], §3.5.5 card actions), with their confirmations, dialogs and toasts in one place.
import React, { useCallback, useMemo, useState } from 'react';
import type { ClassId, Ulid } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { LectureView } from '../../services/types/viewModels';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { Select, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { Store } from '../../services/store';

/** "Transcribe on this computer" asks for a model first when none is installed (UX §3.5.5 model prompt). */
export function hasLocalModel(services: AppServices): boolean {
  const info = services.models.info.get();
  const models = services.models.models.get();
  return !!info?.cpuOk && !!info.localWhisper && models.some((m) => m.state === 'ready');
}

/** The lecture a model download was started for ("Download and transcribe"): its card shows the download. */
export const pendingAfterModel = new Store<{ classId: ClassId; lectureId: Ulid } | null>(null);

type Busy = string | null;

export interface LectureActions {
  busy: Busy;
  transcribeHere(lectureId: Ulid): Promise<void>;
  transcribeCloud(lectureId: Ulid): Promise<void>;
  takeOver(lectureId: Ulid): Promise<void>;
  release(lectureId: Ulid): Promise<void>;
  retranscribe(view: LectureView): Promise<void>;
  toggleNotify(lectureId: Ulid, on: boolean): void;
  thank(view: LectureView): Promise<void>;
  rename(view: LectureView): void;
  markDuplicate(view: LectureView): void;
  deleteAudio(view: LectureView): Promise<void>;
  deleteAll(view: LectureView): Promise<boolean>;
  showInFolder(view: LectureView): Promise<void>;
  exportTranscript(view: LectureView, format: 'md' | 'vtt' | 'txt'): Promise<void>;
  /** The rename / duplicate dialogs (render once in the screen). */
  dialogs: React.ReactNode;
}

export function useLectureActions(services: AppServices, classId: ClassId): LectureActions {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const dialogs = useDialogs();
  const cls = services.forClass(classId);
  const classView = useStore(services.library.classes).find((c) => c.id === classId);
  const [busy, setBusy] = useState<Busy>(null);
  const [renaming, setRenaming] = useState<LectureView | null>(null);
  const [duplicating, setDuplicating] = useState<LectureView | null>(null);

  const run = useCallback(
    async (key: string, f: () => Promise<unknown>) => {
      setBusy(key);
      try {
        await f();
      } catch (e) {
        toast.error(e);
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const outcome = useCallback(
    (r: 'won' | 'lost' | 'ineligible') => {
      if (r === 'lost') toast.show(t('lectures.transcription.lostRound'));
      else if (r === 'ineligible') toast.show(t('lectures.transcription.ineligible'));
    },
    [t, toast],
  );

  const actions = useMemo<Omit<LectureActions, 'busy' | 'dialogs'>>(
    () => ({
      transcribeHere: (lectureId) =>
        run(`here:${lectureId}`, async () => {
          if (!hasLocalModel(services)) {
            dialogs.open('model', { classId, lectureId });
            return;
          }
          outcome(await services.transcription.claim(classId, lectureId, 'local'));
        }),
      transcribeCloud: (lectureId) =>
        run(`cloud:${lectureId}`, async () => {
          const q = services.transcription.state.get();
          if (!q.cloud.on) {
            toast.show(t('record.save.cloudOff'));
            return;
          }
          const ok = await confirm({ title: t('lectures.transcription.cloudConfirm.title'), body: t('lectures.transcription.cloudConfirm.body'), confirmLabel: t('lectures.transcription.cloudConfirm.confirm') });
          if (!ok) return;
          outcome(await services.transcription.claim(classId, lectureId, 'cloud'));
        }),
      takeOver: (lectureId) =>
        run(`takeover:${lectureId}`, async () => {
          if (!hasLocalModel(services) && !services.transcription.state.get().cloud.on) {
            dialogs.open('model', { classId, lectureId });
            return;
          }
          outcome(await services.transcription.takeOver(classId, lectureId));
        }),
      release: (lectureId) => run(`release:${lectureId}`, () => services.transcription.release(classId, lectureId)),
      retranscribe: async (view) => {
        const ok = await confirm({
          title: t('lectures.list.retranscribeConfirm.title', { title: view.title }),
          body: t('lectures.list.retranscribeConfirm.body', { class: classView?.name ?? '' }),
          confirmLabel: t('lectures.list.retranscribeConfirm.confirm'),
        });
        if (!ok) return;
        await run(`retranscribe:${view.id}`, async () => {
          if (!hasLocalModel(services) && !services.transcription.state.get().cloud.on) {
            dialogs.open('model', { classId, lectureId: view.id });
            return;
          }
          await services.transcription.retranscribe(classId, view.id);
        });
      },
      toggleNotify: (lectureId, on) => services.transcription.notifyWhenReady(classId, lectureId, on),
      thank: (view) =>
        run(`thank:${view.id}`, async () => {
          if (view.transcription.kind !== 'done') return;
          await cls.chat.thank(view.transcription.by.memberId, view.id);
          thanked.update((s) => new Set([...s, `${classId}/${view.id}`]));
        }),
      rename: (view) => setRenaming(view),
      markDuplicate: (view) => setDuplicating(view),
      deleteAudio: async (view) => {
        const ok = await confirm({
          title: t('lectures.list.deleteAudioConfirm.title', { title: view.title }),
          body: t('lectures.list.deleteAudioConfirm.body', { class: classView?.name ?? '' }),
          confirmLabel: t('lectures.list.deleteAudioConfirm.confirm'),
          danger: true,
        });
        if (ok) await run(`deleteAudio:${view.id}`, () => cls.lectures.deleteAudio(view.id));
      },
      deleteAll: async (view) => {
        const ok = await confirm({
          title: t('lectures.list.deleteConfirm.title', { title: view.title, class: classView?.name ?? '' }),
          body: t('lectures.list.deleteConfirm.body'),
          confirmLabel: t('lectures.list.deleteConfirm.confirm'),
          danger: true,
        });
        if (!ok) return false;
        let done = false;
        await run(`delete:${view.id}`, async () => {
          await cls.lectures.deleteLecture(view.id);
          done = true;
        });
        return done;
      },
      showInFolder: (view) =>
        run(`reveal:${view.id}`, async () => {
          const dir = cls.store.state.get().index.lectures.get(view.id)?.dir;
          await services.ctx.platform.classes.reveal(classId, dir || undefined);
        }),
      exportTranscript: (view, format) =>
        run(`export:${view.id}`, async () => {
          const pick = await services.ctx.platform.dialogs.save({
            title: t('lectures.view.more.export'),
            defaultName: `${view.title}.${format}`,
            filters: [{ name: format === 'md' ? 'Markdown' : format === 'vtt' ? 'WebVTT' : 'Text', extensions: [format] }],
          });
          if (!pick) return;
          await cls.lectures.exportTranscript(view.id, format, pick);
          toast.show({ message: t('lectures.view.more.exported'), tone: 'success' });
        }),
    }),
    [run, services, classId, dialogs, outcome, toast, t, confirm, classView?.name, cls],
  );

  const others = useStore(cls.lectures.list).filter((l) => l.id !== duplicating?.id);
  const node = (
    <>
      {renaming ? <RenameDialog view={renaming} onClose={() => setRenaming(null)} onSave={(title) => run(`rename:${renaming.id}`, () => cls.lectures.rename(renaming.id, title))} /> : null}
      {duplicating ? (
        <DuplicateDialog
          view={duplicating}
          options={others.map((l) => ({ value: l.id, label: l.title }))}
          onClose={() => setDuplicating(null)}
          onSave={(of) => run(`duplicate:${duplicating.id}`, () => cls.lectures.markDuplicate(duplicating.id, of))}
        />
      ) : null}
    </>
  );
  return { ...actions, busy, dialogs: node };
}

/** Lectures this session thanked for ("Thanked", UX §3.5.5), as `${classId}/${lectureId}`. */
export const thanked = new Store<ReadonlySet<string>>(new Set());

function RenameDialog({ view, onClose, onSave }: { view: LectureView; onClose(): void; onSave(title: string): Promise<void> }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(view.title);
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length > 0 && [...title.trim()].length <= 200;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    await onSave(title.trim());
    setBusy(false);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={t('lectures.list.renameTitle')}
      onSubmit={() => void submit()}
      data-testid="lecture-rename-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!valid} busy={busy} data-testid="lecture-rename-confirm">
            {t('common.rename')}
          </Button>
        </>
      }
    >
      <TextField label={t('record.save.name')} value={title} onChange={setTitle} maxLength={200} data-testid="lecture-rename-input" />
    </Dialog>
  );
}

function DuplicateDialog({ view, options, onClose, onSave }: { view: LectureView; options: Array<{ value: string; label: string }>; onClose(): void; onSave(of: string | null): Promise<void> }) {
  const { t } = useI18n();
  const [of, setOf] = useState<string>(view.duplicateOf ?? view.probableDuplicateOf ?? options[0]?.value ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await onSave(of || null);
    setBusy(false);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={t('lectures.list.duplicateTitle', { title: view.title })}
      description={t('lectures.list.duplicateHint')}
      onSubmit={() => void submit()}
      data-testid="lecture-duplicate-dialog"
      footer={
        <>
          {view.duplicateOf ? (
            <Button variant="ghost" onClick={() => void onSave(null).then(onClose)} data-testid="lecture-duplicate-clear">
              {t('lectures.list.duplicateClear')}
            </Button>
          ) : null}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!of} busy={busy} data-testid="lecture-duplicate-confirm">
            {t('lectures.transcription.markDuplicate')}
          </Button>
        </>
      }
    >
      <Select label={t('lectures.list.duplicateOfLabel')} value={of} onChange={setOf} options={options} data-testid="lecture-duplicate-select" />
    </Dialog>
  );
}
