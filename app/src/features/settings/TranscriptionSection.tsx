// Settings › Transcription (UX §3.14.4): the speech models (download with progress and Pause, resume, remove,
// the active one, import a model file), helping to transcribe the class's lectures (volunteering, default
// "when plugged in" and effective only once a model is ready), cloud transcription with OpenRouter (confirmed),
// the microphone with a test meter (no recording is made), recording quality, how far markers point back, and
// the opt-in marker shortcuts that work in any app while recording.
import React, { useEffect, useState } from 'react';
import { CircleCheck, Download, Upload } from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import type { AudioDevices, ModelId, ModelState } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import { useAppState } from '../../shell/AppState';
import { useStore } from '../../shell/useStore';
import { useKeyLabel } from '../../shell/keys';
import { Button } from '../../ui/components/Button';
import { Checkbox, RadioGroup, Switch } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Notice, ProgressBar, Section } from '../../ui/components/Feedback';
import { Select, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { LevelMeter } from '../../ui/tramado/LevelMeter';
import { cx } from '../../ui/cx';
import { MODEL_CATALOG } from '../record/ModelDialog';
import { mb, size, timeLeft } from '../lectures/format';
import '../record/record.css';

const MODELS: readonly ModelId[] = ['turbo', 'small', 'large-v3'];
import { MARKER_SHORTCUTS as SHORTCUTS } from '../record/Recovery';

export default function TranscriptionSection({ services }: { services: AppServices }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const confirm = useConfirm();
  const app = useAppState();
  const key = useKeyLabel();
  const info = useStore(services.models.info);
  const models = useStore(services.models.models);
  const active = useStore(services.models.active);
  const downloads = useStore(services.models.downloads);
  const queue = useStore(services.transcription.state);
  const meter = useStore(services.recording.meter);
  const prefs = app.prefsStore;
  useStore(prefs?.store ?? services.ctx.prefs.store);
  const get = (k: Parameters<NonNullable<typeof prefs>['get']>[0]) => (prefs ?? services.ctx.prefs).get(k);
  const [devices, setDevices] = useState<AudioDevices | null>(null);
  const [testing, setTesting] = useState(false);
  const [heard, setHeard] = useState(false);
  const [cloudModel, setCloudModel] = useState(queue.cloud.model);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const speech = services.ctx.platform.speech;
  const cpuOk = info ? info.cpuOk && info.localWhisper : true;

  useEffect(() => {
    let live = true;
    void services.models.refresh().catch(() => undefined);
    void speech?.devices().then((d) => live && setDevices(d), () => undefined);
    return () => {
      live = false;
    };
  }, [services, speech]);
  // The microphone test: the meter only, nothing is recorded (RecordingService.startMeter).
  useEffect(() => {
    if (!testing) return undefined;
    setHeard(false);
    void services.recording.startMeter({ inputDeviceId: get('speech.inputDevice') || null, mode: 'room' }).catch((e: unknown) => {
      toast.error(e);
      setTesting(false);
    });
    const timer = setTimeout(() => setTesting(false), 10_000);
    return () => {
      clearTimeout(timer);
      void services.recording.stopMeter().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testing]);
  useEffect(() => {
    if (testing && meter?.mic && meter.mic.rmsDb > -45) setHeard(true);
  }, [testing, meter]);

  const setPref = (k: Parameters<typeof app.setPref>[0], v: string) => void app.setPref(k, v);
  const stateOf = (id: ModelId): ModelState | null => models.find((m) => m.id === id) ?? null;
  const sizeOf = (id: ModelId) => stateOf(id)?.size ?? MODEL_CATALOG.find((m) => m.id === id)!.size;
  const ready = models.filter((m) => m.state === 'ready');

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (id: ModelId) => {
    const ok = await confirm({ title: t('speech.removeConfirm.title', { model: t(`speech.models.${id}`) }), body: t('speech.removeConfirm.body', { size: size(sizeOf(id), i18n) }), confirmLabel: t('speech.removeConfirm.confirm'), danger: true });
    if (ok) await run(() => services.models.remove(id));
  };
  const importModel = async (id: ModelId) => {
    const [pick] = await services.ctx.platform.dialogs.pickFiles({ title: t('settings.transcription.import'), filters: [{ name: 'ggml', extensions: ['bin'] }], multiple: false }).catch(() => []);
    if (pick) await run(() => services.models.import(id, pick));
  };
  const toggleCloud = async (on: boolean) => {
    if (on) {
      const ok = await confirm({ title: t('settings.transcription.cloudConfirm.title'), body: t('settings.transcription.cloudConfirm.body'), confirmLabel: t('settings.transcription.cloudConfirm.confirm') });
      if (!ok) return;
    }
    await run(() => services.transcription.setCloud(on, cloudModel, queue.cloud.auto));
  };
  const toggleShortcuts = async (on: boolean) => {
    setShortcutError(null);
    try {
      await services.ctx.platform.system.setMarkerShortcuts(on ? { ...SHORTCUTS } : null);
      setPref('speech.markerShortcuts', on ? '1' : '');
    } catch (e) {
      const code = toPlatformError(e).code;
      if (code === 'CONFLICT') setShortcutError(t('speech.shortcutTaken', { keys: key('Alt+1').replace('Alt+1', 'Alt+1…4') }));
      else toast.error(e);
    }
  };

  const deviceOptions = [
    ...(devices?.inputs ?? []).map((d) => ({ value: d.isDefault ? '' : d.id, label: d.isDefault ? t('record.dialog.deviceDefault', { name: d.name }) : d.name })),
  ];
  const leadMs = Number(get('speech.markerOffsetMs')) || 0;

  return (
    <div className="settings-transcription" data-testid="settings-transcription">
      <h2 className="set-section__title">{t('settings.sections.transcription')}</h2>
      <Section title={t('settings.transcription.models')} data-testid="speech-models">
        {!speech ? <Notice tone="info" data-testid="speech-unavailable">{t('speech.unavailable')}</Notice> : null}
        {!cpuOk ? (
          <Notice tone="warning" data-testid="speech-cpu">{t('settings.transcription.cpu')}</Notice>
        ) : (
          <div className="model-rows" role="radiogroup" aria-label={t('settings.transcription.models')}>
            {MODELS.map((id) => (
              <ModelRow
                key={id}
                id={id}
                state={stateOf(id)}
                size={sizeOf(id)}
                active={active === id}
                download={downloads[id] ?? (stateOf(id)?.state === 'downloading' ? { done: stateOf(id)!.bytes, total: stateOf(id)!.size, bytesPerSec: 0 } : null)}
                canSelect={stateOf(id)?.state === 'ready'}
                onSelect={() => void run(() => services.models.setActive(id))}
                onDownload={() => void run(() => services.models.download(id))}
                onPause={() => void run(() => services.models.cancel(id))}
                onRemove={() => void remove(id)}
                disabled={!speech}
              />
            ))}
          </div>
        )}
        {info ? (
          <p className="settings-hint">
            <Button size="sm" variant="ghost" icon={Upload} onClick={() => void importModel(active)} disabled={!speech || !cpuOk} data-testid="speech-import">
              {t('settings.transcription.import')}
            </Button>{' '}
            {t('settings.transcription.savedIn', { path: `${services.ctx.info?.paths.data ?? ''}/models` })}
          </p>
        ) : null}
      </Section>

      {cpuOk ? (
        <Section title={t('settings.transcription.volunteer')} description={t('settings.transcription.volunteerHint')} data-testid="speech-volunteer">
          <RadioGroup
            label={t('settings.transcription.volunteer')}
            hideLabel
            value={queue.volunteer}
            onChange={(v) => void run(() => services.transcription.setVolunteer(v))}
            options={[
              { value: 'off', label: t('settings.transcription.volunteerOff') },
              { value: 'plugged', label: t('settings.transcription.volunteerPlugged') },
              { value: 'always', label: t('settings.transcription.volunteerAlways') },
            ]}
            data-testid="speech-volunteer"
          />
          {queue.volunteer !== 'off' && ready.length === 0 ? <p className="settings-hint" data-testid="speech-volunteer-inactive">{t('speech.volunteerNeedsModel')}</p> : null}
          {queue.volunteerNotice ? (
            <Notice
              tone="info"
              data-testid="speech-volunteer-notice"
              actions={
                <>
                  <Button size="sm" onClick={() => void run(() => services.transcription.ackVolunteerNotice(false))}>{t('common.ok')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void run(() => services.transcription.ackVolunteerNotice(true))}>{t('speech.turnOff')}</Button>
                </>
              }
            >
              {t('notify.volunteerOn')}
            </Notice>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('settings.transcription.cloud')} data-testid="speech-cloud-section">
        <Switch checked={queue.cloud.on} onChange={(on) => void toggleCloud(on)} label={t('record.save.cloud')} description={t('speech.cloudHint')} data-testid="speech-cloud" />
        <TextField
          label={t('settings.transcription.cloudModel')}
          value={cloudModel}
          onChange={setCloudModel}
          onBlur={() => cloudModel.trim() && cloudModel !== queue.cloud.model && void run(() => services.transcription.setCloud(queue.cloud.on, cloudModel.trim(), queue.cloud.auto))}
          disabled={!queue.cloud.on}
          spellCheck={false}
          data-testid="speech-cloud-model"
        />
      </Section>

      <Section data-testid="speech-mic-section">
        <div className="record-row">
          <Select
            label={t('settings.transcription.mic')}
            value={get('speech.inputDevice')}
            onChange={(v) => setPref('speech.inputDevice', v)}
            options={deviceOptions.length ? deviceOptions : [{ value: '', label: '—' }]}
            disabled={!deviceOptions.length}
            data-testid="speech-mic"
            fieldClassName="record-row__field"
          />
          <div className="mic-test">
            <Button onClick={() => setTesting((x) => !x)} disabled={!speech} aria-pressed={testing} data-testid="speech-mic-test">
              {testing ? t('settings.transcription.micTesting') : t('settings.transcription.micTest')}
            </Button>
            <LevelMeter level={testing ? meter?.mic ?? null : null} label={t('record.dock.micLevel')} />
          </div>
        </div>
        {testing ? <p className={cx('settings-hint', heard && 'settings-hint--ok')} role="status">{heard ? t('settings.transcription.micOk') : t('settings.transcription.micSilent')}</p> : null}
      </Section>

      <Section title={t('settings.transcription.quality')} data-testid="speech-quality-section">
        <RadioGroup
          label={t('settings.transcription.quality')}
          hideLabel
          value={get('speech.bitrate') as '24000' | '16000'}
          onChange={(v) => setPref('speech.bitrate', v)}
          options={[
            { value: '24000', label: t('settings.transcription.qualityStandard') },
            { value: '16000', label: t('settings.transcription.qualitySaver') },
          ]}
          data-testid="speech-quality"
        />
      </Section>

      <Section title={t('settings.transcription.markerLead')} description={t('settings.transcription.markerLeadHint')} data-testid="speech-marker-lead-section">
        <Select
          aria-label={t('settings.transcription.markerLead')}
          value={String(leadMs)}
          onChange={(v) => setPref('speech.markerOffsetMs', v)}
          options={[0, 3000, 5000, 10000].map((ms) => ({ value: String(ms), label: tp('settings.transcription.markerLeadValue', ms / 1000, { n: ms / 1000 }) }))}
          data-testid="speech-marker-lead"
        />
        <Checkbox
          checked={get('speech.markerShortcuts') === '1'}
          onChange={(on) => void toggleShortcuts(on)}
          label={t('settings.transcription.globalShortcut', { keys: `${key('1', { alt: true })} … 4` })}
          disabled={!speech}
          data-testid="speech-global-shortcut"
        />
        {shortcutError ? <Notice tone="warning">{shortcutError}</Notice> : null}
      </Section>
    </div>
  );
}

function ModelRow({
  id, state, size: bytes, active, download, canSelect, onSelect, onDownload, onPause, onRemove, disabled,
}: {
  id: ModelId; state: ModelState | null; size: number; active: boolean; download: { done: number; total: number; bytesPerSec: number } | null; canSelect: boolean;
  onSelect(): void; onDownload(): void; onPause(): void; onRemove(): void; disabled: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const s = download ? 'downloading' : state?.state ?? 'absent';
  const hintKey = id === 'turbo' ? (state?.speedRT ? 'speech.models.turboHint' : 'speech.models.turboHintUnknown') : id === 'small' ? 'speech.models.smallHint' : 'speech.models.large-v3Hint';
  const hint = t(hintKey, { size: size(bytes, i18n), speed: state?.speedRT ? state.speedRT.toFixed(1) : '' });
  let status: React.ReactNode = null;
  if (s === 'ready') {
    status = (
      <>
        <span className="model-row__ok">
          <CircleCheck size={14} aria-hidden /> {t('speech.state.ready')}
        </span>
        <Button size="sm" variant="ghost" onClick={onRemove} disabled={disabled}>{t('speech.actions.remove')}</Button>
      </>
    );
  } else if (s === 'downloading' && download) {
    const secs = download.bytesPerSec > 0 ? (download.total - download.done) / download.bytesPerSec : null;
    const text = download.bytesPerSec > 0
      ? t('speech.state.downloading', { done: mb(download.done), total: `${mb(download.total)} MB`, speed: `${(download.bytesPerSec / 1e6).toFixed(1)} MB`, left: secs === null ? '' : timeLeft(secs / 60, i18n, 'speech') })
      : t('speech.state.partial', { done: mb(download.done), total: `${mb(download.total)} MB` }).replace(/\s*\(.*\)$/, '');
    status = (
      <>
        <ProgressBar value={download.done} max={download.total || 1} label={text} className="model-row__progress" />
        <span className="model-row__text t-tabular">{text.replace(/ · $/, '')}</span>
        <Button size="sm" onClick={onPause} disabled={disabled} data-testid="speech-model-pause">{t('speech.actions.pause')}</Button>
      </>
    );
  } else if (s === 'downloading' || s === 'verifying') {
    status = <span className="model-row__text">{s === 'verifying' ? t('speech.state.verifying') : t('common.working')}</span>;
  } else if (s === 'partial') {
    status = (
      <>
        <span className="model-row__text t-tabular">{t('speech.state.partial', { done: mb(state?.bytes ?? 0), total: `${mb(bytes)} MB` })}</span>
        <Button size="sm" onClick={onDownload} disabled={disabled}>{t('speech.actions.resume')}</Button>
        <Button size="sm" variant="ghost" onClick={onRemove} disabled={disabled}>{t('speech.actions.delete')}</Button>
      </>
    );
  } else if (s === 'failed') {
    status = (
      <>
        <span className="model-row__text model-row__text--bad">{t('speech.state.failed')}</span>
        <Button size="sm" onClick={onDownload} disabled={disabled}>{t('speech.actions.tryAgain')}</Button>
      </>
    );
  } else {
    status = (
      <Button size="sm" icon={Download} onClick={onDownload} disabled={disabled} data-testid="speech-model-download">
        {t('speech.actions.download')}
      </Button>
    );
  }
  return (
    <div className={cx('model-row', active && 'model-row--active')} data-testid={`speech-model-${id}`} data-state={s}>
      <label className={cx('model-row__pick', !canSelect && 'choice--disabled')}>
        <input type="radio" name="speech-model" className="choice__input" checked={active} disabled={!canSelect} onChange={onSelect} aria-describedby={`speech-model-${id}-hint`} />
        <span className="radio__dot" aria-hidden />
        <span className="model-row__name">{t(`speech.models.${id}`)}</span>
      </label>
      <span className="model-row__hint" id={`speech-model-${id}-hint`}>{hint}</span>
      <span className="model-row__status">{status}</span>
    </div>
  );
}
