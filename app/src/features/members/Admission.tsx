// Admission notices on the members' side (UX §3.12.4), an overlay: ask-before requests ("{name} ("{device}") wants to
// join {class}. Check words: …" [Let in] [Not now]; several waiting for one class → "{n} people want to join {class}"
// [Review]) and automatic admissions ("{name} joined {class} · check words …" [Remove]). The OS notifications are
// raised by SyncService; these are the in-window cards (a stack above the dock; at most three).
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { checkWords } from '../../core/sync/checkWords';
import type { ClassId, DeviceId } from '../../core/model/ids';
import type { JoinRequestView } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button, IconButton } from '../../ui/components/Button';
import { useToast } from '../../ui/components/Toast';
import { parseMarks } from '../../ui/marks';
import { useI18n } from '../../ui/i18n';
import { splitDeviceName } from '../sync/format';
import { RemoveDialog, type RemoveTarget } from './RemoveDialog';
import './members.css';

const JOINED_MS = 10_000;
const words = (d: DeviceId) => {
  try {
    return checkWords(d);
  } catch {
    return '—';
  }
};

type Joined = { key: string; classId: ClassId; deviceId: DeviceId; name: string };

export default function Admission({ services }: { services: AppServices }) {
  const { t, tp } = useI18n();
  const toast = useToast();
  const { go } = useRouter();
  const sync = useStore(services.sync.state);
  const classes = useStore(services.library.classes);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [joined, setJoined] = useState<Joined[]>([]);
  const [removing, setRemoving] = useState<{ classId: ClassId; target: RemoveTarget } | null>(null);
  const timers = useRef(new Map<string, number>());

  // Automatic admissions: `admitted` events (this computer shared the folder with a joiner).
  useEffect(() => {
    const off = services.ctx.platform.events.onSync((e) => {
      if (e.type !== 'admitted') return;
      const key = `${e.classId}|${e.deviceId}`;
      setJoined((list) => [...list.filter((j) => j.key !== key), { key, classId: e.classId, deviceId: e.deviceId, name: e.name }].slice(-3));
      // The same computer again restarts its card's 10 s (an older timer would hide the new card early).
      const prev = timers.current.get(key);
      if (prev !== undefined) window.clearTimeout(prev);
      const id = window.setTimeout(() => {
        timers.current.delete(key);
        setJoined((list) => list.filter((j) => j.key !== key));
      }, JOINED_MS);
      timers.current.set(key, id);
    });
    const all = timers.current;
    return () => {
      off();
      for (const id of all.values()) window.clearTimeout(id);
    };
  }, [services]);

  const nameOf = (classId: ClassId) => classes.find((c) => c.id === classId)?.name ?? '';
  const visible = sync.joinRequests.filter((r) => !dismissed.has(`${r.classId}|${r.deviceId}`) && classes.some((c) => c.id === r.classId));
  const byClass = new Map<ClassId, JoinRequestView[]>();
  for (const r of visible) byClass.set(r.classId, [...(byClass.get(r.classId) ?? []), r]);
  const hide = (keys: string[]) => setDismissed((s) => new Set([...s, ...keys]));
  const admit = async (r: JoinRequestView) => {
    try {
      await services.sync.admit(r.classId, r.deviceId);
    } catch (e) {
      toast.error(e);
    }
  };
  const bold = (s: string) => parseMarks(s).map((p, i) => (p.mark === 'b' ? <strong key={i}>{p.text}</strong> : <React.Fragment key={i}>{p.text}</React.Fragment>));

  if (!byClass.size && !joined.length && !removing) return null;
  return (
    <>
      <div className="admission" role="region" aria-label={t('members.admission.label')} aria-live="polite">
        {[...byClass].map(([classId, list]) => {
          if (list.length > 1) {
            return (
              <div key={classId} className="admission__card" data-testid="admission-toast" data-class-id={classId}>
                <p className="admission__text">{tp('members.admission.several', list.length, { class: nameOf(classId) })}</p>
                <div className="admission__actions">
                  <Button size="sm" variant="ghost" onClick={() => hide(list.map((r) => `${r.classId}|${r.deviceId}`))} data-testid="admission-later">{t('members.list.later')}</Button>
                  <Button size="sm" variant="primary" onClick={() => { hide(list.map((r) => `${r.classId}|${r.deviceId}`)); go({ name: 'class', classId, tab: 'members' }); }} data-testid="admission-review">{t('members.admission.review')}</Button>
                </div>
              </div>
            );
          }
          const r = list[0]!;
          const { person, device } = splitDeviceName(r.name);
          return (
            <div key={classId} className="admission__card" data-testid="admission-toast" data-class-id={classId} data-device-id={r.deviceId}>
              <p className="admission__text">{bold(t('members.admission.wants', { name: person, device: device || '—', class: nameOf(classId), words: words(r.deviceId) }))}</p>
              <div className="admission__actions">
                <Button size="sm" variant="ghost" onClick={() => hide([`${r.classId}|${r.deviceId}`])} data-testid="admission-later">{t('members.list.later')}</Button>
                <Button size="sm" variant="primary" onClick={() => void admit(r)} data-testid="admission-admit">{t('members.list.admit')}</Button>
              </div>
            </div>
          );
        })}
        {joined.map((j) => {
          const { person } = splitDeviceName(j.name);
          return (
            <div key={j.key} className="admission__card" data-testid="admission-toast" data-class-id={j.classId} data-device-id={j.deviceId}>
              <p className="admission__text">{bold(t('members.admission.joined', { name: person, class: nameOf(j.classId), words: words(j.deviceId) }))}</p>
              <div className="admission__actions">
                {isOrganiser(services, j.classId) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const memberId = services.forClass(j.classId).info.personAt(j.deviceId);
                      setRemoving({ classId: j.classId, target: memberId ? { name: person, memberId } : { name: person, deviceId: j.deviceId } });
                      setJoined((list) => list.filter((x) => x.key !== j.key));
                    }}
                    data-testid="admission-remove"
                  >
                    {t('members.list.menu.remove')}
                  </Button>
                ) : null}
                <IconButton icon={X} size="sm" label={t('common.dismiss')} onClick={() => setJoined((list) => list.filter((x) => x.key !== j.key))} data-testid="admission-close" />
              </div>
            </div>
          );
        })}
      </div>
      {removing ? <RemoveDialog classId={removing.classId} className={nameOf(removing.classId)} target={removing.target} services={services} onClose={() => setRemoving(null)} /> : null}
    </>
  );
}

function isOrganiser(services: AppServices, classId: ClassId): boolean {
  try {
    return services.forClass(classId).info.detail.get().me.isOrganiser;
  } catch {
    return false;
  }
}
