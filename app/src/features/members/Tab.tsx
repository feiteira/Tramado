// The Members tab (UX §3.12.1): invite, "Ask before letting people in", people waiting to join (Let in / Not now /
// Decline), people → their computers (presence, sync state, relay, last seen, check words), organisers, the person
// menu (copy check words, make organiser, remove), unverified devices, organiser vacancy, large-class advisory,
// transcription helpers and the recording permissions (report, withdraw). Alone: "Only you." with [Invite].
import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronRight, Copy, Crown, Laptop, Monitor, MoreHorizontal, ShieldAlert, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import { checkWords } from '../../core/sync/checkWords';
import type { AppServices } from '../../services/types/common';
import type { Person } from '../../services/types/class';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Checkbox, Switch } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Badge, EmptyState, Notice } from '../../ui/components/Feedback';
import { MenuButton } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { Avatar } from '../../ui/tramado/Avatar';
import { CheckWords } from '../../ui/tramado/CheckWords';
import { PresenceDot } from '../../ui/tramado/PresenceDot';
import { presetComposerText } from '../../ui/tramado/Composer';
import { cx } from '../../ui/cx';
import { useI18n, type I18n } from '../../ui/i18n';
import { splitDeviceName } from '../sync/format';
import { deviceLine, dotOf, largeTone, organiserGone, presenceLine, type DeviceLine, type PresenceLine } from './presence';
import { RemoveDialog, type RemoveTarget } from './RemoveDialog';
import './members.css';

