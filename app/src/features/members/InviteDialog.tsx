// The Invite dialog (UX §3.12.2): [Copy invite] (a ready-to-paste message), the reduced invite as a QR code, the full
// code (read-only, selected on focus) with [Copy code], [Save as a file…] (`.tramado-invite`, sync spec §7.2) and the
// footer. The code needs Syncthing running: "Getting your computer ready to share…" while it starts; the sync error
// card when it cannot (§3.15.2). Fresh addresses each time the dialog opens.
import React, { useEffect, useState } from 'react';
import { Copy, Download, QrCode as QrIcon } from 'lucide-react';
import { toPlatformError } from '../../core/errors';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Notice, Spinner } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { QrCode } from '../../ui/tramado/QrCode';
import { useI18n } from '../../ui/i18n';
import { SyncErrorCard, syncErrorOf } from '../sync/cards';
import { downloadText } from '../sync/download';
import './members.css';

type Invite = Awaited<ReturnType<AppServices['sync']['invite']>>;

export default function InviteDialog({ props, services, close }: { props: DialogPropsMap['invite']; services: AppServices; close(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === props.classId);
  const detail = useStore(services.forClass(props.classId).info.detail);
  const name = cls?.name ?? detail.meta.name;
  const [invite, setInvite] = useState<Invite | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(null);
    setInvite(null);
    (async () => {
      const st = services.sync.state.get().status;
      if (!st || st.state !== 'running') await services.sync.ensureStarted();
      return services.sync.invite(props.classId);
    })().then(
      (inv) => live && setInvite(inv),
      (e: unknown) => live && setFailed(toPlatformError(e).code),
    );
    return () => {
      live = false;
    };
  }, [props.classId, services, attempt]);

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message, tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  };
  const syncCode = failed ? syncErrorOf(null, failed) : null;

  return (
    <Dialog
      open
      onClose={close}
      size="md"
      title={
        <span className="invite__class">
          {cls ? <ClassTab color={cls.color} icon={cls.icon} size="sm" filled /> : null}
          <span>{t('members.invite.title', { class: name })}</span>
        </span>
      }
      data-testid="invite-dialog"
      footer={<Button variant="primary" onClick={close} data-testid="invite-done">{t('common.done')}</Button>}
    >
      <div className="invite__body">
        <p className="invite__lead">{t('members.invite.body')}</p>
        {failed ? (
          syncCode ? (
            <SyncErrorCard services={services} code={syncCode} onRetried={() => setAttempt((a) => a + 1)} />
          ) : (
            <Notice tone="danger" actions={<Button size="sm" onClick={() => setAttempt((a) => a + 1)} data-testid="invite-retry">{t('common.tryAgain')}</Button>} data-testid="invite-error">
              {t(`errors.${failed}` as 'errors.AI_BUSY')}
            </Notice>
          )
        ) : !invite ? (
          <div className="invite__waiting" data-testid="invite-preparing">
            <Spinner label={t('members.invite.preparing')} />
            <span>{t('members.invite.preparing')}</span>
          </div>
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              icon={Copy}
              className="invite__copy"
              onClick={() => void copy(t('members.invite.message', { class: name, link: invite.web ?? invite.link, code: invite.code }), t('members.invite.copied'))}
              data-autofocus
              data-testid="invite-copy"
            >
              {t('members.invite.copy')}
            </Button>
            <div className="invite__qr">
              <QrCode value={invite.qrText} size={220} label={t('members.invite.qrLabel', { class: name })} data-testid="invite-qr" />
              <div className="invite__qr-text">
                <span><QrIcon size={14} aria-hidden strokeWidth={1.75} /> {t('members.invite.qr')}</span>
                <span className="t-small t-muted">{t('members.invite.qrHint')}</span>
              </div>
            </div>
            <TextArea
              fieldClassName="invite__code"
              label={t('members.invite.code')}
              value={invite.code}
              onChange={() => undefined}
              readOnly
              rows={4}
              spellCheck={false}
              onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => e.currentTarget.select()}
              data-testid="invite-code"
            />
            <div className="invite__code-actions">
              <Button icon={Copy} onClick={() => void copy(invite.code, t('members.invite.codeCopied'))} data-testid="invite-copy-code">{t('members.invite.copyCode')}</Button>
              <Button variant="ghost" icon={Download} onClick={() => downloadText(invite.fileName, invite.fileText, 'text/x-tramado-invite')} data-testid="invite-save-file">{t('members.invite.saveFile')}</Button>
            </div>
            <p className="invite__foot">
              {t('members.invite.footer')}
              {!detail.meta.askBeforeAdmit ? ` ${t('members.invite.footerAsk')}` : ''}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
