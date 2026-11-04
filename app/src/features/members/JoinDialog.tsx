// The Join dialog (UX §3.12.3): paste (the whole message is fine; or an invite file), preview (who invited, the
// class's name, colour and icon, what you get, where it is kept, recordings, the class rules, your name), then the
// waiting states of sync spec §8 (connecting, nobody online after 30 s, waiting to be let in, not let in 90 s after
// the first connection with [Try again]) with this computer's check words, and "You're in!".
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardPaste, FileUp, FolderOpen } from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import { sanitize, unique } from '../../core/model/sanitize';
import type { ClassId } from '../../core/model/ids';
import type { Picked } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import type { InvitePreview } from '../../services/types/sync';
import type { DialogPropsMap } from '../registry';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice, ProgressBar, Spinner } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { classStyle } from '../../ui/classColor';
import { iconOrDefault } from '../../core/model/icons';
import { useI18n } from '../../ui/i18n';
import { parseMarks } from '../../ui/marks';
import { SyncErrorCard, syncErrorOf } from '../sync/cards';
import './members.css';

type Step = 'paste' | 'preview' | 'wait' | 'done';
const NOBODY_MS = 30_000;
const CLOUD = /(onedrive|dropbox|icloud|google drive|googledrive|mega|pcloud|nextcloud|owncloud|box sync)/i;

