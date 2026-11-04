// Answer settings (UX §3.9.7, `[answer-settings]`, Dialog size md): answer from the class materials only, or with general
// knowledge (marked unverified); "Try each question yourself first" (prefs `exam.tryFirst`, default on, D53); shared
// answers that already exist ([Use those]); the cost and quota ("About 7 requests (1 to find search words + 6 answers)
// · 38 free left today · Gemma 4 31B (free)"); more requests than are left → [Answer {left} now]. A batch of more than
// 3 requests always shows this dialog (UX §3.15.7).
import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { Sparkles } from 'lucide-react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { CostLine, costBlocked } from '../../ui/tramado/CostLine';
import { useResetTime } from '../../ui/tramado/QuotaMeter';
import { shortDate } from '../ask/cite';
import { useQuota } from '../ask/useQuota';
import './exam.css';

/** Requests of a Quick batch: 1 search-words expansion + 1 per question (critique C17). */
export const batchRequests = (questions: number): number => (questions > 0 ? questions + 1 : 0);

export default function AnswerSettingsDialog({ props, services, close }: { props: DialogPropsMap['answer-settings']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { route, replace } = useRouter();
  const reset = useResetTime();
  const exams = services.forClass(props.classId).exams;
  const paper = useStore(exams.open(props.examId));
  const settings = useStore(services.ai.settings);
  const prefs = useStore(services.ctx.prefs.store);
  const aiOn = settings.enabled && (settings.key.set || !!settings.customHost);
  useQuota(services, aiOn);
  const qids = useMemo(() => (props.qids.length ? props.qids : (paper?.questions ?? []).map((q) => q.id)), [props.qids, paper]);
  const [from, setFrom] = useState<'materials' | 'general'>(settings.generalDefault ? 'general' : 'materials');
  const [tryFirst, setTryFirst] = useState((prefs['exam.tryFirst'] ?? '1') !== '0');
  const [busy, setBusy] = useState(false);
  const model = services.ai.label(settings.chain[0] ?? settings.model);
  const requests = batchRequests(qids.length);
  const left = settings.quota && model.free ? settings.quota.remaining : null;
  const over = left !== null && requests > left;
  const blocked = costBlocked(settings.quota, model);
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const existing = (paper?.answers ?? []).filter((a) => !a.by.self).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const n = qids.length;

  const start = async (count: number) => {
    setBusy(true);
    try {
      await services.ctx.prefs.set('exam.tryFirst', tryFirst ? '1' : '0');
      const ids = qids.slice(0, count);
      if (ids.length) exams.answer(props.examId, ids, 'quick', from === 'general' ? 'materials+general' : 'materials');
      close();
      if (!(route.name === 'exam' && route.examId === props.examId && (route.mode ?? 'answers') === 'answers')) {
        replace({ name: 'exam', classId: props.classId, examId: props.examId, mode: 'answers' });
      }
    } finally {
      setBusy(false);
    }
  };
  const nowCount = over && left !== null ? Math.max(0, left - 1) : n;
  // "Answer {left} now" only when some can be answered now (never "Answer 0 now" on a spent quota).
  const some = over && !blocked && nowCount > 0;

  return (
    <Dialog
      open
      onClose={close}
      title={tp('exams.settings.title', n, { n })}
      size="md"
      onSubmit={() => !blocked && aiOn && n > 0 && void start(nowCount)}
      data-testid="answer-settings"
      footer={
        <>
          <Button onClick={close} data-testid="answer-cancel">{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" icon={Sparkles} busy={busy} disabled={!aiOn || blocked || n === 0 || nowCount === 0} data-testid="answer-start">
            {some ? t('exams.settings.answerSome', { n: nowCount }) : existing ? t('exams.settings.answerAgain') : tp('exams.settings.start', n, { n })}
          </Button>
        </>
      }
    >
      <div className="answer-settings">
        <RadioGroup
          label={t('exams.settings.from')}
          value={from}
          onChange={setFrom}
          options={[
            { value: 'materials', label: t('exams.settings.fromMaterials') },
            { value: 'general', label: t('exams.settings.fromGeneral') },
          ]}
          data-testid="answer-from"
        />
        <Checkbox checked={tryFirst} onChange={setTryFirst} label={t('exams.settings.tryFirst')} description={t('exams.settings.tryFirstHint')} data-testid="answer-try-first" />
        {existing ? (
          <div className="answer-settings__existing" data-testid="answer-existing">
            <span>{t('exams.settings.existing', { name: existing.by.memberName || existing.by.deviceName, model: existing.model.label, date: shortDate(i18n, existing.at, now) })}</span>
            <Button size="sm" onClick={close} data-testid="answer-use-existing">{t('exams.settings.useExisting')}</Button>
          </div>
        ) : null}
        {!aiOn ? <Notice tone="info">{t('exams.answers.aiOff')}</Notice> : null}
        {aiOn && blocked ? (
          <CostLine requests={requests} quota={settings.quota} model={model} data-testid="answer-cost" />
        ) : aiOn ? (
          <p className="costline" data-testid="answer-cost" data-requests={requests}>
            <Sparkles size={13} strokeWidth={2} aria-hidden className="costline__icon" />
            <span>{t('exams.settings.cost', { n: requests, q: n, left: left ?? '—', model: model.label })}</span>
          </p>
        ) : null}
        {aiOn && some && settings.quota ? (
          <Notice tone="warning" data-testid="answer-over">{t('exams.settings.overQuota', { left: nowCount, time: reset(settings.quota) })}</Notice>
        ) : null}
      </div>
    </Dialog>
  );
}
