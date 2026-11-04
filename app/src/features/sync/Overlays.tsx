// The sync overlays (UX §3.15): the copied-identity card (§3.15.12) and the received mass-deletion notices (§3.15.3)
// pinned at the top of the window; the local mass-delete guard opens its (not dismissible) dialog as soon as no
// other dialog is open; and the first-share dialog (§3.15.1) follows the first class that becomes shared or joined
// (once: prefs `app.trayAsked`).
import React, { useEffect, useRef } from 'react';
import type { AppServices } from '../../services/types/common';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { IdentityCopiedCard, MassDeleteRemoteNotice } from './cards';
import './sync.css';

export default function Overlays({ services }: { services: AppServices }) {
  const dialogs = useDialogs();
  const sync = useStore(services.sync.state);
  const classes = useStore(services.library.classes);
  const sharedAtStart = useRef<boolean | null>(null);
  const pendingFirstShare = useRef<string | null>(null);

  // The first shared class of this installation: remember the transition, open the dialog once nothing else is open.
  const shared = classes.filter((c) => c.shared);
  if (sharedAtStart.current === null) sharedAtStart.current = shared.length > 0;
  useEffect(() => {
    if (sharedAtStart.current || !shared.length) return;
    if (services.ctx.prefs.get('app.trayAsked') === '1') return;
    pendingFirstShare.current ??= shared[0]!.id;
  }, [shared, services]);

  const current = dialogs.current;
  useEffect(() => {
    if (current) return;
    const guard = sync.massDelete[0];
    if (guard) {
      dialogs.open('mass-delete', { classId: guard.classId });
      return;
    }
    const first = pendingFirstShare.current;
    if (first && services.ctx.prefs.get('app.trayAsked') !== '1') {
      pendingFirstShare.current = null;
      sharedAtStart.current = true;
      dialogs.open('first-share', { classId: first });
    }
  }, [current, sync.massDelete, classes, dialogs, services]);

  const remote = sync.massDeleteRemote.filter((m) => classes.some((c) => c.id === m.classId));
  if (!sync.identityCopied && !remote.length) return null;
  return (
    <div className="sync-overlay" data-testid="sync-overlay">
      {sync.identityCopied ? <IdentityCopiedCard services={services} /> : null}
      {remote.map((m) => (
        <MassDeleteRemoteNotice key={`${m.classId}-${m.by}`} services={services} classId={m.classId} by={m.by} byName={m.byName} count={m.count} className={classes.find((c) => c.id === m.classId)?.name ?? ''} />
      ))}
    </div>
  );
}
