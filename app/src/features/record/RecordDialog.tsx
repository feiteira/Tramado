// The record dialog (UX §3.6.2, D54): where the lecture is, the language and microphone (with a live meter),
// the lecturer's permission (versioned consent sentences, or the class's record on file) and, in a shared class,
// what to share, the presence warning when a classmate is already recording, and the pre-flight checks. Without
// a class (Ctrl/⌘+Shift+R on Today) it first asks which class (`record-pick-class`). The answers are
// remembered per class (prefs `record.<classId>`).
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleDot, Headphones, Info, Mic, MonitorSpeaker, TriangleAlert } from 'lucide-react';
import { DateTime } from 'luxon';
import { toPlatformError } from '../../core/errors';
import type { ClassId, Lang } from '../../core/model/ids';
import type { AudioDevices } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { ConsentInput } from '../../services/types/class';
import type { DialogPropsMap } from '../registry';
import { useStore } from '../../shell/useStore';
import { useAppState } from '../../shell/AppState';
import { Button } from '../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { Select } from '../../ui/components/Field';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { renderMarks } from '../../ui/marks';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { LevelMeter } from '../../ui/tramado/LevelMeter';
import { defaultLectureTitle, hhmm } from '../lectures/format';
import { LANGUAGE_OPTIONS, readRecordPrefs, shareKey, type ShareChoice } from './prefs';
import './record.css';

export default function RecordDialog({ props, services, close }: { props: DialogPropsMap['record']; services: AppServices; close(): void }) {
  const [classId, setClassId] = useState<ClassId | null>(props.classId ?? null);
  if (!classId) return <PickClass services={services} close={close} onPick={setClassId} />;
  return <RecordForm classId={classId} services={services} close={close} />;
}

