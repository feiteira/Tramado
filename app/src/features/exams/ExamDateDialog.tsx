// Add (or edit) an exam date (UX §3.9.3, `[exam-date-dialog]`, Dialog size sm): kind, title (the kind's name unless
// edited), date and optional time (no time = all day), room, what it covers (≤ 500), weight (≤ 20, "40 %" also sets the
// numeric weight). "Tramado counts down on Today and in the class header." In a shared class: "Everyone in {class}
// sees this date." Only the computer that added a date can edit it in 0.1.
import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { ExamFile } from '../../core/model/files';
import type { AppServices } from '../../services/types/common';
import type { ExamKind } from '../../services/types/viewModels';
import type { DialogPropsMap } from '../registry';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { Select, TextArea, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { KINDS, examWhen } from './format';
import './exams.css';

/** "40 %" / "40%" / "40" → 40 (a plain percentage), else null. */
export function parseWeight(text: string): number | null {
  const m = /^\s*(\d{1,3}(?:[.,]\d+)?)\s*%?\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return n >= 0 && n <= 100 ? n : null;
}

export default function ExamDateDialog({ props, services, close }: { props: DialogPropsMap['exam-date']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const exams = services.forClass(props.classId).exams;
  const list = useStore(exams.list);
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === props.classId);
  const editing = props.examId ? list.dates.find((d) => d.examId === props.examId) ?? null : null;
  const start = useMemo(() => {
    const at = editing ? DateTime.fromISO(editing.at) : null;
    return {
      kind: (editing?.kind ?? 'midterm') as ExamKind,
      title: editing?.title ?? '',
      date: at?.toISODate() ?? '',
      time: at && !editing?.allDay ? at.toFormat('HH:mm') : '',
      room: editing?.room ?? '',
      covers: editing?.covers ?? '',
      weight: editing?.weight ?? '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.examId]);
  const [kind, setKind] = useState<ExamKind>(start.kind);
  const [title, setTitle] = useState(start.title);
  const [titleEdited, setTitleEdited] = useState(!!editing && editing.title !== t(`exams.kinds.${editing.kind}`));
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [room, setRoom] = useState(start.room);
  const [covers, setCovers] = useState(start.covers);
  const [weight, setWeight] = useState(start.weight);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const shownTitle = titleEdited ? title : t(`exams.kinds.${kind}`);
  const by = props.examId ? exams.importer(props.examId) : null;
  const readOnly = !!props.examId && (!by || by.deviceId !== services.ctx.device.get()?.deviceId);

  const save = async () => {
    setTried(true);
    if (!date || readOnly) return;
    const at = DateTime.fromISO(`${date}T${time || '00:00'}`);
    if (!at.isValid) return;
    const iso = at.toISO({ suppressMilliseconds: true, includeOffset: true })!;
    const w = weight.trim().slice(0, 20);
    const fields: Pick<ExamFile, 'title' | 'type' | 'date' | 'allDay' | 'room' | 'weight' | 'weightText' | 'coversText'> = {
      title: (shownTitle.trim() || t(`exams.kinds.${kind}`)).slice(0, 200), type: kind, date: iso, allDay: !time,
      room: room.trim().slice(0, 80) || null, weight: w ? parseWeight(w) : null, weightText: w || null, coversText: covers.trim().slice(0, 500) || null,
    };
    setBusy(true);
    setError(null);
    try {
      if (props.examId) {
        await exams.updateUpcoming(props.examId, fields);
        toast.show(t('exams.date.savedEdit', { title: fields.title }));
      } else {
        await exams.createUpcoming({ ...fields, durationMin: null, covers: [] });
        toast.show(t('exams.date.saved', { title: fields.title, date: examWhen(i18n, iso, !time) }));
      }
      close();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={props.examId ? t('exams.date.titleEdit') : t('exams.date.titleNew')}
      size="sm"
      onSubmit={() => void save()}
      data-testid="exam-date-dialog"
      footer={
        <>
          <Button onClick={close} data-testid="exam-date-cancel">{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={readOnly} data-testid="exam-date-save">{props.examId ? t('common.save') : t('exams.date.add')}</Button>
        </>
      }
    >
      <div className="exam-form">
        {readOnly && by ? <Notice tone="info">{t('exams.date.onlyImporter', { name: by.memberName || by.deviceName })}</Notice> : null}
        <Select
          label={t('exams.date.kind')}
          value={kind}
          onChange={(v) => setKind(v as ExamKind)}
          options={KINDS.map((k) => ({ value: k, label: t(`exams.kinds.${k}`) }))}
          disabled={readOnly}
          data-testid="exam-date-kind"
        />
        <TextField
          label={t('exams.date.titleLabel')}
          value={shownTitle}
          onChange={(v) => {
            setTitleEdited(true);
            setTitle(v);
          }}
          maxLength={200}
          disabled={readOnly}
          data-testid="exam-date-title"
        />
        <div className="exam-form__row">
          <TextField
            label={t('exams.date.date')}
            type="date"
            value={date}
            onChange={setDate}
            required
            error={tried && !date ? t('exams.date.dateRequired') : undefined}
            disabled={readOnly}
            data-autofocus
            data-testid="exam-date-date"
          />
          <TextField label={t('exams.date.time')} optional={t('common.optional')} type="time" value={time} onChange={setTime} hint={t('exams.date.timeHint')} disabled={readOnly} data-testid="exam-date-time" />
        </div>
        <div className="exam-form__row">
          <TextField label={t('exams.date.room')} optional={t('common.optional')} value={room} onChange={setRoom} maxLength={80} disabled={readOnly} data-testid="exam-date-room" />
          <TextField label={t('exams.date.weight')} optional={t('common.optional')} value={weight} onChange={setWeight} maxLength={20} placeholder={t('exams.date.weightPlaceholder')} disabled={readOnly} data-testid="exam-date-weight" />
        </div>
        <TextArea label={t('exams.date.covers')} optional={t('common.optional')} value={covers} onChange={setCovers} maxLength={500} rows={2} autoGrow minHeight={60} maxHeight={160} disabled={readOnly} data-testid="exam-date-covers" />
        <p className="exam-form__note">
          {t('exams.date.note')}
          {cls?.shared ? ` ${t('exams.date.shared', { class: cls.name })}` : ''}
        </p>
        {error ? <Notice tone="danger" data-testid="exam-date-error">{error}</Notice> : null}
      </div>
    </Dialog>
  );
}
