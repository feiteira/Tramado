// The speech model prompt (UX §3.5.5 `[model-prompt]`): transcribing on this computer needs a model, downloaded
// once from Hugging Face. Recommended / Draft / Most accurate, with sizes and an estimate for this lecture;
// [Download and transcribe] (the download, then the transcription, in the dock), [Let a classmate do it]
// (shared classes), [Use OpenRouter instead]. A processor without AVX2 and a full disk have their own texts.
import React, { useState } from 'react';
import { toPlatformError } from '../../core/errors';
import type { ModelId, ModelState } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { pendingAfterModel } from '../lectures/actions';
import { duration, size } from '../lectures/format';
import './record.css';

/** The registry's models (architecture §2) when speech is not available to ask (sizes in bytes). */
export const MODEL_CATALOG: ReadonlyArray<Pick<ModelState, 'id' | 'size' | 'speedRT'>> = [
  { id: 'turbo', size: 574_000_000, speedRT: null },
  { id: 'small', size: 190_000_000, speedRT: null },
  { id: 'large-v3', size: 1_080_000_000, speedRT: null },
];
const DEFAULT_SPEED: Record<ModelId, number> = { turbo: 2.7, small: 6, 'large-v3': 1.2 };

export default function ModelDialog({ props, services, close }: { props: DialogPropsMap['model']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { go } = useRouter();
  const info = useStore(services.models.info);
  const models = useStore(services.models.models);
  const queue = useStore(services.transcription.state);
  const view = useStore(services.library.classes).find((c) => c.id === props.classId);
  const lecture = useStore(services.forClass(props.classId).lectures.list).find((l) => l.id === props.lectureId);
  const [choice, setChoice] = useState<ModelId>('turbo');
  const [busy, setBusy] = useState(false);
  const [diskFull, setDiskFull] = useState(false);
  const cpuOk = info ? info.cpuOk && info.localWhisper : true;
  const shared = !!view?.shared;
  const list = (models.length ? models : MODEL_CATALOG) as ReadonlyArray<Pick<ModelState, 'id' | 'size' | 'speedRT'>>;
  const byId = (id: ModelId) => list.find((m) => m.id === id) ?? MODEL_CATALOG.find((m) => m.id === id)!;
  const estimate = (id: ModelId) => (lecture ? t('speech.prompt.estimate', { time: duration(lecture.durationMs / (byId(id).speedRT ?? DEFAULT_SPEED[id]), i18n) }) : '');

  const download = async (id: ModelId) => {
    setBusy(true);
    setDiskFull(false);
    try {
      await services.models.setActive(id);
      pendingAfterModel.set({ classId: props.classId, lectureId: props.lectureId });
      close();
      await services.models.download(id);
    } catch (e) {
      const code = toPlatformError(e).code;
      pendingAfterModel.set(null);
      if (code === 'DISK_FULL') setDiskFull(true);
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const cloud = async () => {
    if (!queue.cloud.on) {
      close();
      go({ name: 'settings', section: 'transcription' });
      return;
    }
    close();
    try {
      await services.transcription.claim(props.classId, props.lectureId, 'cloud');
    } catch (e) {
      toast.error(e);
    }
  };

  const option = (id: ModelId, label: string, hint: string) => ({
    value: id,
    label: (
      <span className="model-choice">
        <span className="model-choice__label">{label}</span>
        <span className="model-choice__size">{size(byId(id).size, i18n)}</span>
      </span>
    ),
    description: id === 'turbo' ? `${hint} · ${estimate(id)}`.replace(/ · $/, '') : hint,
  });

  return (
    <Dialog
      open
      onClose={close}
      size="lg"
      title={t('speech.prompt.title')}
      description={t('speech.prompt.body')}
      data-testid="model-prompt"
      footer={
        <>
          {shared ? (
            <Button
              variant="ghost"
              onClick={() => {
                close();
                toast.show(t('speech.prompt.classmateDone'));
              }}
              data-testid="model-prompt-classmate"
            >
              {t('speech.prompt.classmate')}
            </Button>
          ) : null}
          <Button onClick={() => void cloud()} data-testid="model-prompt-cloud">
            {queue.cloud.on ? t('speech.prompt.cloud') : t('speech.prompt.cloudOff')}
          </Button>
          {cpuOk ? (
            <Button variant="primary" busy={busy} onClick={() => void download(choice)} data-testid="model-prompt-download">
              {t('speech.prompt.download')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="record-form">
        {cpuOk ? (
          <RadioGroup
            label={t('speech.prompt.choose')}
            hideLabel
            value={choice}
            onChange={setChoice}
            options={[
              option('turbo', t('speech.models.turbo'), t('speech.prompt.turboHint')),
              option('small', t('speech.models.small'), t('speech.prompt.smallHint')),
              option('large-v3', t('speech.models.large-v3'), t('speech.prompt.largeHint')),
            ]}
            data-testid="model-choice"
          />
        ) : (
          <Notice tone="warning" data-testid="model-prompt-cpu">{t('speech.prompt.cpu')}</Notice>
        )}
        {diskFull ? (
          <Notice
            tone="danger"
            data-testid="model-prompt-disk"
            actions={
              <>
                <Button size="sm" onClick={() => void download('small')}>{t('speech.prompt.useDraft', { size: size(byId('small').size, i18n) })}</Button>
                <Button size="sm" variant="ghost" onClick={() => { close(); go({ name: 'settings', section: 'storage' }); }}>{t('speech.prompt.openStorage')}</Button>
              </>
            }
          >
            {t('speech.prompt.noDiskUnknown', { size: size(byId(choice).size, i18n) })}
          </Notice>
        ) : null}
      </div>
    </Dialog>
  );
}
