// The class screen frame (UX §3.3.2): the header in the class colour (40 px mark, the h1, lecturer · term · members
// · sync status), its actions (Invite/Share, Record lecture, Add ▾, ⋯), the countdown chips, the newer-format
// notice, then the tabs of CLASS_TABS (Share replaces Chat and Members while unshared) — or the folder-missing card
// of CLASS_STATES in their place. Also the "Invite classmates" card above the Lectures tab of a new shared class and
// the drop target (documents are UI-DOCS's own drop; Exams and Lectures drops open their dialogs).
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  Archive, ArchiveRestore, AudioLines, CalendarDays, CircleDot, ClipboardCheck, Ellipsis, FileAudio, FilePlus2, Files, FolderOpen, FolderSync, LogOut,
  MessagesSquare, NotebookPen, Plus, Settings2, Sparkles, Trash2, Undo2, UserPlus, Users, X, type LucideIcon,
} from 'lucide-react';
import type { AppServices } from '../../services/types/common';
import type { ClassView } from '../../services/types/viewModels';
import { ACTIONS, CLASS_TABS, CLASS_STATES } from '../registry';
import type { ClassTabId, Route } from '../../shell/routes';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { useAppState } from '../../shell/AppState';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { Missing } from '../../shell/Placeholder';
import { NewerFormatNotice } from '../../shell/NewerFormat';
import { classLine } from '../../shell/SyncPill';
import { tabsOf } from '../../shell/classTabs';
import { Button, IconButton } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Badge, Spinner } from '../../ui/components/Feedback';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { Tabs } from '../../ui/components/Tabs';
import { Tooltip } from '../../ui/components/Tooltip';
import { useToast } from '../../ui/components/Toast';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { CountdownChip } from '../../ui/tramado/CountdownChip';
import { DropOverlay } from '../../ui/tramado/DropOverlay';
import { Avatar } from '../../ui/tramado/Avatar';
import { classStyle } from '../../ui/classColor';
import { useI18n } from '../../ui/i18n';
import './class.css';

type TabComponent = React.LazyExoticComponent<React.ComponentType<{ classId: string; services: AppServices }>>;
const lazyTabs = Object.fromEntries(Object.entries(CLASS_TABS).map(([k, v]) => [k, lazy(v)])) as Record<ClassTabId, TabComponent>;
const FolderMissing = lazy(CLASS_STATES.folderMissing);

const TAB_ICONS: Record<ClassTabId, LucideIcon> = {
  lectures: AudioLines, documents: Files, notes: NotebookPen, exams: ClipboardCheck, chat: MessagesSquare, ask: Sparkles, members: Users, share: FolderSync,
};
const AUDIO_VIDEO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4|m4v|mov|mkv|avi|wma|amr|3gp)$/i;

interface Counts { lectures: number; documents: number; exams: number; people: Array<{ memberId: string; name: string; colour: string | null; online: boolean }> }

/** Per-class numbers for the tab badges and the header's avatar stack. */
function useCounts(services: AppServices, classId: string | null): Counts {
  const [c, setC] = useState<Counts>({ lectures: 0, documents: 0, exams: 0, people: [] });
  useEffect(() => {
    if (!classId) return undefined;
    let s: ReturnType<AppServices['forClass']>;
    try {
      s = services.forClass(classId);
    } catch {
      return undefined;
    }
    const read = () => {
      let exams = 0;
      try {
        const l = s.exams.list.get();
        exams = l.dates.length + l.papers.length;
      } catch {
        exams = 0;
      }
      const people = s.info.detail.get().people.map((p) => ({ memberId: p.memberId, name: p.name, colour: p.colour, online: p.isMe || p.devices.some((d) => d.online) }));
      setC({ lectures: s.lectures.list.get().length, documents: s.documents.list.get().filter((d) => !d.lectureId && !d.examId).length, exams, people });
    };
    read();
    const offs = [s.lectures.list.subscribe(read), s.documents.list.subscribe(read), s.info.detail.subscribe(read)];
    try {
      offs.push(s.exams.list.subscribe(read));
    } catch {
      // exams not available
    }
    return () => offs.forEach((o) => o());
  }, [services, classId]);
  return c;
}

