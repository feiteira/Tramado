// Add a recording (UX §3.6.6): an audio or video file becomes a lecture (Rust converts it to audio.webm, with the
// progress in the dock: "Converting “{file}”… {percent} %"). Title, date and time, the language spoken, keeping
// the video, the permission to share it (shared classes; required) and who transcribes it.
import React, { useMemo, useState } from 'react';
import { FileHeadphone, Upload } from 'lucide-react';
import { DateTime } from 'luxon';
import { toPlatformError } from '../../core/errors';
import type { Lang } from '../../core/model/ids';
import type { Picked } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { ConsentInput } from '../../services/types/class';
import type { DialogPropsMap } from '../registry';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { Select, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { defaultLectureTitle, size } from '../lectures/format';
import { isSubtitle, isVideo, pickRecording } from './importFlow';
import { LANGUAGE_OPTIONS } from './prefs';
import './record.css';

type Choice = 'here' | 'classmate' | 'cloud' | 'later';

export default function ImportDialog({ props, services, close }: { props: DialogPropsMap['import']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t, locale, meta } = i18n;
  const toast = useToast();
  const classId = props.classId;
  const view = useStore(services.library.classes).find((c) => c.id === classId);
  const lectures = useStore(services.forClass(classId).lectures.list);
  const queue = useStore(services.transcription.state);
  const info = useStore(services.models.info);
  const shared = !!view?.shared;
  const [picked, setPicked] = useState<Picked[]>(props.picked ?? []);
  const file = picked.find((p) => !isSubtitle(p.name) && !p.isDir) ?? null;
  const subtitles = picked.find((p) => isSubtitle(p.name)) ?? null;
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const [date, setDate] = useState(now.toISODate() ?? '');
  const [time, setTime] = useState(now.toFormat('HH:mm'));
  const at = useMemo(() => DateTime.fromISO(`${date}T${time || '00:00'}`), [date, time]);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const shownTitle = titleTouched ? title : at.isValid ? defaultLectureTitle(lectures.length + 1, at, i18n) : '';
  const [language, setLanguage] = useState<string>(view?.language || 'auto');
  const [keepVideo, setKeepVideo] = useState(false);
  const [permission, setPermission] = useState(false);
  const cpuOk = info ? info.cpuOk && info.localWhisper : true;
  const [choice, setChoice] = useState<Choice>(cpuOk ? 'here' : queue.cloud.on ? 'cloud' : 'later');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = !!file && shownTitle.trim().length > 0 && at.isValid && (!shared || permission);

  const choose = async () => {
    const next = await pickRecording(services, t('lectures.list.import'), { audio: t('record.import.filterAudio'), subtitles: t('record.import.filterSubtitles') }).catch(() => [] as Picked[]);
    if (next.length) setPicked(next);
  };

  const submit = async () => {
    if (!valid || !file) return;
    setBusy(true);
    setError(null);
    const consent: ConsentInput | undefined = shared
      ? { kind: 'share', scope: 'lecture', share: 'audio+transcript', textId: 'record.import.permission.v1', textLang: meta.bcp47 as Lang, text: t('record.import.permission.v1') }
      : undefined;
    try {
      const done = services.recording.importAudio(classId, file, {
        title: shownTitle.trim(), keepVideo: keepVideo && isVideo(file.name), startedAt: at.toUTC().toISO() ?? undefined, language: language as Lang | 'auto', transcribe: choice, ...(consent ? { consent } : {}),
      });
      close();
      await done;
      toast.show({ message: t('record.save.saved', { title: shownTitle.trim() }), tone: 'success' });
    } catch (e) {
      const code = toPlatformError(e).code;
      if (code === 'SPEECH_UNSUPPORTED_AUDIO') toast.show({ message: t('record.import.unsupported'), tone: 'danger' });
      else toast.error(e);
      setError(code);
    } finally {
      setBusy(false);
    }
  };

  const [before = '', after = ''] = t('record.import.title', { class: '\u0000' }).split('\u0000');
  return (
    <Dialog
      open
      onClose={close}
      size="md"
      title={
        <span className="record-title">
          {before}
          <span className="record-title__class">
            {view ? <ClassTab color={view.color} icon={view.icon} size="sm" /> : null}
            {view?.shortName ?? ''}
          </span>
          {after}
        </span>
      }
      onSubmit={() => void submit()}
      data-testid="import-dialog"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!valid} busy={busy} data-testid="import-confirm">
            {t('record.import.confirm')}
          </Button>
        </>
      }
    >
      <div className="record-form">
        <div className="import-file">
          <span className="import-file__label">{t('record.import.file')}</span>
          {file ? (
            <span className="import-file__name" data-testid="import-file">
              <FileHeadphone size={16} aria-hidden /> {file.name}
              {file.size ? <span className="import-file__size"> · {size(file.size, i18n)}</span> : null}
            </span>
          ) : (
            <span className="import-file__name import-file__name--empty">{t('record.import.noFile')}</span>
          )}
          <Button size="sm" icon={Upload} onClick={() => void choose()} data-testid="import-choose">
            {file ? t('common.change') : t('common.chooseFile')}
          </Button>
        </div>
        {error === 'SPEECH_UNSUPPORTED_AUDIO' ? <Notice tone="danger">{t('record.import.unsupported')}</Notice> : null}
        <TextField label={t('record.import.name')} value={shownTitle} onChange={(v) => { setTitle(v); setTitleTouched(true); }} maxLength={200} data-testid="import-title" />
        <div className="record-row">
          <TextField label={t('record.import.date')} type="date" value={date} onChange={setDate} data-testid="import-date" fieldClassName="record-row__field" />
          <TextField label={t('record.import.time')} type="time" value={time} onChange={setTime} data-testid="import-time" fieldClassName="record-row__field" />
        </div>
        <Select label={t('record.import.language')} value={language} onChange={setLanguage} options={LANGUAGE_OPTIONS(locale, t('record.dialog.languageAuto'))} data-testid="import-language" />
        {file && isVideo(file.name) ? (
          <Checkbox checked={keepVideo} onChange={setKeepVideo} label={t('record.import.keepVideo', { size: file.size ? size(file.size, i18n) : '—' })} data-testid="import-keep-video" />
        ) : null}
        {subtitles ? <Notice tone="info" data-testid="import-vtt-notice">{t('record.import.vttLater', { file: subtitles.name })}</Notice> : null}
        {shared ? <Checkbox checked={permission} onChange={setPermission} label={t('record.import.permission.v1')} data-testid="import-permission" /> : null}
        <RadioGroup
          label={t('record.save.transcript')}
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'here', label: t('record.save.local'), disabled: !cpuOk },
            ...(shared ? [{ value: 'classmate' as const, label: t('record.save.classmate') }] : []),
            { value: 'cloud', label: t('record.save.cloud'), disabled: !queue.cloud.on, description: queue.cloud.on ? undefined : t('record.save.cloudOff') },
            { value: 'later', label: t('record.save.none') },
          ]}
          data-testid="import-transcribe"
        />
      </div>
    </Dialog>
  );
}
