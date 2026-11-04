// First share (UX §3.15.1, D48): shown once, after the first class is shared or joined (and on the first window
// close with a shared class, opened by the shell): keep sharing in the background (tray), start at log-in.
import React, { useEffect, useState } from 'react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import './sync.css';

export default function FirstShareDialog({ props, services, close }: { props: DialogPropsMap['first-share']; services: AppServices; close(): void }) {
  void props;
  const { t } = useI18n();
  const toast = useToast();
  const { prefs, platform, info } = services.ctx;
  const [tray, setTray] = useState(prefs.get('app.trayOnClose') !== '0');
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState(false);
  const mac = info.os === 'macos' || info.traySupported === false;
  useEffect(() => {
    void platform.window.autostart.get().then(setAutostart, () => undefined);
  }, [platform]);
  const done = async () => {
    setBusy(true);
    try {
      await prefs.set('app.trayOnClose', tray ? '1' : '0');
      await prefs.set('app.trayAsked', '1');
      await platform.window.autostart.set(autostart).catch(() => undefined);
      const shared = services.library.classes.get().filter((c) => c.shared).length;
      await platform.window.setBackgroundMode({ trayOnClose: tray, sharedClasses: shared }).catch(() => undefined);
      close();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => void done()}
      size="md"
      title={t('sync.firstShare.title')}
      onSubmit={() => void done()}
      data-testid="first-share-dialog"
      footer={<Button type="submit" variant="primary" busy={busy} data-testid="first-share-done">{t('common.done')}</Button>}
    >
      <div className="first-share__body">
        <p>{t('sync.firstShare.body')}</p>
        <Checkbox checked={tray} onChange={setTray} label={mac ? t('sync.firstShare.trayMac') : t('sync.firstShare.tray')} data-testid="first-share-tray" />
        <Checkbox checked={autostart} onChange={setAutostart} label={t('sync.firstShare.autostart')} data-testid="first-share-autostart" />
      </div>
    </Dialog>
  );
}
