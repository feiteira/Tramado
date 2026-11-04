// Add an exam paper or practice questions (UX §3.9.4, `[exam-paper-dialog]`, Dialog size lg): a drop zone with
// [Choose a file…] (PDF, Word, text or photos; several photos are pages in the chosen order) or [Type or paste the
// questions]; Name (pre-filled from the file), Kind, Year; the CostLine ("Reading this uses about 3 AI requests (2 pages
// to read + 1 to find the questions)…"). With AI off the line says finding the questions needs AI and the button
// becomes [Type the questions]. [Find the questions] starts the import and opens the extracting screen.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardType, FileUp, Image as ImageIcon, FileText, Sparkles, X } from 'lucide-react';
import type { ExamFile } from '../../core/model/files';
import type { Picked } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { ExamKind } from '../../services/types/viewModels';
import type { DialogPropsMap } from '../registry';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { Select, TextArea, TextField } from '../../ui/components/Field';
import { useI18n } from '../../ui/i18n';
import { cx } from '../../ui/cx';
import { CostLine, costBlocked } from '../../ui/tramado/CostLine';
import { useErrorMessage } from '../ask/AiErrorNotice';
import { useQuota } from '../ask/useQuota';
import { KINDS } from './format';
import './exams.css';

export const PAPER_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'jpg', 'jpeg', 'png', 'webp'];
const IMAGE = /\.(jpe?g|png|webp)$/i;
const extOk = (name: string) => PAPER_EXTENSIONS.includes((/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase());

/** Requests to read the chosen files (UX §3.9.4): text PDF / DOCX / text = 1; photos = pages + 1. */
export function paperCost(picks: readonly Pick<Picked, 'name'>[]): { pages: number; requests: number } {
  const pages = picks.filter((p) => IMAGE.test(p.name)).length;
  return { pages, requests: pages + 1 };
}

/** "2025/26" or "2026" (the paper's academic year, folder spec §8.12), else undefined. */
export function academicYearOf(text: string): string | undefined {
  const t = text.trim();
  return /^\d{4}(?:\/\d{2,4})?$/.test(t) ? t : undefined;
}

export default function ExamPaperDialog({ props, services, close }: { props: DialogPropsMap['exam-paper']; services: AppServices; close(): void }) {
  const { t, tp } = useI18n();
  const { go } = useRouter();
  const settings = useStore(services.ai.settings);
  const exams = services.forClass(props.classId).exams;
  const aiOn = settings.enabled && (settings.key.set || !!settings.customHost);
  useQuota(services, aiOn);
  const errorMessage = useErrorMessage(services);
  const [picks, setPicks] = useState<Picked[]>(() => (props.picked ?? []).filter((p) => !p.isDir && extOk(p.name)));
  const [typed, setTyped] = useState<string | null>(null);
  const [name, setName] = useState(() => (props.picked?.[0]?.name ?? '').replace(/\.[^.]+$/, ''));
  const [nameEdited, setNameEdited] = useState(false);
  const [kind, setKind] = useState<ExamKind>('midterm');
  const [year, setYear] = useState(String(new Date(services.ctx.clock.now()).getFullYear()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const cost = useMemo(() => paperCost(picks), [picks]);
  const named = useRef({ name, nameEdited });
  named.current = { name, nameEdited };
  const add = (got: readonly Picked[]) => {
    const ok = got.filter((p) => !p.isDir && extOk(p.name));
    if (!ok.length) return;
    setPicks((cur) => [...cur, ...ok.filter((p) => !cur.some((c) => c.token === p.token))]);
    setTyped(null);
    if (!named.current.nameEdited && !named.current.name) setName(ok[0]!.name.replace(/\.[^.]+$/, ''));
  };
  // Files dropped on the window while this dialog is open are for it (desktop drag and drop arrives as tokens, D-4).
  useEffect(() => services.ctx.platform.events.onDrop((e) => {
    if (!busy && aiOn) add(e.picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [services, busy, aiOn]);
  const model = services.ai.label(settings.chain[0] ?? settings.model);
  const typing = typed !== null;
  const blocked = !typing && aiOn && costBlocked(settings.quota, model);

  const meta = (): Partial<ExamFile> => {
    const y = academicYearOf(year);
    // Typed questions have no file name to fall back on: "Midterm 2026" in the UI language.
    const fallback = typed !== null || !aiOn ? `${t(`exams.kinds.${kind}`)}${y ? ` ${y}` : ''}` : '';
    const title = name.trim() || fallback;
    return { ...(title ? { title: title.slice(0, 200) } : {}), type: kind, ...(y ? { academicYear: y } : {}) };
  };

  const choose = async () => {
    try {
      add(await services.ctx.platform.dialogs.pickFiles({ title: t('exams.paper.title'), filters: [{ name: t('exams.paper.filter'), extensions: PAPER_EXTENSIONS }], multiple: true }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (typing || !aiOn) {
        const id = await exams.startTyped(typed ?? '', meta());
        close();
        go({ name: 'exam', classId: props.classId, examId: id, mode: 'review' });
        return;
      }
      if (!picks.length) return;
      const id = await exams.startImport(picks, meta());
      close();
      go({ name: 'exam', classId: props.classId, examId: id, mode: 'extracting' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const canStart = typing ? !!typed?.trim() : aiOn ? picks.length > 0 && !blocked : true;
  const primary = typing ? t('exams.paper.check') : aiOn ? t('exams.paper.find') : t('exams.paper.typeInstead');

  return (
    <Dialog
      open
      onClose={close}
      title={t('exams.paper.title')}
      size="lg"
      dismissible={!busy}
      onSubmit={() => canStart && void (aiOn || typing ? start() : setTyped(''))}
      data-testid="exam-paper-dialog"
      footer={
        <>
          <Button onClick={close} disabled={busy} data-testid="exam-paper-cancel">{t('common.cancel')}</Button>
          {!aiOn && !typing ? (
            <Button variant="primary" icon={ClipboardType} onClick={() => setTyped('')} data-testid="exam-paper-start">{primary}</Button>
          ) : (
            <Button type="submit" variant="primary" icon={typing ? undefined : Sparkles} busy={busy} disabled={!canStart} data-testid="exam-paper-start">{primary}</Button>
          )}
        </>
      }
    >
      <div className="exam-form">
        {typing ? (
          <TextArea
            label={t('exams.paper.type')}
            hint={t('exams.paper.typedHint')}
            value={typed}
            onChange={setTyped}
            reading
            rows={10}
            autoGrow
            minHeight={200}
            maxHeight={420}
            fieldClassName="exam-typed"
            data-autofocus
            data-testid="exam-paper-text"
          />
        ) : !aiOn ? null : (
          // Without AI a file can't be read (UX §3.9.4): the notice below and [Type the questions] are the way.
          <div
            className={cx('exam-drop', 'paper-grid', over && 'exam-drop--over')}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
            }}
            data-testid="exam-paper-drop"
          >
            <FileUp size={28} strokeWidth={1.5} aria-hidden className="exam-drop__icon" />
            <p className="exam-drop__line">{t('exams.paper.drop')}</p>
            <div className="exam-drop__actions">
              <Button variant="primary" icon={FileUp} onClick={() => void choose()} data-testid="exam-paper-file">{t('exams.paper.choose')}</Button>
              <span className="t-muted">{t('exams.paper.or')}</span>
              <Button icon={ClipboardType} onClick={() => setTyped('')} data-testid="exam-paper-type">{t('exams.paper.type')}</Button>
            </div>
          </div>
        )}
        {picks.length && !typing ? (
          <ul className="exam-files" aria-label={t('exams.paper.files')} data-testid="exam-paper-files">
            {picks.map((p, i) => (
              <li key={p.token} className="exam-files__item">
                {IMAGE.test(p.name) ? <ImageIcon size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
                <span className="exam-files__name">{IMAGE.test(p.name) && picks.length > 1 ? `${i + 1}. ` : ''}{p.name}</span>
                <IconButton icon={X} label={t('common.remove')} size="sm" onClick={() => setPicks((cur) => cur.filter((x) => x.token !== p.token))} data-testid="exam-paper-file-remove" />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="exam-form__row exam-form__row--wide">
          <TextField
            label={t('exams.paper.name')}
            value={name}
            onChange={(v) => {
              setNameEdited(true);
              setName(v);
            }}
            maxLength={200}
            placeholder={t('exams.paper.namePlaceholder')}
            data-testid="exam-paper-name"
          />
          <Select label={t('exams.paper.kind')} value={kind} onChange={(v) => setKind(v as ExamKind)} options={KINDS.map((k) => ({ value: k, label: t(`exams.kinds.${k}`) }))} data-testid="exam-paper-kind" />
          <TextField label={t('exams.paper.year')} value={year} onChange={setYear} inputMode="numeric" maxLength={9} data-testid="exam-paper-year" />
        </div>
        {typing ? null : !aiOn ? (
          <Notice tone="info" data-testid="exam-paper-noai">{t('exams.paper.noAi')}</Notice>
        ) : picks.length ? (
          blocked ? (
            <CostLine requests={cost.requests} quota={settings.quota} model={model} data-testid="exam-paper-cost" />
          ) : (
            <p className="costline" data-testid="exam-paper-cost" data-requests={cost.requests}>
              <Sparkles size={13} strokeWidth={2} aria-hidden className="costline__icon" />
              <span>
                {cost.pages
                  ? t('exams.paper.cost', { n: cost.requests, pages: cost.pages, left: settings.quota?.remaining ?? '—' })
                  : t('exams.paper.costText', { left: settings.quota?.remaining ?? '—' })}
                {` · ${model.label}`}
              </span>
            </p>
          )
        ) : (
          <p className="exam-form__note">{t('exams.paper.accepted')}</p>
        )}
        {error ? <Notice tone="danger" data-testid="exam-paper-error">{error}</Notice> : null}
      </div>
    </Dialog>
  );
}