export default function Tab({ classId, services }: { classId: ClassId; services: AppServices }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const dialogs = useDialogs();
  const { go, replace } = useRouter();
  const cls = services.forClass(classId);
  const detail = useStore(cls.info.detail);
  const model = useStore(cls.info.model);
  const sync = useStore(services.sync.state);
  const lectures = useStore(cls.lectures.list);
  const classes = useStore(services.library.classes);
  useStore(cls.presence.others);
  useStore(services.sync.connections);
  const classView = classes.find((c) => c.id === classId);
  const className = classView?.name ?? detail.meta.name;
  const folder = sync.folders[classId];
  const me = detail.me;
  const [open, setOpen] = useState<Set<string>>(() => new Set([me.memberId]));
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const waiting = sync.joinRequests.filter((r) => r.classId === classId);
  const people = useMemo(() => [...detail.people].sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : 0)), [detail.people]);
  const gone = model.loaded && organiserGone(detail.organisers, detail.people);
  const large = largeTone(detail.people.length);
  const alone = model.loaded && detail.people.filter((p) => !p.isMe).length === 0 && detail.unverified.length === 0;

  const act = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await f();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const toggle = (memberId: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(memberId)) n.delete(memberId);
    else n.add(memberId);
    return n;
  });
  const copyWords = (p: Person) => {
    const words = p.devices.map((d) => `${d.deviceName}: ${safeWords(d.deviceId)}`).join('\n');
    void navigator.clipboard?.writeText(words).then(() => toast.show({ message: t('members.checkWords.copied'), tone: 'success' }), (e: unknown) => toast.error(e));
  };

  // Recording permissions: the newest active class-scope record and share lines (folder spec §8.5).
  const consents = model.consents.filter((c) => c.scope === 'class');
  const record = newestOf(consents.filter((c) => c.kind === 'record'));
  const share = newestOf(consents.filter((c) => c.kind === 'share'));
  const shown = newestOf([record, share].filter((x): x is NonNullable<typeof x> => !!x));
  const confirmedBy = shown ? (detail.people.find((p) => p.memberId === shown.by)?.name ?? model.former.get(shown.deviceId)?.name ?? '…') : '';
  const mayWithdraw = !!shown && (me.isOrganiser || [record, share].some((c) => c && c.by === me.memberId));

  const helpers = detail.people.filter((p) => p.devices.some((d) => d.caps.volunteer !== 'off'));
  const iAmHelper = helpers.some((p) => p.isMe);

  return (
    <section className="members" data-testid="class-members" aria-label={t('classes.tabs.members')}>
      <div className="members__top">
        <Button variant="primary" icon={UserPlus} onClick={() => dialogs.open('invite', { classId })} data-testid="members-invite">{t('members.invite.button')}</Button>
        <Switch
          className="members__ask"
          checked={detail.meta.askBeforeAdmit}
          onChange={(on) => void act('ask', () => cls.info.setMeta({ askBeforeAdmit: on }))}
          disabled={!me.isOrganiser || busy === 'ask'}
          label={t('members.list.askBefore')}
          description={me.isOrganiser ? undefined : t('members.more.askBeforeReadOnly')}
          data-testid="members-ask-before"
        />
      </div>

      {gone ? (
        <Notice
          tone="warning"
          title={t('classes.organiserGone.notice')}
          actions={<Button size="sm" busy={busy === 'become'} onClick={() => void act('become', () => cls.info.becomeOrganiser())} data-testid="members-become-organiser">{t('classes.organiserGone.action')}</Button>}
          data-testid="members-organiser-gone"
        />
      ) : null}
      {large ? <Notice tone={large} data-testid="members-large">{t('members.list.large')}</Notice> : null}

      {waiting.length ? (
        <div className="members__group" data-testid="members-waiting">
          <h3 className="members__heading">{t('members.list.waiting', { n: waiting.length })}</h3>
          <ul className="members__list">
            {waiting.map((r) => {
              const { person, device } = splitDeviceName(r.name);
              return (
                <li key={r.deviceId} className="member member--waiting" data-testid="member-waiting" data-device-id={r.deviceId}>
                  <div className="member__row">
                    <Avatar name={person} memberId={r.deviceId.replace(/-/g, '').toLowerCase().slice(0, 26)} size={28} />
                    <div className="member__who">
                      <span className="member__name">{person}</span>
                      <span className="member__sub">
                        {device ? <span>“{device}”</span> : null}
                        <span className="member__words">{t('members.checkWords.label')}: <CheckWords deviceId={r.deviceId} /></span>
                      </span>
                    </div>
                    <div className="member__actions">
                      <Button size="sm" variant="primary" busy={busy === `admit-${r.deviceId}`} onClick={() => void act(`admit-${r.deviceId}`, () => services.sync.admit(classId, r.deviceId))} data-testid="member-admit">{t('members.list.admit')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => toast.show(t('members.more.laterDone', { name: person }))} data-testid="member-later">{t('members.list.later')}</Button>
                      <Button size="sm" variant="ghost" busy={busy === `decline-${r.deviceId}`} onClick={() => void act(`decline-${r.deviceId}`, () => services.sync.decline(classId, r.deviceId))} data-testid="member-decline">{t('members.list.decline')}</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="members__group">
        <h3 className="members__heading">{t('members.list.people', { n: detail.people.length })}</h3>
        <ul className="members__list" data-testid="member-list" aria-busy={!model.loaded || undefined}>
          {people.map((p) => {
            const line = presenceLine(p, folder, lectures);
            const expanded = open.has(p.memberId);
            const organiser = detail.organisers.includes(p.memberId);
            const items = [
              { id: 'words', label: t('members.list.menu.copyWords'), icon: Copy, onSelect: () => copyWords(p), testId: 'member-copy-words' },
              ...(me.isOrganiser && !p.isMe && !organiser ? [{ id: 'org', label: t('members.list.menu.makeOrganiser'), icon: Crown, onSelect: () => void act('org', () => cls.info.setOrganiser(p.memberId, true)), testId: 'member-make-organiser' }] : []),
              ...(p.isMe && organiser ? [{ id: 'unorg', label: t('members.list.menu.stopOrganiser'), icon: Crown, onSelect: () => void act('org', () => cls.info.setOrganiser(p.memberId, false)), testId: 'member-stop-organiser' }] : []),
              ...(me.isOrganiser && !p.isMe ? [{ kind: 'separator' as const }, { id: 'remove', label: t('members.list.menu.remove'), icon: UserMinus, danger: true, onSelect: () => setRemoving({ name: p.name, memberId: p.memberId }), testId: 'member-remove' }] : []),
            ];
            return (
              <li key={p.memberId} className={cx('member', p.isMe && 'member--me')} data-testid="member-item" data-member-id={p.memberId}>
                <div className="member__row">
                  <Avatar name={p.name} memberId={p.memberId} colour={p.colour ?? undefined} size={28} presence={dotOf(line)} />
                  <div className="member__who">
                    <span className="member__name">
                      {p.isMe ? t('common.youSuffix', { name: p.name }) : p.name}
                      {organiser ? <Badge tone="info"><Crown size={11} aria-hidden strokeWidth={2} /> {t('members.list.organiser')}</Badge> : null}
                    </span>
                  </div>
                  <Presence line={line} i18n={i18n} short={classView?.shortName ?? detail.meta.shortName} />
                  <div className="member__actions">
                    {p.devices.length > 1 || !p.isMe ? (
                      <button type="button" className="member__toggle" aria-expanded={expanded} onClick={() => toggle(p.memberId)} data-testid="member-devices-toggle">
                        <ChevronRight size={14} aria-hidden strokeWidth={1.75} className="member__chevron" />
                        {tp('members.list.computers', p.devices.length)}
                      </button>
                    ) : null}
                    <MenuButton iconOnly icon={MoreHorizontal} variant="ghost" size="sm" label={t('members.more.menuLabel', { name: p.name })} items={items} align="end" data-testid="member-menu" />
                  </div>
                </div>
                {expanded || (p.isMe && p.devices.length <= 1) ? (
                  <ul className="member__devices">
                    {p.devices.map((d) => (
                      <li key={d.deviceId} className="member-device" data-testid="member-device" data-device-id={d.deviceId} tabIndex={0}>
                        {cls.presence.others.get()[d.deviceId]?.power === 'ac' ? <Monitor size={15} aria-hidden strokeWidth={1.75} /> : <Laptop size={15} aria-hidden strokeWidth={1.75} />}
                        <span className="member-device__name">
                          {d.deviceName}
                          {d.deviceId === me.deviceId ? <span className="t-muted"> {t('members.list.thisComputer')}</span> : null}
                        </span>
                        <DeviceStatus line={deviceLine(d, d.deviceId === me.deviceId, folder)} i18n={i18n} />
                        <CheckWords deviceId={d.deviceId} className="member-device__words" data-testid="member-check-words" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {detail.unverified.flatMap((u) => u.devices.map((d) => (
          <div key={d.deviceId} className="member-unverified" data-testid="member-unverified" data-device-id={d.deviceId}>
            <ShieldAlert size={16} aria-hidden strokeWidth={1.75} />
            <span>{t('members.list.unverified', { name: u.name, device: d.deviceName })}</span>
            {me.isOrganiser ? (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving({ name: d.deviceName, deviceId: d.deviceId })} data-testid="member-remove-device">{t('members.list.removeDevice')}</Button>
            ) : null}
          </div>
        )))}
        {alone ? (
          <EmptyState
            icon={Users}
            title={t('members.list.empty.title')}
            actions={<Button icon={UserPlus} onClick={() => dialogs.open('invite', { classId })} data-testid="members-empty-invite">{t('members.list.empty.action')}</Button>}
            data-testid="members-empty"
          >
            {t('members.list.empty.body')}
          </EmptyState>
        ) : null}
      </div>

      <div className="members__group" data-testid="members-helpers">
        <h3 className="members__heading">{t('members.list.helpers')}</h3>
        {helpers.length ? (
          <ul className="members__helpers">
            {helpers.map((p) => {
              const d = p.devices.find((x) => x.caps.volunteer !== 'off')!;
              const when = d.caps.volunteer === 'always' ? t('members.list.helperWhen.always') : t('members.list.helperWhen.plugged');
              const modelText = d.caps.localModel ? modelName(d.caps.localModel.id, t) : d.caps.cloud ? t('members.more.helperCloud') : t('members.list.helperNoModel');
              return <li key={p.memberId} data-testid="members-helper" data-member-id={p.memberId}>{t('members.list.helperLine', { name: p.isMe ? t('common.youSuffix', { name: p.name }) : p.name, when, model: modelText })}</li>;
            })}
          </ul>
        ) : <p className="t-muted t-small">{t('members.more.noHelpers')}</p>}
        {!iAmHelper ? (
          <button type="button" className="members__link" onClick={() => go({ name: 'settings', section: 'transcription' })} data-testid="members-become-helper">{t('members.list.becomeHelper')}</button>
        ) : null}
      </div>

      <div className="members__group" data-testid="members-consent">
        <h3 className="members__heading">{t('members.list.consent')}</h3>
        {shown ? (
          <p className="members__consent" data-testid="members-consent-line">
            {t('members.list.consentLine', {
              record: record ? t('members.list.allowed') : t('members.list.notAllowed'),
              share: share ? t('members.list.allowed') : t('members.list.notAllowed'),
              name: confirmedBy, date: i18n.date(DateTime.fromMillis(shown.ms)),
            })}
          </p>
        ) : <p className="t-muted t-small" data-testid="members-consent-none">{t('members.list.consentNone')}</p>}
        <div className="members__consent-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              presetComposerText('chat-composer', t('members.list.reportDraft'));
              replace({ name: 'class', classId, tab: 'chat' });
            }}
            data-testid="members-consent-report"
          >
            {t('members.list.report')}
          </Button>
          {mayWithdraw ? <Button size="sm" variant="ghost" onClick={() => setWithdrawing(true)} data-testid="members-consent-withdraw">{t('members.list.withdraw')}</Button> : null}
        </div>
      </div>

      {removing ? <RemoveDialog classId={classId} className={className} target={removing} services={services} onClose={() => setRemoving(null)} /> : null}
      {withdrawing ? (
        <WithdrawDialog
          className={className}
          onClose={() => setWithdrawing(false)}
          onConfirm={async (alsoDelete) => {
            for (const c of [record, share]) if (c) await cls.info.consent.revoke({ deviceId: c.deviceId, id: c.id });
            if (alsoDelete) {
              for (const l of lectures) if (l.audio?.present) await cls.lectures.deleteAudio(l.id).catch(() => undefined);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function Presence({ line, i18n, short }: { line: PresenceLine; i18n: I18n; short: string }) {
  const { t } = i18n;
  let text: string;
  switch (line.key) {
    case 'members.list.presence.recording': text = t(line.key, { class: short }); break;
    case 'members.list.presence.transcribing': text = t(line.key, { lecture: line.lecture, p: line.p }); break;
    case 'members.list.presence.editing': text = t(line.key, { note: line.note }); break;
    case 'members.list.presence.onlineSyncing': text = t(line.key, { p: line.p }); break;
    case 'members.list.presence.lastSeen': text = t(line.key, { when: whenText(line.when, i18n) }); break;
    default: text = t(line.key);
  }
  return (
    <span className={cx('member__presence', `member__presence--${line.state}`)} data-testid="member-presence" data-state={line.state}>
      <PresenceDot state={dotOf(line)} label={t(`members.dot.${dotOf(line)}`)} />
      <span>{text}</span>
    </span>
  );
}

function DeviceStatus({ line, i18n }: { line: DeviceLine; i18n: I18n }) {
  const { t } = i18n;
  let text: string;
  switch (line.key) {
    case 'members.more.syncingFiles': text = i18n.tp('members.more.syncingFiles', line.n); break;
    case 'members.list.device.offline': text = t(line.key, { when: whenText(line.when, i18n) }); break;
    default: text = t(line.key);
  }
  return <span className={cx('member-device__status', line.key === 'members.list.device.relay' && 'member-device__status--relay')} data-testid="member-device-status">{text}</span>;
}

/** "today, 12:25", "3 days ago". */
function whenText(iso: string, i18n: I18n): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return '—';
  const days = Math.round(DateTime.now().startOf('day').diff(dt.startOf('day'), 'days').days);
  if (days === 0) return `${i18n.t('common.relative.today')}, ${i18n.time(dt)}`;
  return i18n.relative(iso);
}

function WithdrawDialog({ className, onClose, onConfirm }: { className: string; onClose(): void; onConfirm(alsoDelete: boolean): Promise<void> }) {
  const { t } = useI18n();
  const toast = useToast();
  const [alsoDelete, setAlsoDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={t('members.list.withdrawConfirm.title')}
      onSubmit={() => {
        setBusy(true);
        void onConfirm(alsoDelete).then(onClose, (e: unknown) => {
          toast.error(e);
          setBusy(false);
        });
      }}
      data-testid="members-withdraw-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus data-testid="members-withdraw-cancel">{t('common.cancel')}</Button>
          <Button type="submit" variant="danger" busy={busy} data-testid="members-withdraw-confirm">{t('members.list.withdrawConfirm.confirm')}</Button>
        </>
      }
    >
      <p className="t-secondary">{t('members.list.withdrawConfirm.body', { class: className })}</p>
      <Checkbox checked={alsoDelete} onChange={setAlsoDelete} label={t('members.list.withdrawConfirm.alsoDelete')} data-testid="members-withdraw-delete" />
    </Dialog>
  );
}

function newestOf<T extends { ms: number }>(xs: T[]): T | null {
  return xs.reduce<T | null>((a, b) => (!a || b.ms > a.ms ? b : a), null);
}

const safeWords = (deviceId: string) => {
  try {
    return checkWords(deviceId);
  } catch {
    return '—';
  }
};

function modelName(id: string, t: I18n['t']): string {
  if (id === 'turbo') return t('members.more.helperModel.turbo');
  if (id === 'small') return t('members.more.helperModel.small');
  if (id === 'large-v3') return t('members.more.helperModel.large');
  return id;
}