export default function ClassScreen({ route, services }: { route: Extract<Route, { name: 'class' }>; services: AppServices }) {
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === route.classId);
  if (!cls) return <Missing what="class" />;
  return <ClassFrame key={cls.id} cls={cls} route={route} services={services} />;
}

function ClassFrame({ cls, route, services }: { cls: ClassView; route: Extract<Route, { name: 'class' }>; services: AppServices }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { replace } = useRouter();
  const dialogs = useDialogs();
  const toast = useToast();
  const app = useAppState();
  const recording = useStore(services.recording.state);
  const counts = useCounts(services, cls.id);
  const tabs = useMemo(() => tabsOf(cls.shared), [cls.shared]);
  const tab: ClassTabId = route.tab && tabs.includes(route.tab) ? route.tab : 'lectures';
  const TabView = lazyTabs[tab];
  const now = DateTime.fromMillis(services.ctx.clock.now());
  const recordingHere = recording !== null;
  const recordingClass = recording ? services.library.classes.get().find((c) => c.id === recording.classId)?.shortName ?? '' : '';
  const missingFolder = cls.sync.kind === 'missingFolder';

  const archive = async (on: boolean) => {
    try {
      await services.library.archive(cls.id, on);
      toast.show({
        message: t(on ? 'classes.archived' : 'classes.unarchived', { class: cls.shortName }),
        action: { label: t('common.undo'), run: () => services.library.archive(cls.id, !on), testId: 'toast-undo' },
      });
    } catch (e) {
      toast.error(e);
    }
  };
  const runAction = (load: () => Promise<{ default: (s: AppServices, classId: string) => Promise<void> }>, fallback: ClassTabId) =>
    void load()
      .then((m) => m.default(services, cls.id))
      .catch((e: unknown) => {
        // A screen not built yet answers NOT_IMPLEMENTED: open its tab instead of failing silently.
        if ((e as { code?: string })?.code === 'NOT_IMPLEMENTED') replace({ name: 'class', classId: cls.id, tab: fallback });
        else toast.error(e);
      });

  const addItems: MenuEntry[] = [
    { id: 'documents', label: t('classes.header.addDocuments'), icon: FilePlus2, onSelect: () => runAction(ACTIONS.importDocuments, 'documents'), testId: 'class-add-documents' },
    { id: 'recording', label: t('classes.header.addRecording'), icon: FileAudio, onSelect: () => dialogs.open('import', { classId: cls.id }), testId: 'class-add-recording' },
    { id: 'exam-date', label: t('classes.header.addExamDate'), icon: CalendarDays, onSelect: () => dialogs.open('exam-date', { classId: cls.id }), testId: 'class-add-exam-date' },
    { id: 'exam-paper', label: t('classes.header.addExamPaper'), icon: ClipboardCheck, onSelect: () => dialogs.open('exam-paper', { classId: cls.id }), testId: 'class-add-exam-paper' },
    { kind: 'separator' },
    { id: 'note', label: t('classes.header.addNote'), icon: NotebookPen, onSelect: () => runAction(ACTIONS.newNote, 'notes'), testId: 'class-add-note' },
    ...(cls.shared ? [{ id: 'class-note', label: t('classes.header.addClassNote'), icon: NotebookPen, onSelect: () => replace({ name: 'class', classId: cls.id, tab: 'notes' }), testId: 'class-add-class-note' }] : []),
  ];
  const notifyItems: MenuEntry[] = (['important', 'all', 'none'] as const).map((v) => ({
    id: `notify-${v}`, label: t(`classes.header.notify.${v}`), checked: cls.notify === v, onSelect: () => void app.setPref(`notify.class.${cls.id}`, v), testId: `class-notify-${v}`,
  }));
  const moreItems: MenuEntry[] = [
    { id: 'settings', label: t('classes.header.more.settings'), icon: Settings2, onSelect: () => dialogs.open('class-settings', { classId: cls.id }), testId: 'class-open-settings' },
    cls.shared
      ? { id: 'invite', label: t('classes.header.more.invite'), icon: UserPlus, onSelect: () => dialogs.open('invite', { classId: cls.id }), testId: 'class-more-invite' }
      : { id: 'share', label: t('classes.header.more.share'), icon: FolderSync, onSelect: () => replace({ name: 'class', classId: cls.id, tab: 'share' }), testId: 'class-more-share' },
    { kind: 'heading', id: 'notify-heading', label: t('classes.header.more.notifications') },
    ...notifyItems,
    { kind: 'separator' },
    ...(cls.shared ? [{ id: 'deleted', label: t('classes.header.more.recentlyDeleted'), icon: Undo2, onSelect: () => dialogs.open('recently-deleted', { classId: cls.id }), testId: 'class-recently-deleted' }] : []),
    { id: 'folder', label: t('classes.header.more.openFolder'), icon: FolderOpen, onSelect: () => void services.ctx.platform.classes.reveal(cls.id).catch((e: unknown) => toast.error(e)), testId: 'class-open-folder' },
    cls.archived
      ? { id: 'unarchive', label: t('classes.header.more.unarchive'), icon: ArchiveRestore, onSelect: () => void archive(false), testId: 'class-archive' }
      : { id: 'archive', label: t('classes.header.more.archive'), icon: Archive, onSelect: () => void archive(true), testId: 'class-archive' },
    { kind: 'separator' },
    cls.shared
      ? { id: 'leave', label: t('classes.header.more.leave'), icon: LogOut, danger: true, onSelect: () => dialogs.open('leave', { classId: cls.id }), testId: 'class-more-leave' }
      : { id: 'delete', label: t('classes.header.more.delete'), icon: Trash2, danger: true, onSelect: () => dialogs.open('class-settings', { classId: cls.id }), testId: 'class-more-delete' },
  ];

  const meta: React.ReactNode[] = [];
  if (cls.lecturer) meta.push(<span key="lecturer">{cls.lecturer}</span>);
  if (cls.term) meta.push(<span key="term">{cls.term}</span>);
  if (cls.shared) {
    meta.push(
      <span key="members" className="class-header__members" data-testid="class-members-count">
        <span className="class-header__avatars" aria-hidden>
          {counts.people.slice(0, 4).map((p) => (
            <Avatar key={p.memberId} name={p.name} memberId={p.memberId} colour={p.colour ?? undefined} size={24} />
          ))}
        </span>
        {tp('classes.header.members', cls.memberCount)}
      </span>,
    );
    meta.push(<span key="sync" className="class-header__sync">{classLine(cls, i18n)}</span>);
  } else {
    meta.push(<span key="local" className="class-header__sync">{t('common.onlyThisComputer')}</span>);
  }

  const chatBadge = cls.unread > 0 || cls.mentions > 0 ? (
    <>
      <Badge tone={cls.mentions > 0 ? 'info' : 'neutral'}>{cls.unread > 99 ? '99+' : cls.unread || cls.mentions}</Badge>
      <span className="visually-hidden">, {cls.mentions > 0 ? tp('app.rail.classStatus.mentions', cls.mentions) : tp('app.rail.classStatus.unread', cls.unread)}</span>
    </>
  ) : undefined;
  const count = (n: number) => (n > 0 ? <Badge tone="neutral">{n}</Badge> : undefined);
  const badgeOf = (id: ClassTabId) =>
    id === 'lectures' ? count(counts.lectures) : id === 'documents' ? count(counts.documents) : id === 'exams' ? count(counts.exams) : id === 'chat' ? chatBadge : id === 'members' ? count(cls.memberCount) : undefined;

  return (
    <div className="class-screen" data-testid="screen-class" data-class-id={cls.id} data-tab={tab}>
      <ScreenHeader title={cls.name} hideTitle />
      <header className="cls-scope class-header" style={classStyle(cls.color)}>
        <ClassTab color={cls.color} icon={cls.icon} size="lg" filled />
        <div className="class-header__titles">
          <h1 className="class-header__title" tabIndex={-1} data-testid="class-title">{cls.name}</h1>
          <p className="class-header__meta">
            {meta.map((m, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <span className="class-header__dot" aria-hidden>·</span> : null}
                {m}
              </React.Fragment>
            ))}
          </p>
        </div>
        <div className="class-header__actions">
          {cls.shared ? (
            <Button icon={UserPlus} onClick={() => dialogs.open('invite', { classId: cls.id })} data-testid="class-invite">{t('classes.header.invite')}</Button>
          ) : (
            <Button icon={FolderSync} onClick={() => replace({ name: 'class', classId: cls.id, tab: 'share' })} data-testid="class-share-open">{t('classes.header.share')}</Button>
          )}
          {recordingHere ? (
            <Tooltip label={t('classes.header.recordBusy', { class: recordingClass })}>
              <span className="class-header__busy" tabIndex={0} aria-label={t('classes.header.recordBusy', { class: recordingClass })}>
                <Button variant="primary" icon={CircleDot} disabled data-testid="record-class">{t('classes.header.record')}</Button>
              </span>
            </Tooltip>
          ) : (
            <Button variant="primary" icon={CircleDot} disabled={cls.archived || missingFolder} onClick={() => dialogs.open('record', { classId: cls.id })} data-testid="record-class">
              {t('classes.header.record')}
            </Button>
          )}
          <MenuButton label={t('classes.header.add')} icon={Plus} items={addItems} disabled={missingFolder} align="end" data-testid="class-add" />
          <MenuButton label={t('app.header.more')} icon={Ellipsis} iconOnly items={moreItems} align="end" data-testid="class-more" />
        </div>
        {cls.nextExams.length ? (
          <div className="class-header__chips" aria-label={t('today.exams.title')}>
            {cls.nextExams.slice(0, 3).map((e) => (
              <CountdownChip key={e.examId} exam={e} now={now} onClick={() => replace({ name: 'class', classId: cls.id, tab: 'exams' })} data-testid="class-countdown" />
            ))}
          </div>
        ) : null}
      </header>
      {cls.newerFormat ? <NewerFormatNotice /> : null}
      {missingFolder ? (
        <div className="class-missing">
          <Suspense fallback={<Spinner />}>
            <FolderMissing classId={cls.id} services={services} />
          </Suspense>
        </div>
      ) : (
        <ClassTabs cls={cls} tab={tab} tabs={tabs} badgeOf={badgeOf} services={services} TabView={TabView} onTab={(v) => replace({ name: 'class', classId: cls.id, tab: v })} />
      )}
    </div>
  );
}

