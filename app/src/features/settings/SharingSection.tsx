// Settings › Sharing (UX §3.14.5): status with [Restart sharing] (or "starts when you share or join a class", or the
// error / copied-identity cards), pause, this computer with its check words, keep sharing in the background (tray),
// start at log-in, local network only, speed limits, the "your own Syncthing" notice, and the diagnostics (version,
// shortened device ID, sync port, API state, classmates' computers, recent problems, the log with [Copy]). Never the
// API port. Pairing other computers is v1.1.
import React, { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronRight, Copy, Laptop, RefreshCw } from 'lucide-react';
import type { SyncDiagnostics } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox, Switch } from '../../ui/components/Choice';
import { Notice } from '../../ui/components/Feedback';
import { Select } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { CheckWords } from '../../ui/tramado/CheckWords';
import { PresenceDot } from '../../ui/tramado/PresenceDot';
import { useI18n } from '../../ui/i18n';
import { IdentityCopiedCard, SyncErrorCard, syncErrorOf } from '../sync/cards';
import { takeDiagnosticsRequest } from '../sync/diagnosticsFlag';
import { useRouter } from '../../shell/router';
import { formatSize, shortDevice } from '../sync/format';
import '../sync/sync.css';

const LIMITS = ['0', '2000', '1000', '500', '250'] as const;
type Limit = (typeof LIMITS)[number];
const asLimit = (v: string): Limit => ((LIMITS as readonly string[]).includes(v) ? (v as Limit) : '0');

