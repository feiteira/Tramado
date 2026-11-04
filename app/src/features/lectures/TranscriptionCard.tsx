// The transcription status (UX §3.5.5, D41): the full card that takes the transcript's place while there is none,
// the compact chip of a lecture row, and the one-line status of the player bar once done. One state table,
// three sizes. Claim staleness is judged on the local clock (the view model's `health`).
import React from 'react';
import { AudioWaveform, CircleCheck, Download, Info, RefreshCw, TriangleAlert, Users, type LucideIcon } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { LectureView, TranscriptionState } from '../../services/types/viewModels';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { ProgressBar } from '../../ui/components/Feedback';
import { MenuButton } from '../../ui/components/Menu';
import { useI18n, type I18n } from '../../ui/i18n';
import { renderMarks, stripMarks } from '../../ui/marks';
import { cx } from '../../ui/cx';
import { Ellipsis as MoreHorizontal } from 'lucide-react';
import { dayMonth, firstName, mb, timeLeft } from './format';
import { pendingAfterModel, thanked, type LectureActions } from './actions';
import { DateTime } from 'luxon';
import './lectures.css';

type Tone = 'neutral' | 'progress' | 'quiet' | 'warning' | 'done' | 'info';

export interface CardModel {
  icon: LucideIcon | null;
  tone: Tone;
  text: string;
  progress: number | null;      // 0..1, a ProgressBar
  chip: string;
}

/** The text and look of a state (shared by card, chip and status line). */
export function cardModel(view: LectureView, i18n: Pick<I18n, 't' | 'tp' | 'locale'>, opts: { shared: boolean; download?: { done: number; total: number } | null }): CardModel {
  const { t } = i18n;
  const s: TranscriptionState = view.transcription;
  const left = (eta: number | null) => timeLeft(eta, i18n as never);
  switch (s.kind) {
    case 'waitingAudio': {
      const percent = s.size > 0 ? Math.floor((s.have / s.size) * 100) : 0;
      return { icon: RefreshCw, tone: 'info', text: t('lectures.transcription.waitingAudio', { percent }), progress: null, chip: t('lectures.transcription.chip.waitingAudio') };
    }
    case 'none':
      if (opts.download) {
        return {
          icon: Download, tone: 'progress', progress: opts.download.total ? opts.download.done / opts.download.total : null,
          text: t('lectures.transcription.localModel', { done: `${mb(opts.download.done)} MB`, total: `${mb(opts.download.total)} MB` }), chip: t('lectures.transcription.chip.local', { percent: 0 }),
        };
      }
      return opts.shared
        ? { icon: Users, tone: 'neutral', text: t('lectures.transcription.none'), progress: null, chip: t('lectures.transcription.chip.none') }
        : { icon: AudioWaveform, tone: 'neutral', text: t('lectures.transcription.noneLocal'), progress: null, chip: t('lectures.transcription.chip.none') };
    case 'claimed': {
      const device = s.by.deviceName;
      if (s.health === 'stale') return { icon: TriangleAlert, tone: 'warning', text: t('lectures.transcription.stale', { device, percent: s.percent, n: s.quietMin }), progress: null, chip: t('lectures.transcription.chip.stale') };
      if (s.health === 'slow') return { icon: null, tone: 'quiet', text: t('lectures.transcription.slow', { device, percent: s.percent, n: s.quietMin }), progress: s.percent / 100, chip: `${device} ${t('lectures.transcription.chip.claimed', { percent: s.percent })}` };
      return { icon: null, tone: 'progress', text: t('lectures.transcription.claimed', { device, percent: s.percent, left: left(s.etaMin) || t('lectures.transcription.leftUnknown') }), progress: s.percent / 100, chip: `${device} ${t('lectures.transcription.chip.claimed', { percent: s.percent })}` };
    }
    case 'arriving': {
      const holders = s.holders.filter((h) => !h.self).map((h) => t('lectures.transcription.arrivingHolder', { name: h.memberName })).join(' ');
      return { icon: RefreshCw, tone: 'info', text: `${t('lectures.transcription.arriving', { device: s.by.deviceName })}${holders ? ` ${holders}` : ''}`, progress: null, chip: t('lectures.transcription.chip.waitingAudio') };
    }
    case 'local':
      if (s.phase === 'model') return { icon: Download, tone: 'progress', text: t('lectures.transcription.localModel', { done: '…', total: '…' }), progress: null, chip: t('lectures.transcription.chip.local', { percent: s.percent }) };
      return { icon: null, tone: 'progress', text: t('lectures.transcription.local', { percent: s.percent, left: left(s.etaMin) || t('lectures.transcription.leftUnknown') }), progress: s.percent / 100, chip: t('lectures.transcription.chip.local', { percent: s.percent }) };
    case 'done': {
      const date = dayMonth(DateTime.fromISO(s.at), i18n.locale);
      const model = s.model;
      return {
        icon: CircleCheck, tone: 'done', progress: null, chip: t('lectures.transcription.chip.done'),
        text: s.by.self ? t('lectures.transcription.doneSelf', { model, date }) : t('lectures.transcription.done', { device: s.by.deviceName, model, date }),
      };
    }
    case 'failed':
      return { icon: TriangleAlert, tone: 'warning', text: t('lectures.transcription.failed', { device: s.by.deviceName, reason: errorReason(s.code, t) }), progress: null, chip: t('lectures.transcription.chip.failed') };
    case 'unavailable':
      return {
        icon: Info, tone: 'info', progress: null, chip: t('lectures.transcription.chip.unavailable'),
        text: s.reason === 'audioDeleted' ? t('lectures.transcription.unavailableDeleted') : t('lectures.transcription.unavailableTranscriptOnly', { name: view.recordedBy.memberName }),
      };
  }
}