function ClassTabs({
  cls, tab, tabs, badgeOf, services, TabView, onTab,
}: {
  cls: ClassView; tab: ClassTabId; tabs: ClassTabId[]; badgeOf(id: ClassTabId): React.ReactNode; services: AppServices; TabView: TabComponent; onTab(v: ClassTabId): void;
}) {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const [drag, setDrag] = useState<'documents' | 'exam' | 'lecture' | null>(null);
  const depth = useRef(0);
  const host = useRef<HTMLDivElement>(null);

  // Drops (UX §3.3.2): the Documents tab handles its own (UI-DOCS, with its folder); on Exams a file becomes an exam
  // paper, on Lectures audio and video become a recording, anything else goes to Documents.
  const targetFor = (names: string[], types: string[]): 'documents' | 'exam' | 'lecture' => {
    if (tab === 'exams') return 'exam';
    if (tab === 'lectures' && (types.some((m) => m.startsWith('audio/') || m.startsWith('video/')) || names.some((n) => AUDIO_VIDEO.test(n)))) return 'lecture';
    return 'documents';
  };
  useEffect(
    () =>
      services.ctx.platform.events.onDrop((e) => {
        setDrag(null);
        depth.current = 0;
        if (tab === 'documents' || !e.picked.length || cls.archived) return;
        const el = host.current?.getBoundingClientRect();
        if (el && (e.x < el.left || e.x > el.right || e.y < el.top || e.y > el.bottom)) return;
        const target = targetFor(e.picked.map((p) => p.name), []);
        if (target === 'exam') dialogs.open('exam-paper', { classId: cls.id, picked: e.picked });
        else if (target === 'lecture') dialogs.open('import', { classId: cls.id, picked: e.picked });
        else void services.forClass(cls.id).documents.import(e.picked).catch(() => undefined);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, tab, cls.id, cls.archived, dialogs],
  );
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');
  const dragHandlers = tab === 'documents' || cls.archived ? {} : {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDrag(targetFor([], [...e.dataTransfer.items].map((i) => i.type)));
    },
    onDragOver: (e: React.DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDrag(null);
    },
    onDrop: (e: React.DragEvent) => {
      // The desktop delivers the files through platform.events.onDrop (pick tokens, D-4); the browser demo has none.
      e.preventDefault();
      depth.current = 0;
      setDrag(null);
    },
  };

  return (
    <div ref={host} className="cls-scope class-tabs-host" style={classStyle(cls.color)} {...dragHandlers}>
      <Tabs
        label={t('classes.tabs.label')}
        value={tab}
        onChange={onTab}
        items={tabs.map((id) => {
          const Icon = TAB_ICONS[id];
          return {
            value: id,
            label: (
              <>
                <Icon size={17} strokeWidth={1.75} aria-hidden />
                <span>{t(`classes.tabs.${id}`)}</span>
              </>
            ),
            badge: badgeOf(id),
          };
        })}
        className="class-tabs"
        data-testid="class-tabs"
      >
        {tab === 'lectures' && cls.shared && cls.memberCount <= 1 ? <InviteCard cls={cls} services={services} /> : null}
        <Suspense fallback={<div className="class-tabs-host__loading"><Spinner /></div>}>
          <TabView key={`${cls.id}:${tab}`} classId={cls.id} services={services} />
        </Suspense>
      </Tabs>
      {drag ? <DropOverlay classId={cls.id} target={drag} classLabel={cls.shortName} className="class-drop" data-testid="drop-overlay" /> : null}
    </div>
  );
}