function PickClass({ services, close, onPick }: { services: AppServices; close(): void; onPick(id: ClassId): void }) {
  const { t } = useI18n();
  const classes = useStore(services.library.classes).filter((c) => !c.archived);
  return (
    <Dialog open onClose={close} size="sm" title={t('record.pickClass')} data-testid="record-pick-class">
      <ul className="pick-class" role="list">
        {classes.map((c) => (
          <li key={c.id}>
            <button type="button" className="pick-class__item" onClick={() => onPick(c.id)} data-testid="record-pick-class-item" data-class-id={c.id}>
              <ClassTab color={c.color} icon={c.icon} size="sm" />
              <span className="pick-class__name">{c.name}</span>
              {c.shared ? <span className="pick-class__hint">{t('common.sharedWithClass')}</span> : <span className="pick-class__hint">{t('common.onlyThisComputer')}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function RecordForm({ classId, services, close }: { classId: ClassId; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t, meta, locale } = i18n;
  const toast = useToast();
  const app = useAppState();
  const cls = services.forClass(classId);
  const view = useStore(services.library.classes).find((c) => c.id === classId);
  const detail = useStore(cls.info.detail);
  const lectures = useStore(cls.lectures.list);
  const meter = useStore(services.recording.meter);
  const speech = services.ctx.platform.speech;
  const shared = !!view?.shared;
  const saved = useMemo(() => readRecordPrefs(app.prefsStore, classId), [app.prefsStore, classId]);
  const [mode, setMode] = useState<'room' | 'online'>(saved?.mode ?? 'room');
  const [includeMe, setIncludeMe] = useState(saved?.includeMic ?? false);
  const [language, setLanguage] = useState<string>(saved?.language ?? (view?.language || 'auto'));
  const [device, setDevice] = useState<string>(saved?.device ?? (app.prefsStore?.get('speech.inputDevice') || ''));
  const [devices, setDevices] = useState<AudioDevices | null>(null);
  const [share, setShare] = useState<ShareChoice>(shared ? (saved?.share ? shareKey(saved.share) : 'both') : 'none');
  const [consent, setConsent] = useState(false);
  const [consentShare, setConsentShare] = useState(false);
  const [remember, setRemember] = useState(false);
  const [changing, setChanging] = useState(false);
  const [anyway, setAnyway] = useState(false);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const whyRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  // The disabled Start reads disabled="true" (the plan's must-pass assertion, UX §3.6.2 consent rules).
  useLayoutEffect(() => {
    const el = startRef.current;
    if (el?.disabled) el.setAttribute('disabled', 'true');
  });

  // Devices, the live meter (RecordingService.startMeter) and the battery.
  useEffect(() => {
    let live = true;
    void speech?.devices().then((d) => live && setDevices(d), () => live && setDevices({ inputs: [], systemAudio: { supported: false, reason: 'SPEECH_NO_DEVICE' } }));
    void services.ctx.platform.system.power().then((p) => live && setBattery(p.source === 'battery' ? p.percent : null), () => undefined);
    return () => {
      live = false;
    };
  }, [speech, services]);
  useEffect(() => {
    if (!speech) return undefined;
    void services.recording.startMeter({ inputDeviceId: device || null, mode }).catch(() => undefined);
    return () => void services.recording.stopMeter().catch(() => undefined);
  }, [speech, services, device, mode]);

  // The lecturer's permission on record for this class (scope "class", not revoked).
  const onRecord = useMemo(() => {
    const active = cls.info.consent.active();
    const rec = [...active].reverse().find((c) => c.kind === 'record' && c.scope === 'class');
    if (!rec) return null;
    const sh = [...active].reverse().find((c) => c.kind === 'share' && c.scope === 'class');
    const person = detail.people.find((p) => p.memberId === rec.memberId);
    return { record: rec, share: sh ?? null, name: person?.name ?? rec.memberId, date: DateTime.fromMillis(rec.ms).setLocale(meta.bcp47).toLocaleString(DateTime.DATE_MED) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cls, detail, meta.bcp47]);
  const useRecord = !!onRecord && !changing;
  const recordOk = useRecord || consent;
  const shareNeeded = shared && share !== 'none';
  const shareOk = !shareNeeded || (useRecord && !!onRecord?.share) || consentShare;

  // Someone else recording this class right now (presence, UX §3.6.2).
  const presence = view?.recordingBy && !view.recordingBy.self ? view.recordingBy : null;
  const presenceActivity = presence ? cls.presence.activityOf(presence.deviceId)?.activity?.recording ?? null : null;
  const presenceBlocks = !!presence && !anyway;

  const noDevice = devices !== null && devices.inputs.length === 0;
  const noSystem = mode === 'online' && devices !== null && !devices.systemAudio.supported;
  const lowBattery = battery !== null && battery < 15;
  const blocked = !speech || noDevice || noSystem || presenceBlocks;
  const canStart = recordOk && shareOk && !blocked && !busy;
  const missing = !recordOk ? t('record.dialog.startNeedsConsent') : !shareOk ? t('record.dialog.startNeedsShareConsent') : null;

  const consentText = t('record.dialog.consent.v1');
  const consentShareText = t('record.dialog.consentShare.v1');
  const lang = (meta.bcp47 as Lang) ?? 'en';
  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    setError(null);
    const record: ConsentInput = useRecord && onRecord
      ? { kind: 'record', scope: 'lecture', textId: 'record.dialog.consent.v1', textLang: onRecord.record.textLang, text: onRecord.record.text }
      : { kind: 'record', scope: 'lecture', textId: 'record.dialog.consent.v1', textLang: lang, text: consentText, ...(view?.lecturer ? { lecturer: view.lecturer } : {}) };
    const shareMode = share === 'both' ? 'audio+transcript' : share === 'transcript' ? 'transcript-only' : null;
    const shareInput: ConsentInput | null = shareNeeded && shareMode
      ? useRecord && onRecord?.share
        ? { kind: 'share', scope: 'lecture', share: shareMode, textId: 'record.dialog.consentShare.v1', textLang: onRecord.share.textLang, text: onRecord.share.text }
        : { kind: 'share', scope: 'lecture', share: shareMode, textId: 'record.dialog.consentShare.v1', textLang: lang, text: consentShareText, ...(view?.lecturer ? { lecturer: view.lecturer } : {}) }
      : null;
    try {
      const n = lectures.length + 1;
      await services.recording.start({
        classId, title: defaultLectureTitle(n, DateTime.fromMillis(services.ctx.clock.now()), i18n), mode, includeMic: mode === 'room' ? true : includeMe,
        inputDeviceId: device || null, language: language as Lang | 'auto', consent: { record, share: shareInput, remember: remember && !useRecord },
      });
      await app.setPref(`record.${classId}`, JSON.stringify({ mode, includeMic: includeMe, share: shareMode ?? 'none', language, device }));
      close();
    } catch (e) {
      const code = toPlatformError(e).code;
      if (code === 'SPEECH_PERMISSION') setError('permission');
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const deviceOptions = (devices?.inputs ?? []).map((d) => ({ value: d.isDefault ? '' : d.id, label: d.isDefault ? t('record.dialog.deviceDefault', { name: d.name }) : d.name }));
  const os = services.ctx.info?.os;
  const [before = '', after = ''] = t('record.dialog.title', { class: '\u0000' }).split('\u0000');
  const title = (
    <span className="record-title">
      {before}
      <span className="record-title__class">
        {view ? <ClassTab color={view.color} icon={view.icon} size="sm" /> : null}
        {view?.shortName ?? ''}
      </span>
      {after}
    </span>
  );

  return (
    <Dialog
      open
      onClose={close}
      size="lg"
      title={title}
      onSubmit={() => void start()}
      data-testid="record-dialog"
      footer={
        <>
          {missing ? (
            <span className="record-footer-hint" data-testid="record-start-hint">
              {missing}
            </span>
          ) : null}
          <Button onClick={close}>{t('common.cancel')}</Button>
          <span title={missing ?? undefined}>
            <Button ref={startRef} type="submit" variant="primary" icon={CircleDot} disabled={!canStart} busy={busy} data-testid="record-start">
              {t('record.dialog.start')}
            </Button>
          </span>
        </>
      }
    >
      <div className="record-form">
        {!speech ? <Notice tone="warning" data-testid="record-unavailable">{t('record.dialog.unavailable')}</Notice> : null}
        {presence ? (
          <Notice
            tone="warning"
            icon={TriangleAlert}
            data-testid="record-presence-warning"
            actions={
              anyway ? null : (
                <>
                  <Button size="sm" onClick={() => setAnyway(true)} data-testid="record-presence-anyway">
                    {t('record.dialog.presenceAnyway')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={close} data-testid="record-presence-cancel">
                    {t('record.dialog.presenceCancel')}
                  </Button>
                </>
              )
            }
          >
            {renderMarks(t('record.dialog.presence', {
              name: presence.memberName,
              time: presenceActivity ? hhmm(DateTime.fromISO(presenceActivity.startedAt)) : '—',
              mode: presenceActivity?.mode === 'online' ? t('record.dialog.presenceOnline') : t('record.dialog.presenceRoom'),
            }))}
          </Notice>
        ) : null}
        <fieldset className="record-section">
          <RadioGroup
            label={t('record.dialog.where')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'room', label: <span className="record-mode"><Mic size={15} aria-hidden /> {t('record.dialog.room')}</span>, description: t('record.dialog.roomHint') },
              { value: 'online', label: <span className="record-mode"><MonitorSpeaker size={15} aria-hidden /> {t('record.dialog.online')}</span>, description: t('record.dialog.onlineHint') },
            ]}
            data-testid="record-mode"
          />
          {mode === 'online' ? (
            <div className="record-online">
              <Checkbox checked={includeMe} onChange={setIncludeMe} label={t('record.dialog.includeMe')} data-testid="record-include-me" />
              <p className="record-hint">
                <Headphones size={14} aria-hidden /> {t('record.dialog.headphones')}
              </p>
            </div>
          ) : null}
          {noSystem ? (
            <Notice tone="warning" data-testid="record-no-system-audio" actions={<Button size="sm" onClick={() => setMode('room')}>{t('record.dialog.micOnly')}</Button>}>
              {t('record.dialog.noSystemAudio', { reason: t(`errors.${devices?.systemAudio.reason ?? 'SPEECH_NO_SYSTEM_AUDIO'}` as never) })}
            </Notice>
          ) : null}
        </fieldset>
        <div className="record-row">
          <Select label={t('record.dialog.language')} value={language} onChange={setLanguage} options={LANGUAGE_OPTIONS(locale, t('record.dialog.languageAuto'))} data-testid="record-language" fieldClassName="record-row__field" />
          <div className="record-row__field record-device">
            <Select label={t('record.dialog.device')} value={device} onChange={setDevice} options={deviceOptions.length ? deviceOptions : [{ value: '', label: '—' }]} disabled={!deviceOptions.length} data-testid="record-device" />
            <LevelMeter level={meter?.mic ?? null} label={t('record.dock.micLevel')} data-testid="record-device-meter" className="record-device__meter" />
          </div>
        </div>
        {noDevice ? <Notice tone="danger" data-testid="record-no-device">{t('errors.SPEECH_NO_DEVICE' as never)}</Notice> : null}
        {lowBattery ? <Notice tone="warning" data-testid="record-low-battery">{t('record.dialog.lowBattery', { percent: battery ?? 0 })}</Notice> : null}
        {error === 'permission' ? (
          <Notice tone="danger" data-testid="record-permission">
            {t('record.dialog.permissionDenied', { place: os === 'windows' ? t('record.dialog.permissionPlaceWindows') : t('record.dialog.permissionPlaceMac') })}
          </Notice>
        ) : null}
        <fieldset className="record-section record-permission">
          <legend className="record-section__title">{t('record.dialog.permission')}</legend>
          {useRecord && onRecord ? (
            <div className="record-onrecord" data-testid="record-on-record">
              <p>
                {t('record.dialog.onRecord', { scope: onRecord.share ? t('record.dialog.onRecordScopeBoth') : t('record.dialog.onRecordScopeRecord'), name: onRecord.name, date: onRecord.date })}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setChanging(true)} data-testid="record-consent-change">
                {t('common.change')}
              </Button>
            </div>
          ) : (
            <>
              <Checkbox checked={consent} onChange={setConsent} label={consentText} description={mode === 'online' ? t('record.dialog.consentOnline') : undefined} data-testid="record-consent" />
            </>
          )}
          {shared ? (
            <>
              <RadioGroup
                label={t('record.dialog.shareTitle')}
                value={share}
                onChange={setShare}
                options={[
                  { value: 'both', label: t('record.dialog.shareBoth') },
                  { value: 'transcript', label: t('record.dialog.shareTranscript') },
                  { value: 'none', label: t('record.dialog.shareNone') },
                ]}
                data-testid="record-share"
              />
              {shareNeeded && !(useRecord && onRecord?.share) ? (
                <Checkbox checked={consentShare} onChange={setConsentShare} label={consentShareText} data-testid="record-consent-share" />
              ) : null}
            </>
          ) : null}
          {!useRecord ? <Checkbox checked={remember} onChange={setRemember} label={t('record.dialog.remember')} description={shared ? t('record.dialog.rememberHint') : undefined} data-testid="record-remember" /> : null}
          <div className="record-law">
            <Info size={15} aria-hidden className="record-law__icon" />
            <p>
              {t('record.dialog.lawHint')}{' '}
              <button ref={whyRef} type="button" className="link-button" onClick={() => setWhy((w) => !w)} aria-expanded={why} data-testid="record-why">
                {t('common.learnMore')}
              </button>
            </p>
          </div>
          <Popover open={why} onClose={() => setWhy(false)} anchor={whyRef} padded side="top" className="record-why">
            <p className="record-why__text" data-testid="record-why-text">{t('record.why')}</p>
          </Popover>
        </fieldset>
      </div>
    </Dialog>
  );
}