function errorReason(code: string, t: I18n['t']): string {
  const key = `errors.${code}` as Parameters<I18n['t']>[0];
  const text = t(key);
  return text === key ? code : text.replace(/[.。]\s*$/, '').replace(/^./, (c) => c.toLocaleLowerCase());
}

/** Download progress of the lecture whose "Download and transcribe" started a model download. */
export function useModelDownload(services: AppServices, classId: ClassId, lectureId: string): { done: number; total: number } | null {
  const pending = useStore(pendingAfterModel);
  const downloads = useStore(services.models.downloads);
  if (!pending || pending.classId !== classId || pending.lectureId !== lectureId) return null;
  const d = Object.values(downloads).find(Boolean);
  return d ? { done: d.done, total: d.total } : null;
}

export interface TranscriptionCardProps {
  view: LectureView;
  services: AppServices;
  classId: ClassId;
  shared: boolean;
  actions: LectureActions;
  className?: string;
}

/** The full card (UX §3.5.5) with its actions. */
export function TranscriptionCard({ view, services, classId, shared, actions, className }: TranscriptionCardProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const queue = useStore(services.transcription.state);
  const thankedSet = useStore(thanked);
  const download = useModelDownload(services, classId, view.id);
  const m = cardModel(view, i18n, { shared, download });
  const s = view.transcription;
  const k = `${classId}/${view.id}`;
  const notifyOn = queue.notify.includes(k);
  const cloudOn = queue.cloud.on;
  const busy = (what: string) => actions.busy === `${what}:${view.id}`;
  const Icon = m.icon;

  let buttons: React.ReactNode = null;
  if (s.kind === 'none' && download) {
    const id = Object.entries(services.models.downloads.get()).find(([, v]) => !!v)?.[0];
    buttons = id ? <Button size="sm" onClick={() => void services.models.cancel(id as never).catch(() => undefined)} data-testid="job-pause">{t('lectures.transcription.pause')}</Button> : null;
  } else if (s.kind === 'none' || (s.kind === 'unavailable' && s.reason === 'notShared')) {
    buttons = (
      <>
        <Button size="sm" variant="primary" busy={busy('here')} onClick={() => void actions.transcribeHere(view.id)} data-testid="transcribe-here">
          {t('lectures.transcription.here')}
        </Button>
        {cloudOn ? (
          <Button size="sm" busy={busy('cloud')} onClick={() => void actions.transcribeCloud(view.id)} data-testid="transcribe-cloud">
            {t('lectures.transcription.cloud')}
          </Button>
        ) : null}
      </>
    );
  } else if (s.kind === 'claimed' && s.health === 'healthy') {
    buttons = (
      <Button size="sm" variant={notifyOn ? 'secondary' : 'ghost'} aria-pressed={notifyOn} onClick={() => actions.toggleNotify(view.id, !notifyOn)} data-testid="transcribe-notify">
        {notifyOn ? t('lectures.transcription.notifyOn') : t('lectures.transcription.notify')}
      </Button>
    );
  } else if (s.kind === 'claimed' && s.health === 'stale') {
    buttons = (
      <Button size="sm" variant="primary" busy={busy('takeover')} onClick={() => void actions.takeOver(view.id)} data-testid="transcribe-takeover">
        {t('lectures.transcription.takeover')}
      </Button>
    );
  } else if (s.kind === 'local') {
    buttons = (
      <Button size="sm" busy={busy('release')} onClick={() => void actions.release(view.id)} data-testid="transcribe-release">
        {t('lectures.transcription.release')}
      </Button>
    );
  } else if (s.kind === 'done') {
    const isThanked = thankedSet.has(k);
    buttons = (
      <>
        {!s.by.self && shared ? (
          <Button size="sm" variant="ghost" disabled={isThanked} busy={busy('thank')} onClick={() => void actions.thank(view)} data-testid="transcribe-thank">
            {isThanked ? t('lectures.transcription.thanked') : `👏 ${t('lectures.transcription.thank', { name: firstName(s.by.memberName) })}`}
          </Button>
        ) : null}
        <MenuButton
          size="sm"
          variant="ghost"
          iconOnly
          icon={MoreHorizontal}
          label={t('common.more')}
          align="end"
          items={[{ id: 'retranscribe', label: t('lectures.list.menu.retranscribe'), onSelect: () => void actions.retranscribe(view), testId: 'transcribe-retranscribe' }]}
        />
      </>
    );
  } else if (s.kind === 'failed') {
    buttons = (
      <Button size="sm" busy={busy('here')} onClick={() => void actions.transcribeHere(view.id)} data-testid="transcribe-here">
        {t('lectures.transcription.tryHere')}
      </Button>
    );
  }

  return (
    <section className={cx('tr-card', `tr-card--${m.tone}`, className)} data-testid="transcription-card" data-state={s.kind} data-health={s.kind === 'claimed' ? s.health : undefined} aria-live="polite">
      <div className="tr-card__icon" aria-hidden>
        {Icon ? <Icon size={20} strokeWidth={1.75} /> : <ProgressRing value={m.progress ?? 0} quiet={m.tone === 'quiet'} size={20} />}
      </div>
      <div className="tr-card__body">
        <p className="tr-card__text">{renderMarks(m.text)}</p>
        {m.progress !== null || m.tone === 'progress' ? (
          <ProgressBar value={m.progress} label={stripMarks(m.text)} className={cx('tr-card__progress', m.tone === 'quiet' && 'tr-card__progress--quiet')} />
        ) : null}
        {buttons ? <div className="tr-card__actions">{buttons}</div> : null}
      </div>
    </section>
  );
}

