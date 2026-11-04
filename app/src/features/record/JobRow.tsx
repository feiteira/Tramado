// The job row of the dock (UX §2.7 `JobDock`): the transcription running on this computer ([Stop and let someone
// else do it] — no pause, a paused job stops heartbeating), else a speech-model download ([Pause] keeps the
// .part), else an audio import converting in Rust. "+{n} more" when more run. A finished transcription leaves
// the dock and a toast offers to open it.
import React, { useEffect, useRef } from 'react';
import { Download, FileHeadphone } from 'lucide-react';
import type { ModelId } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { ProgressBar } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { ProgressRing } from '../lectures/TranscriptionCard';
import { mb, timeLeft } from '../lectures/format';
import './record.css';

export default function JobRow({ services }: { services: AppServices }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const { go } = useRouter();
  const queue = useStore(services.transcription.state);
  const downloads = useStore(services.models.downloads);
  const imports = useStore(services.recording.imports);
  const job = queue.job;

  // "The transcript of “Aula 7” is ready." [Open] once a local job finishes.
  const last = useRef<typeof job>(null);
  useEffect(() => {
    const before = last.current;
    last.current = job;
    if (before && (!job || job.jobId !== before.jobId)) {
      const view = services.forClass(before.classId).lectures.list.get().find((l) => l.id === before.lectureId);
      if (view?.transcription.kind === 'done' || before.resultReady) {
        toast.show({
          message: t('lectures.transcription.ready', { lecture: before.title }), tone: 'success',
          action: { label: t('common.open'), run: () => go({ name: 'lecture', classId: before.classId, lectureId: before.lectureId }), testId: 'toast-action' },
        });
      }
    }
  }, [job, services, t, toast, go]);

  const models = useStore(services.models.models);
  const dl = (Object.entries(downloads) as Array<[ModelId, { done: number; total: number; bytesPerSec: number } | undefined]>).filter(([, v]) => !!v) as Array<[ModelId, { done: number; total: number; bytesPerSec: number }]>;
  // A download re-attached after a reload reports its first progress only later: show what the model state knows.
  for (const m of models) if (m.state === 'downloading' && !dl.some(([id]) => id === m.id)) dl.push([m.id, { done: m.bytes, total: m.size, bytesPerSec: 0 }]);
  const count = (job ? 1 : 0) + dl.length + imports.length;
  if (count === 0) return null;
  const more = count - 1;
  const moreText = more > 0 ? <span className="dock-row__more">{tp('app.dock.moreJobs', more, { n: more })}</span> : null;

  if (job) {
    const percent = Math.round(job.progress * 100);
    const left = timeLeft(job.etaMs === null ? null : job.etaMs / 60_000, i18n);
    const text = t('lectures.transcription.dockLocal', { lecture: job.title, percent, left: left || t('lectures.transcription.leftUnknown') });
    return (
      <div className="dock-row dock-row--job" data-testid="job-dock" data-kind="transcription">
        <ProgressRing value={job.progress} />
        <button type="button" className="dock-row__text dock-row__link" onClick={() => go({ name: 'lecture', classId: job.classId, lectureId: job.lectureId })}>
          {text}
        </button>
        <ProgressBar value={percent} max={100} label={text} className="dock-row__progress" />
        {moreText}
        <span className="dock-row__spacer" />
        <Button size="sm" onClick={() => void services.transcription.release(job.classId, job.lectureId).catch((e: unknown) => toast.error(e))} data-testid="job-stop">
          {t('lectures.transcription.release')}
        </Button>
      </div>
    );
  }
  if (dl.length) {
    const [id, d] = dl[0]!;
    const secs = d.bytesPerSec > 0 ? (d.total - d.done) / d.bytesPerSec : null;
    const text = t('speech.dock', { done: `${mb(d.done)}`, total: `${mb(d.total)} MB`, left: secs === null ? '' : timeLeft(secs / 60, i18n, 'speech') });
    return (
      <div className="dock-row dock-row--job" data-testid="job-dock" data-kind="model">
        <Download size={16} aria-hidden className="dock-row__icon" />
        <span className="dock-row__text">{text.replace(/ · $/, '')}</span>
        <ProgressBar value={d.done} max={d.total || 1} label={text} className="dock-row__progress" />
        {moreText}
        <span className="dock-row__spacer" />
        <Button size="sm" onClick={() => void services.models.cancel(id).catch((e: unknown) => toast.error(e))} data-testid="job-pause">
          {t('speech.actions.pause')}
        </Button>
      </div>
    );
  }
  const imp = imports[0]!;
  const percent = Math.round(imp.progress * 100);
  const text = t('lectures.transcription.dockConverting', { file: imp.name, percent });
  return (
    <div className="dock-row dock-row--job" data-testid="job-dock" data-kind="import">
      <FileHeadphone size={16} aria-hidden className="dock-row__icon" />
      <span className="dock-row__text">{text}</span>
      <ProgressBar value={percent} max={100} label={text} className="dock-row__progress" />
      {moreText}
    </div>
  );
}