export default function SharingSection({ services }: { services: AppServices }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { prefs, platform, info } = services.ctx;
  const sync = useStore(services.sync.state);
  const connections = useStore(services.sync.connections);
  const classes = useStore(services.library.classes);
  const device = useStore(services.ctx.device);
  const identity = useStore(services.ctx.identity);
  const [paused, setPaused] = useState(prefs.get('sync.paused') === '1');
  const [lanOnly, setLanOnly] = useState(prefs.get('sync.localOnly') === '1');
  const [up, setUp] = useState<Limit>(asLimit(prefs.get('sync.maxSendKbps')));
  const [down, setDown] = useState<Limit>(asLimit(prefs.get('sync.maxRecvKbps')));
  const [tray, setTray] = useState(prefs.get('app.trayOnClose') !== '0');
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [existing, setExisting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const { route } = useRouter();
  // Open when asked: the route's `diagnostics` (a link, the sync popover) or the older one-shot flag.
  const [diagOpen, setDiagOpen] = useState(() => takeDiagnosticsRequest() || (route.name === 'settings' && route.diagnostics === true));
  const [diag, setDiag] = useState<SyncDiagnostics | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const mac = info.os === 'macos' || info.traySupported === false;

  useEffect(() => {
    void platform.window.autostart.get().then(setAutostart, () => setAutostart(false));
    void platform.sync.existing().then((e) => setExisting(e.running), () => setExisting(false));
  }, [platform]);

  useEffect(() => {
    if (!diagOpen) return;
    let live = true;
    void platform.sync.diagnostics().then((d) => live && setDiag(d), () => live && setDiag(null));
    void services.sync.diagnosticsText().then((x) => live && setLog(x), () => live && setLog(''));
    return () => {
      live = false;
    };
  }, [diagOpen, platform, services, sync.status]);

  const apply = async (patch: Parameters<AppServices['sync']['applySettings']>[0]) => {
    try {
      await services.sync.applySettings(patch);
    } catch (e) {
      toast.error(e);
    }
  };
  const restart = async () => {
    setRestarting(true);
    try {
      await services.sync.restart();
    } catch (e) {
      toast.error(e);
    } finally {
      setRestarting(false);
    }
  };

  // Classmates' computers: every device of the shared classes' rosters (names from member files).
  const peers = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of classes.filter((x) => x.shared)) {
      try {
        const d = services.forClass(c.id).info.detail.get();
        for (const p of d.people) if (!p.isMe) for (const dev of p.devices) out.set(dev.deviceId, `${p.name} — ${dev.deviceName}`);
      } catch {
        // a class that left
      }
    }
    return [...out];
  }, [classes, services]);

  const status = sync.status;
  const errorCode = syncErrorOf(status);
  const running = status?.state === 'running';
  const limitOptions = LIMITS.map((v) => ({ value: v, label: v === '0' ? t('settings.sharing.noLimit') : `${formatSize(Number(v) * 1000, i18n)}/s` }));

  return (
    <section className="sharing" data-testid="settings-sharing" aria-labelledby="settings-sharing-title">
      <h2 id="settings-sharing-title" className="set-section__title">{t('settings.sections.sharing')}</h2>

      <div className="sharing__card">
      <div className="sharing__row" data-testid="sharing-status">
        <span className="sharing__label">{t('settings.sharing.status')}</span>
        <div className="sharing__value">
          {sync.identityCopied ? <IdentityCopiedCard services={services} /> : null}
          {errorCode && !sync.identityCopied ? <SyncErrorCard services={services} code={errorCode} onDetails={() => setDiagOpen(true)} /> : null}
          {!errorCode && !sync.identityCopied ? (
            <div className="sharing__status">
              <span className="sharing__status-text" data-testid="sharing-status-text" data-state={status?.state ?? 'stopped'}>
                <PresenceDot state={running ? 'online' : 'offline'} label={running ? t('members.dot.online') : t('members.dot.offline')} />
                {running ? t('settings.sharing.running', { version: (status?.version ?? '').replace(/^v/, ''), port: status?.syncPort ?? '—' }) : t('settings.sharing.notStarted')}
              </span>
              {running ? <Button size="sm" icon={RefreshCw} busy={restarting} onClick={() => void restart()} data-testid="sharing-restart">{t('settings.sharing.restart')}</Button> : null}
            </div>
          ) : null}
          <Switch
            checked={paused}
            onChange={(on) => {
              setPaused(on);
              void apply({ paused: on });
            }}
            label={t('settings.sharing.pause')}
            description={t('sync.popover.pauseHint')}
            data-testid="sharing-pause"
          />
        </div>
      </div>

      <div className="sharing__row" data-testid="sharing-devices">
        <span className="sharing__label">{t('settings.sharing.devices')}</span>
        <div className="sharing__value">
          <span className="sharing__device">
            <Laptop size={16} aria-hidden strokeWidth={1.75} />
            <span>{t('settings.sharing.thisDevice', { name: identity?.deviceName ?? '' })}</span>
            {device?.deviceId ? (
              <>
                <span className="t-muted">·</span>
                <span className="t-muted">{t('members.checkWords.label')}</span>
                <CheckWords deviceId={device.deviceId} data-testid="sharing-check-words" />
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="sharing__row">
        <span className="sharing__label">{t('settings.sharing.closeTitle')}</span>
        <div className="sharing__value">
          <Checkbox
            checked={tray}
            onChange={(on) => {
              setTray(on);
              void prefs.set('app.trayOnClose', on ? '1' : '0');
              void platform.window.setBackgroundMode({ trayOnClose: on, sharedClasses: classes.filter((c) => c.shared).length }).catch(() => undefined);
            }}
            label={mac ? t('settings.sharing.trayMac') : t('settings.sharing.tray')}
            description={t('settings.sharing.trayHint')}
            data-testid="sharing-tray"
          />
          <Checkbox
            checked={!!autostart}
            disabled={autostart === null}
            onChange={(on) => {
              setAutostart(on);
              void platform.window.autostart.set(on).catch((e: unknown) => {
                setAutostart(!on);
                toast.error(e);
              });
            }}
            label={t('settings.sharing.autostart')}
            data-testid="sharing-autostart"
          />
          <Checkbox
            checked={lanOnly}
            onChange={(on) => {
              setLanOnly(on);
              void apply({ localOnly: on });
            }}
            label={t('settings.sharing.lanOnly')}
            description={t('settings.sharing.lanOnlyHint')}
            data-testid="sharing-lan-only"
          />
        </div>
      </div>

      <div className="sharing__row">
        <span className="sharing__label">{t('settings.sharing.limits')}</span>
        <div className="sharing__limits">
          <Select
            label={t('settings.sharing.upload')}
            value={up}
            options={limitOptions}
            onChange={(v) => {
              setUp(v);
              void apply({ maxSendKbps: Number(v) });
            }}
            data-testid="sharing-limit-up"
          />
          <Select
            label={t('settings.sharing.download')}
            value={down}
            options={limitOptions}
            onChange={(v) => {
              setDown(v);
              void apply({ maxRecvKbps: Number(v) });
            }}
            data-testid="sharing-limit-down"
          />
        </div>
      </div>
      </div>

      {existing ? (
        <Notice tone="info" data-testid="sharing-own-syncthing">
          {t('settings.sharing.ownSyncthing', { port: status?.syncPort ?? '—' })}
        </Notice>
      ) : null}

      <details className="sharing__diag" open={diagOpen} onToggle={(e) => setDiagOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="sharing-diagnostics">
        <summary>
          <ChevronRight size={15} aria-hidden strokeWidth={1.75} />
          {t('settings.sharing.diagnostics')}
        </summary>
        {diagOpen ? (
          <div className="sharing__diag-body">
            <p data-testid="sharing-diag-version">
              {t('settings.sharing.diagVersion', {
                version: (diag?.status.version ?? status?.version ?? '—').replace(/^v/, ''),
                id: diag?.status.deviceId ? `${shortDevice(diag.status.deviceId)}…` : device?.deviceId ? `${shortDevice(device.deviceId)}…` : '—',
                port: diag?.ports.sync ?? status?.syncPort ?? '—',
                api: diag?.ports.guiOpen ? t('sync.diag.running') : t('sync.diag.stopped'),
              })}
              {device?.deviceId ? (
                <Button size="sm" variant="ghost" icon={Copy} onClick={() => void navigator.clipboard?.writeText(device.deviceId).then(() => toast.show({ message: t('common.copied'), tone: 'success' }), () => undefined)} data-testid="sharing-copy-id">
                  {t('sync.diag.copyId')}
                </Button>
              ) : null}
            </p>
            <div>
              <strong>{t('settings.sharing.diagPeers')}</strong>
              {peers.length ? (
                <ul className="sharing__peers" data-testid="sharing-peers">
                  {peers.map(([id, name]) => {
                    const c = connections[id];
                    return (
                      <li key={id} data-device-id={id}>
                        {c?.connected
                          ? t('settings.sharing.diagPeerConnected', { name, how: c.relay ? t('settings.sharing.diagHowRelay') : t('settings.sharing.diagHowDirect') })
                          : t('settings.sharing.diagPeerSeen', { name, when: c?.lastSeen ? i18n.relative(c.lastSeen) : t('members.list.presence.never') })}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="t-muted">{t('sync.diag.noPeers')}</p>}
            </div>
            <p>
              <strong>{t('settings.sharing.diagProblems')}</strong>{' '}
              {diag?.lastErrors.length
                ? diag.lastErrors.slice(-5).map((e) => `${DateTime.fromISO(e.when).isValid ? i18n.time(DateTime.fromISO(e.when)) : ''} ${e.message.replace(/\b([A-Z2-7]{7})(-[A-Z2-7]{7}){7}\b/g, '$1…')}`).join(' · ')
                : t('settings.sharing.diagNoProblems')}
            </p>
            <div className="sharing__status">
              <strong>{t('settings.sharing.diagLog')}</strong>
              <Button size="sm" variant="ghost" icon={Copy} disabled={!log} onClick={() => void navigator.clipboard?.writeText(log ?? '').then(() => toast.show({ message: t('common.copied'), tone: 'success' }), (e: unknown) => toast.error(e))} data-testid="sharing-log-copy">
                {t('settings.sharing.copyLog')}
              </Button>
            </div>
            <pre className="sharing__log" tabIndex={0} aria-label={t('settings.sharing.diagLog')} data-testid="sharing-log">{log ?? t('common.loading')}</pre>
          </div>
        ) : null}
      </details>
    </section>
  );
}