/** The compact chip of a lecture row (UX §3.4 `[lecture-transcript-chip]`). */
export function TranscriptChip({ view, shared }: { view: LectureView; shared: boolean }) {
  const i18n = useI18n();
  const m = cardModel(view, i18n, { shared });
  const s = view.transcription;
  const Icon = m.icon;
  return (
    <span className={cx('tr-chip', `tr-chip--${m.tone}`)} data-testid="lecture-transcript-chip" data-state={s.kind} title={stripMarks(m.text)}>
      {Icon ? <Icon size={14} aria-hidden strokeWidth={2} /> : <ProgressRing value={m.progress ?? 0} quiet={m.tone === 'quiet'} />}
      <span className="tr-chip__text">{m.chip}</span>
    </span>
  );
}

/** A 14 px progress ring (the ◐ of the chip). */
export function ProgressRing({ value, quiet, size = 14 }: { value: number; quiet?: boolean; size?: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className={cx('tr-ring', quiet && 'tr-ring--quiet')}>
      <circle cx={7} cy={7} r={r} fill="none" strokeWidth={2} className="tr-ring__track" />
      <circle cx={7} cy={7} r={r} fill="none" strokeWidth={2} className="tr-ring__value" strokeDasharray={`${Math.max(0, Math.min(1, value)) * c} ${c}`} transform="rotate(-90 7 7)" />
    </svg>
  );
}
