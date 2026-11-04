// Save lecture (UX §3.6.4): the title ("Lecture {n} — Tue 3 Nov"), who transcribes it (the default makes sure
// someone always does, sync spec §14.3), what is shared (the choice made at Start, changeable), and
// [Discard recording…]. Saving publishes in the background: the dock shows "Saving the recording…", then the
// toast "Saved “{title}”." [Open].
import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { ModelState } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useAppState } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { Select, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { defaultLectureTitle, duration, size } from '../lectures/format';
import { hasLocalModel } from '../lectures/actions';
import { readRecordPrefs, shareKey, shareMode, type ShareChoice } from './prefs';
import { session } from './session';
import './record.css';

type Choice = 'local' | 'classmate' | 'cloud' | 'none';
const TRANSCRIBE: Record<Choice, 'here' | 'classmate' | 'cloud' | 'later'> = { local: 'here', classmate: 'classmate', cloud: 'cloud', none: 'later' };
const DEFAULT_SPEED_RT = 2.5;

export default function SaveDialog({ props, services, close }: { props: DialogPropsMap['save']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const confirm = useConfirm();
  const dialogs = useDialogs();
  const { go } = useRouter();
  const app = useAppState();
  const rec = props.recording;
  const cls = services.forClass(rec.classId);
  const view = useStore(services.library.classes).find((c) => c.id === rec.classId);
  const lectures = useStore(cls.lectures.list);
  const queue = useStore(services.transcription.state);
  const info = useStore(services.models.info);
  const models = useStore(services.models.models);
  const model = useStore(cls.info.model);
  const shared = !!view?.shared;
  const startedAt = DateTime.fromISO(rec.startedAt);
  const [title, setTitle] = useState(() => (rec.title?.trim() ? rec.title : defaultLectureTitle(lectures.length + 1, startedAt, i18n)));
  const [share, setShare] = useState<ShareChoice>(() => (shared ? shareKey(readRecordPrefs(app.prefsStore, rec.classId)?.share ?? 'audio+transcript') : 'both'));
  const [busy, setBusy] = useState(false);

  const cpuOk = info ? info.cpuOk && info.localWhisper : true;
  const ready = models.find((m) => m.state === 'ready') ?? null;
  const active = models.find((m) => m.id === (app.prefsStore?.get('speech.model') || 'turbo')) ?? models[0] ?? null;
  const classmateReady = useMemo(() => {
    if (!shared) return false;
    for (const [deviceId, m] of model.members) {
      if (deviceId === model.me.deviceId || !m.check) continue;
      const caps = m.file.caps;
      if (caps && caps.volunteer !== 'off' && !!caps.localModel) return true;
    }
    return false;
  }, [model, shared]);
  const defaultChoice: Choice = classmateReady ? 'classmate' : cpuOk ? 'local' : queue.cloud.on ? 'cloud' : 'none';
  const [choice, setChoice] = useState<Choice>(defaultChoice);

  const speed = ready?.speedRT ?? active?.speedRT ?? DEFAULT_SPEED_RT;
  const eta = duration(rec.durationMs / Math.max(0.5, speed), i18n);
  const localHint = hasLocalModel(services) || !active ? t('record.save.localHint', { time: eta }) : t('record.save.localHintModel', { time: eta, size: size((active as ModelState).size, i18n) });

  const save = async () => {
    const name = title.trim() || defaultLectureTitle(lectures.length + 1, startedAt, i18n);
    const mode = shared ? shareMode(share) : 'audio+transcript';
    setBusy(true);
    session.saving.set({ recordingId: rec.recordingId, classId: rec.classId, title: name });
    close();
    try {
      const id = await services.recording.publish(rec, { title: name, share: mode, transcribe: TRANSCRIBE[choice] });
      if (mode === 'none') toast.show({ message: t('record.save.keptHere', { title: name }), tone: 'success' });
      else {
        toast.show({ message: t('record.save.saved', { title: name }), tone: 'success', action: { label: t('common.open'), run: () => go({ name: 'lecture', classId: rec.classId, lectureId: id }), testId: 'toast-action' } });
        if (choice === 'local' && !hasLocalModel(services) && cpuOk) dialogs.open('model', { classId: rec.classId, lectureId: id });
      }
    } catch (e) {
      toast.error(e);
    } finally {
      session.saving.set(null);
      setBusy(false);
    }
  };

  const discard = async () => {
    const ok = await confirm({ title: t('record.save.discardConfirm.title'), body: t('record.save.discardConfirm.body'), confirmLabel: t('record.save.discardConfirm.confirm'), danger: true });
    if (!ok) return;
    try {
      await services.recording.discard(rec.recordingId);
      close();
    } catch (e) {
      toast.error(e);
    }
  };

  const options = [
    { value: 'local' as const, label: t('record.save.local'), description: cpuOk ? localHint : t('errors.SPEECH_UNSUPPORTED_CPU'), disabled: !cpuOk },
    ...(shared ? [{ value: 'classmate' as const, label: t('record.save.classmate'), description: classmateReady ? t('record.save.classmateHint') : t('record.save.classmateNobody') }] : []),
    { value: 'cloud' as const, label: t('record.save.cloud'), description: queue.cloud.on ? t('record.save.cloudHint') : t('record.save.cloudOff'), disabled: !queue.cloud.on },
    { value: 'none' as const, label: t('record.save.none') },
  ];

  return (
    <Dialog
      open
      onClose={close}
      dismissible={!busy}
      size="md"
      title={t('record.save.title')}
      description={t('record.save.meta', { duration: duration(rec.durationMs, i18n), class: view?.name ?? '' })}
      onSubmit={() => void save()}
      data-testid="record-save"
      footer={
        <>
          <Button variant="ghost" className="record-discard" onClick={() => void discard()} data-testid="record-discard">
            {t('record.save.discard')}
          </Button>
          <span className="dialog-footer-spacer" />
          <Button type="submit" variant="primary" busy={busy} data-testid="record-save-confirm">
            {t('record.save.save')}
          </Button>
        </>
      }
    >
      <div className="record-form">
        {rec.state === 'recovered' && rec.recoveredLostMs ? <p className="record-hint">{t('record.recover.lost', { seconds: Math.round(rec.recoveredLostMs / 1000) })}</p> : null}
        <TextField label={t('record.save.name')} value={title} onChange={setTitle} maxLength={200} data-testid="record-save-title" />
        <RadioGroup label={t('record.save.transcript')} value={choice} onChange={setChoice} options={options} data-testid="record-transcribe" />
        {shared ? (
          <Select
            label={t('record.save.share')}
            value={share}
            onChange={setShare}
            options={[
              { value: 'both', label: t('record.dialog.shareBoth') },
              { value: 'transcript', label: t('record.dialog.shareTranscript') },
              { value: 'none', label: t('record.dialog.shareKeepLocal') },
            ]}
            data-testid="record-save-share"
          />
        ) : null}
        <p className="record-hint">{t('record.save.nudge')}</p>
      </div>
    </Dialog>
  );
}