/** "Invite your classmates" (UX §3.3.1) above the Lectures tab while nobody else is in the class; dismissible. */
function InviteCard({ cls, services }: { cls: ClassView; services: AppServices }) {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void services
      .forClass(cls.id)
      .info.uiState()
      .then((s) => live && setHidden(s.inviteCardDismissed === true), () => live && setHidden(false));
    return () => {
      live = false;
    };
  }, [services, cls.id]);
  if (hidden !== false) return null;
  return (
    <section className="invite-card" aria-labelledby="invite-card-title" data-testid="class-invite-card">
      <span className="invite-card__icon" aria-hidden>
        <UserPlus size={20} strokeWidth={1.75} />
      </span>
      <div className="invite-card__text">
        <h2 id="invite-card-title" className="invite-card__title">{t('classes.inviteCard.title')}</h2>
        <p className="invite-card__body">{t('classes.inviteCard.body')}</p>
      </div>
      <Button variant="primary" icon={UserPlus} onClick={() => dialogs.open('invite', { classId: cls.id })} data-testid="class-invite-card-action">
        {t('classes.inviteCard.action')}
      </Button>
      <IconButton
        icon={X}
        size="sm"
        label={t('common.dismiss')}
        onClick={() => {
          setHidden(true);
          void services.forClass(cls.id).info.setUiState({ inviteCardDismissed: true }).catch(() => undefined);
        }}
        data-testid="class-invite-card-dismiss"
      />
    </section>
  );
}