export default function JoinDialog({ props, services, close }: { props: DialogPropsMap['join']; services: AppServices; close(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { go } = useRouter();
  const identity = useStore(services.ctx.identity);
  const sync = useStore(services.sync.state);
  const connections = useStore(services.sync.connections);
  const [step, setStep] = useState<Step>('paste');
  const [text, setText] = useState(props.code ?? '');
  const [error, setError] = useState<{ key: string; classId?: ClassId; className?: string } | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState(true);
  const [rules, setRules] = useState(false);
  const [parent, setParent] = useState<Picked | null>(null);
  const [rootPath, setRootPath] = useState<{ path: string; names: string[] } | null>(null);
  const [joined, setJoined] = useState<ClassId | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [now, setNow] = useState(() => services.ctx.clock.now());
  const [wasJoining, setWasJoining] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  // [Join class] says disabled="true" while the rules are not ticked (the scenario of plan §6.2 reads the attribute).
  useLayoutEffect(() => {
    const el = submitRef.current;
    if (el && el.hasAttribute('disabled')) el.setAttribute('disabled', 'true');
  });

  useEffect(() => {
    void services.ctx.platform.classes.root().then(setRootPath, () => setRootPath(null));
  }, [services]);

  // While waiting: a 1 s tick for the 30 s "nobody online" state; the join record says when it connected.
  useEffect(() => {
    if (step !== 'wait') return;
    const id = window.setInterval(() => setNow(services.ctx.clock.now()), 1000);
    return () => window.clearInterval(id);
  }, [step, services]);

  const j = joined ? services.sync.joining(joined) : null;
  const joiningNow = !!j;
  useEffect(() => {
    if (joiningNow) setWasJoining(true);
  }, [joiningNow]);
  const folder = joined ? sync.folders[joined] : undefined;
  const admitted = !!joined && (!!folder && Object.values(folder.completion).some((c) => c.remoteState === 'valid') || (wasJoining && !j));
  useEffect(() => {
    if (step === 'wait' && admitted) setStep('done');
  }, [step, admitted]);

  const dirName = useMemo(() => (preview ? sanitize(preview.invite.l, 'Class') : ''), [preview]);
  const folderPath = parent ? `${parent.path}/${dirName}` : rootPath ? `${rootPath.path}/${unique(rootPath.names, dirName)}` : dirName;
  const cloud = CLOUD.test(folderPath);

  async function readClipboard() {
    try {
      const v = await navigator.clipboard.readText();
      if (v) {
        setText(v);
        setError(null);
      }
    } catch (e) {
      toast.error(e);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const v = (await f.text()).slice(0, 20_000);
      setText(v);
      setError(null);
    } catch (err) {
      toast.error(err);
    }
  }

  async function next() {
    if (!text.trim()) {
      setError({ key: 'members.join.invalid' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await services.sync.parseCode(text);
      if (p.warnings.includes('alreadyMember')) {
        const known = services.library.classes.get().find((c) => c.id === p.classId);
        setError({ key: 'members.join.already', classId: p.classId, className: known?.name ?? p.invite.l });
        return;
      }
      if (p.warnings.includes('ownInvite')) {
        setError({ key: 'members.joinMore.own' });
        return;
      }
      setPreview(p);
      setRules(false);
      setStep('preview');
    } catch (e) {
      const err = toPlatformError(e);
      if (err.code === 'NEWER_FORMAT') setError({ key: (err.data as { pair?: boolean } | undefined)?.pair ? 'members.join.pairNeedsNewer' : 'members.join.newer' });
      else setError({ key: 'members.join.invalid' });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!preview || !rules) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const classId = await services.sync.join(preview, { includeAudio: audio, ...(parent ? { parent } : {}) });
      setJoined(classId);
      setNow(services.ctx.clock.now());
      setStep('wait');
    } catch (e) {
      const err = toPlatformError(e);
      if (err.code === 'CONFLICT') setError({ key: 'members.join.already', classId: preview.classId, className: preview.invite.l });
      setSubmitError(err.code);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!joined) return;
    setBusy(true);
    try {
      const id = await services.sync.retryJoin(joined);
      setJoined(id);
      setNow(services.ctx.clock.now());
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const inviter = preview?.invite.n || t('members.joinMore.someone');
  const titleFor: Record<Step, string> = {
    paste: t('members.join.title'), preview: t('members.join.title'), wait: t('members.join.title'), done: t('members.join.title'),
  };
  const canClose = step !== 'preview' || !busy;

  let footer: React.ReactNode;
  if (step === 'paste') {
    footer = (
      <>
        <Button variant="ghost" onClick={close} data-testid="join-cancel">{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!text.trim()} data-testid="join-continue">{t('members.join.continue')}</Button>
      </>
    );
  } else if (step === 'preview') {
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep('paste')} disabled={busy} data-testid="join-back">{t('common.back')}</Button>
        <Button ref={submitRef} type="submit" variant="primary" busy={busy} disabled={!rules} data-testid="join-submit">{t('members.join.submit')}</Button>
      </>
    );
  } else if (step === 'wait') {
    footer = <Button variant="ghost" onClick={close} data-testid="join-close">{t('common.close')}</Button>;
  } else {
    footer = (
      <Button variant="primary" onClick={() => { if (joined) go({ name: 'class', classId: joined }); close(); }} data-testid="join-open">{t('members.joinMore.openClass')}</Button>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      dismissible={canClose}
      size="md"
      title={titleFor[step]}
      onSubmit={step === 'paste' ? () => void next() : step === 'preview' ? () => void submit() : undefined}
      data-testid="join-dialog"
      footer={footer}
    >
      {step === 'paste' ? (
        <div className="join__step" data-testid="join-step-paste">
          <TextArea
            fieldClassName="join__code"
            label={t('members.join.paste')}
            value={text}
            onChange={(v) => {
              setText(v);
              setError(null);
            }}
            rows={5}
            spellCheck={false}
            autoComplete="off"
            error={error && error.key !== 'members.join.already' ? t(error.key as 'members.join.invalid') : undefined}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void next();
              }
            }}
            data-testid="join-code"
          />
          {error?.key === 'members.join.already' ? (
            <Notice
              tone="info"
              actions={error.classId ? <Button size="sm" onClick={() => { go({ name: 'class', classId: error.classId! }); close(); }} data-testid="join-open-existing">{t('members.join.openIt')}</Button> : undefined}
              data-testid="join-already"
            >
              {t('members.join.already', { class: error.className ?? '' })}
            </Notice>
          ) : null}
          <div className="join__row">
            <Button icon={ClipboardPaste} onClick={() => void readClipboard()} data-testid="join-paste">{t('members.join.pasteButton')}</Button>
            <Button variant="ghost" icon={FileUp} onClick={() => fileInput.current?.click()} data-testid="join-open-file">{t('members.join.openFile')}</Button>
            <input ref={fileInput} type="file" accept=".tramado-invite,.txt,text/plain" hidden onChange={(e) => void onFile(e)} data-testid="join-file-input" />
          </div>
        </div>
      ) : null}

      {step === 'preview' && preview ? (
        <div className="join__step" data-testid="join-step-preview">
          <p className="join__invited">{t('members.join.invitedBy', { name: inviter })}</p>
          <div className="join__class cls-scope" style={classStyle(preview.invite.c)} data-testid="join-class">
            <ClassTab color={preview.invite.c} icon={iconOrDefault(preview.invite.i)} size="lg" filled />
            <div>
              <div className="join__class-name">{preview.invite.l}</div>
              {preview.invite.lt || preview.invite.tm ? <div className="join__class-meta">{[preview.invite.lt, preview.invite.tm].filter(Boolean).join(' · ')}</div> : null}
            </div>
          </div>
          {preview.warnings.includes('old') ? <Notice tone="warning" data-testid="join-old">{t('members.joinMore.old')}</Notice> : null}
          <p className="t-secondary">{t('members.join.whatYouGet')}</p>
          <div className="join__folder" data-testid="join-folder">
            <span className="t-secondary">{t('members.join.folder')}</span>
            <span className="join__path" data-testid="join-folder-path">{folderPath}</span>
            <Button
              size="sm"
              icon={FolderOpen}
              onClick={() => void services.ctx.platform.dialogs.pickFolder({ title: t('members.join.folder') }).then((p) => p && setParent(p), (e: unknown) => toast.error(e))}
              data-testid="join-folder-change"
            >
              {t('common.change')}
            </Button>
          </div>
          {cloud ? <Notice tone="warning" data-testid="join-folder-cloud">{t('members.joinMore.cloudFolder')}</Notice> : null}
          <Checkbox checked={audio} onChange={setAudio} label={t('members.join.audio')} data-testid="join-audio" />
          {!audio ? <p className="join__hint" data-testid="join-audio-hint">{t('members.join.audioOff')}</p> : null}
          <Checkbox checked={rules} onChange={setRules} label={t('members.join.rules')} data-testid="join-rules" />
          <p className="join__name" data-testid="join-name">
            <span>{t('members.join.asName', { name: identity?.name ?? '' })}</span>
            <Button size="sm" variant="ghost" onClick={() => { go({ name: 'settings', section: 'profile' }); close(); }} data-testid="join-name-change">{t('common.change')}</Button>
          </p>
          {submitError ? (
            syncErrorOf(null, submitError) ? <SyncErrorCard services={services} code={submitError} /> : <Notice tone="danger" data-testid="join-error">{t(`errors.${submitError}` as 'errors.AI_BUSY')}</Notice>
          ) : null}
        </div>
      ) : null}

      {step === 'wait' && preview ? (
        <WaitStep
          inviter={inviter}
          words={preview.checkWords}
          stalled={!!joined && sync.joinStalled.includes(joined)}
          connected={!!j?.connectedAt || preview.devices.some((d) => connections[d.deviceId]?.connected)}
          nobody={!j?.connectedAt && !!j && now - j.since >= NOBODY_MS}
          busy={busy}
          onRetry={() => void retry()}
        />
      ) : null}

      {step === 'done' && preview ? (
        <div className="join__done" data-testid="join-step-done">
          <p className="join__wait-title"><CheckCircle2 size={18} aria-hidden strokeWidth={1.75} className="join__ok" /> {t('members.join.in', { class: preview.invite.l, have: folder?.inSyncFiles ?? 0, total: folder?.globalFiles ?? 0 })}</p>
          <ProgressBar value={folder && folder.globalFiles ? folder.inSyncFiles / folder.globalFiles : null} label={t('members.join.in', { class: preview.invite.l, have: folder?.inSyncFiles ?? 0, total: folder?.globalFiles ?? 0 })} data-testid="join-progress" />
          <p className="t-small t-muted">{t('members.joinMore.arriving')}</p>
        </div>
      ) : null}
    </Dialog>
  );
}

function WaitStep({ inviter, words, stalled, connected, nobody, busy, onRetry }: { inviter: string; words: string; stalled: boolean; connected: boolean; nobody: boolean; busy: boolean; onRetry(): void }) {
  const { t } = useI18n();
  const wordsLine = (
    <p data-testid="join-check-words">
      {parseMarks(t('members.join.checkWords', { words })).map((p, i) => (p.mark === 'b' ? <code key={i} className="check-words__inline" translate="no">{p.text}</code> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </p>
  );
  return (
    <div className="join__wait" data-testid="join-step-wait" data-state={stalled ? 'stalled' : nobody ? 'nobody' : connected ? 'waiting' : 'connecting'}>
      {stalled ? (
        <>
          <Notice tone="warning" data-testid="join-stalled">{t('members.join.stalled', { name: inviter })}</Notice>
          <Button variant="primary" busy={busy} onClick={onRetry} data-testid="join-retry">{t('members.join.retry')}</Button>
          {wordsLine}
        </>
      ) : nobody ? (
        <>
          <p data-testid="join-nobody">{t('members.join.nobody')}</p>
          {wordsLine}
          <p className="t-small t-muted">{t('members.join.canClose')}</p>
        </>
      ) : connected ? (
        <>
          <Spinner label={t('members.join.waitingAsk')} />
          <p>{t('members.join.waitingAsk')}</p>
          {wordsLine}
          <p className="t-small t-muted">{t('members.join.sameWords')}</p>
        </>
      ) : (
        <>
          <Spinner label={t('members.join.connecting', { name: inviter })} />
          <p>{t('members.join.connecting', { name: inviter })}</p>
          {wordsLine}
          <p className="t-small t-muted">{t('members.join.canClose')}</p>
        </>
      )}
    </div>
  );
}
