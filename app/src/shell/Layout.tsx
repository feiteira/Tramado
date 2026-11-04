// The ready phase's frame (UX §2.2): rail + main (example ribbon, the screen from SCREENS, the dock), the dialog
// host (DIALOGS), the overlay host (OVERLAYS), the palette (PALETTE_PROVIDERS), the global keys of UX §2.10, the
// palette commands of UX §2.9, the window title, and the window's life (close, tray, background mode; D48).
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  AudioLines, ClipboardCheck, Copy, Files, FilePlus2, FolderSync, GraduationCap, Keyboard, Languages, LogIn, LogOut, MessagesSquare, Moon, NotebookPen, Pause,
  Play, Plus, Settings, Sparkles, Square, Sun, SunMoon, UserPlus, Users, CircleDot, CalendarDays, CirclePause, CircleCheck,
} from 'lucide-react';
import { UI_LOCALES, UI_LOCALE_META } from '../core/i18n/languages';
import type { AppServicesImpl } from '../services/index';
import type { AppServices } from '../services/types/common';
import type { MarkerKind } from '../services/types/viewModels';
import { ACTIONS, DIALOGS, OVERLAYS, PALETTE_PROVIDERS, SCREENS, type DialogId } from '../features/registry';
import Onboarding from '../features/onboarding/index';
import { Button } from '../ui/components/Button';
import { classIconComponent } from '../ui/tramado/ClassTab';
import { useConfirm } from '../ui/components/Confirm';
import { Spinner } from '../ui/components/Feedback';
import { useToast } from '../ui/components/Toast';
import { useI18n, type I18n } from '../ui/i18n';
import { NARROW_RAIL, useMediaQuery } from '../ui/media';
import { isTextEntry, modalOpen } from '../ui/focus';
import { cx } from '../ui/cx';
import { watchBack } from './activity.web';
import { arriveFocus } from './arrival';
import { useAppState } from './AppState';
import { CommandPalette, type PaletteProvider } from './CommandPalette';
import type { Command } from './commands';
import { diagnosticsText } from './diagnostics';
import { Dock } from './Dock';
import { ErrorBoundary } from './ErrorBoundary';
import { globalAction } from './globalKeys';
import { Missing, missingKindOf } from './Placeholder';
import { Rail } from './Rail';
import { noteRecent, forgetRecentOf } from './recent';
import { useRouter } from './router';
import { SETTINGS_SECTIONS, type ClassTabId, type Route } from './routes';
import { useCommands } from './useCommands';
import { useDialogs } from './useDialogs';
import { useStore } from './useStore';
import { useKeyLabel } from './keys';
import { tabsOf } from './classTabs';
import './shell.css';

type AnyScreen = ComponentType<{ route: Route; services: AppServices }>;
type AnyDialog = ComponentType<{ props: unknown; services: AppServices; close(): void }>;

const screens = Object.fromEntries(Object.entries(SCREENS).map(([k, v]) => [k, lazy(v as () => Promise<{ default: AnyScreen }>)])) as Record<Route['name'], React.LazyExoticComponent<AnyScreen>>;
const dialogs = Object.fromEntries(Object.entries(DIALOGS).map(([k, v]) => [k, lazy(v as () => Promise<{ default: AnyDialog }>)])) as Record<DialogId, React.LazyExoticComponent<AnyDialog>>;
const overlays = OVERLAYS.map((l) => lazy(l));

const COLLAPSED_KEY = 'tramado.rail.collapsed';
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

const TAB_OF_ROUTE = { lecture: 'lectures', document: 'documents', note: 'notes', exam: 'exams', practice: 'exams' } as const;
const MARKER_KEYS: ReadonlyArray<[Exclude<MarkerKind, 'note'>, string]> = [['important', '1'], ['confused', '2'], ['exam', '3'], ['todo', '4']];
const TAB_ICON: Record<ClassTabId, typeof AudioLines> = {
  lectures: AudioLines, documents: Files, notes: NotebookPen, exams: ClipboardCheck, chat: MessagesSquare, ask: Sparkles, members: Users, share: FolderSync,
};

/** The screen word of the window title (UX §2.1). */
export function screenName(route: Route, { t }: Pick<I18n, 't'>): string {
  switch (route.name) {
    case 'today':
      return t('app.rail.today');
    case 'settings':
      return t('settings.title');
    case 'ask':
      return t('classes.tabs.ask');
    case 'class':
      return t(`classes.tabs.${route.tab ?? 'lectures'}`);
    default:
      return t(`classes.tabs.${TAB_OF_ROUTE[route.name]}`);
  }
}


function ScreenHost({ services }: { services: AppServicesImpl }) {
  const { route, routeKey, takeReturnFocus } = useRouter();
  const classes = useStore(services.library.classes);
  const classId = 'classId' in route ? route.classId : null;
  // Focus: the new screen's h1 on arrival, or back where it was when returning (UX §6 keyboard).
  useEffect(() => {
    arriveFocus({ scope: '.shell__screen', restore: takeReturnFocus(routeKey) });
  }, [routeKey, takeReturnFocus]);
  // A route whose class is gone shows the Missing state, never a crash (UX §2.1). The class screen
  // handles its own (it also shows the folder-missing card).
  if (classId && route.name !== 'class' && !classes.some((c) => c.id === classId)) return <Missing what={missingKindOf(route)} />;
  const Screen = screens[route.name];
  const key = `${route.name}:${classId ?? ''}`;
  return (
    <ErrorBoundary key={key}>
      <Suspense fallback={<div className="shell__loading"><Spinner /></div>}>
        <Screen route={route} services={services} />
      </Suspense>
    </ErrorBoundary>
  );
}

function DialogHost({ services }: { services: AppServicesImpl }) {
  const { current, close } = useDialogs();
  if (!current) return null;
  const D = dialogs[current.id];
  return (
    <ErrorBoundary key={current.key}>
      <Suspense fallback={null}>
        <D key={current.key} props={current.props} services={services} close={close} />
      </Suspense>
    </ErrorBoundary>
  );
}

function OverlayHost({ services }: { services: AppServicesImpl }) {
  return (
    <>
      {overlays.map((O, i) => (
        <ErrorBoundary key={i} quiet>
          <Suspense fallback={null}>
            <O services={services} />
          </Suspense>
        </ErrorBoundary>
      ))}
    </>
  );
}

function useProviders(services: AppServicesImpl): PaletteProvider[] {
  const [list, setList] = useState<PaletteProvider[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(PALETTE_PROVIDERS.map((l) => l().then((m) => m.default(services)))).then((ps) => live && setList(ps), () => undefined);
    return () => {
      live = false;
    };
  }, [services]);
  return list;
}

/** Layout: the shell, or the rest of onboarding (steps 3–4) right after the services started (UX §3.1). */
export function Layout({ services }: { services: AppServicesImpl }) {
  const app = useAppState();
  const dialogsApi = useDialogs();
  if (app.onboarding) {
    return (
      <Onboarding
        services={services}
        onFinish={(then) => {
          app.endOnboarding();
          if (then === 'create') dialogsApi.open('new-class', {});
          else if (then === 'join') dialogsApi.open('join', {});
        }}
      />
    );
  }
  return <Shell services={services} />;
}

function Shell({ services }: { services: AppServicesImpl }) {
  const i18n = useI18n();
  const { t } = i18n;
  const app = useAppState();
  const { platform } = services.ctx;
  const { route, go, back, canGoBack } = useRouter();
  const dialogsApi = useDialogs();
  const confirm = useConfirm();
  const toast = useToast();
  const key = useKeyLabel();
  const classes = useStore(services.library.classes);
  const recording = useStore(services.recording.state);
  const sync = useStore(services.sync.state);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const narrowWindow = useMediaQuery(NARROW_RAIL);
  const narrow = collapsed || narrowWindow;
  const [palette, setPalette] = useState(false);
  const providers = useProviders(services);
  const [version, setVersion] = useState('');
  const classId = 'classId' in route ? route.classId : null;
  const cls = classId ? classes.find((c) => c.id === classId) ?? null : null;
  const active = useMemo(() => classes.filter((c) => !c.archived), [classes]);
  const mainRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void platform.info().then((i) => setVersion(i.version), () => undefined);
  }, [platform]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // per-viewer convenience only
      }
      return !c;
    });
  }, []);

  // Window title: "{screen} · {class short name} · Tramado" (UX §2.1).
  useEffect(() => {
    const screen = screenName(route, i18n);
    const title = cls ? t('app.windowTitle', { screen, class: cls.shortName }) : t('app.windowTitleShort', { screen });
    document.title = title;
    void platform.window.setTitle(title).catch(() => undefined);
  }, [route, cls, i18n, t, platform]);

  // The last class opened (Today's checklist acts in it), and the palette's Recent items (UX §3.13).
  useEffect(() => {
    if (classId && cls && services.ctx.prefs.get('classes.last') !== classId) void app.setPref('classes.last', classId);
    if (route.name === 'lecture' || route.name === 'document' || route.name === 'note' || route.name === 'exam') {
      // The title is the new screen's h1, read once it has rendered.
      const timer = setTimeout(() => {
        const h1 = document.querySelector<HTMLElement>('.shell__screen h1');
        const label = h1?.textContent?.trim();
        if (!label || document.querySelector('[data-testid="missing-item"]')) return;
        const keyOf = route.name === 'lecture' ? route.lectureId : route.name === 'exam' ? route.examId : route.relPath;
        noteRecent({ key: `${route.name}:${route.classId}:${keyOf}`, label: label.slice(0, 120), kind: route.name, route: { name: route.name, classId: route.classId, ...(route.name === 'lecture' ? { lectureId: route.lectureId } : route.name === 'exam' ? { examId: route.examId } : route.name === 'note' ? { relPath: route.relPath, private: route.private } : { relPath: route.relPath }) } });
      }, 600);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, classId, cls?.id]);
  useEffect(() => {
    const ids = new Set(classes.map((c) => c.id));
    try {
      for (const r of JSON.parse(localStorage.getItem('tramado.palette.recent') ?? '[]') as Array<{ route?: { classId?: string } }>) {
        const id = r.route?.classId;
        if (id && !ids.has(id)) forgetRecentOf(id);
      }
    } catch {
      // per-viewer convenience only
    }
  }, [classes]);

  // Recording: Ctrl/⌘+Shift+R and the palette (UX §2.10): start (the Record dialog for this class, or it asks
  // which), or stop and open the Save dialog.
  const toggleRecording = useCallback(async () => {
    const rec = services.recording.state.get();
    if (rec && rec.status.state !== 'stopping') {
      const finished = await services.recording.stop();
      dialogsApi.open('save', { recording: finished });
    } else {
      dialogsApi.open('record', classId && classes.some((c) => c.id === classId && !c.archived) ? { classId } : {});
    }
  }, [services, dialogsApi, classId, classes]);

  const copyDiagnostics = useCallback(async () => {
    const text = await diagnosticsText(services);
    await navigator.clipboard.writeText(text);
    toast.show({ message: t('settings.about.diagnosticsCopied'), tone: 'success' });
  }, [services, toast, t]);

  // Global keys (UX §2.10). Screens own 1–4, N, Space, Ctrl/⌘+F, Ctrl/⌘+Enter; Undo/Redo is UndoProvider's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = globalAction(e, { inText: isTextEntry(e.target), overModal: palette || modalOpen() });
      if (!action || action.kind === 'back') return;
      e.preventDefault();
      switch (action.kind) {
        case 'palette':
          setPalette(true);
          return;
        case 'record':
          void toggleRecording().catch((err: unknown) => toast.error(err));
          return;
        case 'settings':
          go({ name: 'settings' });
          return;
        case 'today':
          go({ name: 'today' });
          return;
        case 'join':
          dialogsApi.open('join', {});
          return;
        case 'shortcuts':
          dialogsApi.open('shortcuts', {});
          return;
        case 'class': {
          const c = active[action.n - 1];
          if (c) go({ name: 'class', classId: c.id });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, dialogsApi, go, active, toggleRecording, toast]);
  // Alt+← and the mouse's back button.
  useEffect(() => watchBack(() => canGoBack && !palette && back()), [back, canGoBack, palette]);

  // The window's life (architecture §4.3, D48): the first close with a shared class asks whether to keep sharing in
  // the background (UI-GROUP's first-share dialog); quitting while recording asks to stop and save first.
  const runSavers = app.runSavers;
  const setPref = app.setPref;
  const askRecording = useCallback(async (): Promise<'stay' | 'go'> => {
    const rec = services.recording.state.get();
    if (!rec) return 'go';
    const name = classes.find((c) => c.id === rec.classId)?.shortName ?? '';
    const stop = await confirm({
      title: t('app.close.recordingTitle'),
      body: t('app.close.recordingBody', { class: name }),
      confirmLabel: t('app.close.stopAndSave'),
      cancelLabel: t('app.close.keepRecording'),
      'data-testid': 'close-recording',
    });
    if (stop) {
      const finished = await services.recording.stop();
      dialogsApi.open('save', { recording: finished });
    }
    return 'stay';
  }, [services, classes, confirm, t, dialogsApi]);
  const trayNoticeShown = useRef(false);
  useEffect(() => {
    app.setCloseHook(async (decision) => {
      const shared = services.library.classes.get().filter((c) => c.shared && !c.archived);
      if (shared.length > 0 && services.ctx.prefs.get('app.trayAsked') !== '1') {
        await setPref('app.trayAsked', '1');
        dialogsApi.open('first-share', { classId: shared[0]!.id });
        return 'stay';
      }
      if (decision === 'quit') return (await askRecording()) === 'stay' ? 'stay' : 'quit';
      const rec = services.recording.state.get();
      if (rec || !trayNoticeShown.current) {
        trayNoticeShown.current = true;
        const name = rec ? classes.find((c) => c.id === rec.classId)?.shortName ?? '' : '';
        void platform.notifications
          .show({ title: 'Tramado', body: rec ? t('app.close.trayNoticeRecording', { class: name }) : t('app.close.trayNotice'), tag: 'tray' })
          .catch(() => undefined);
      }
      return 'hide';
    });
    return () => app.setCloseHook(null);
  }, [app, services, dialogsApi, askRecording, setPref, platform, classes, t]);
  // Tray menu (architecture §4.3).
  useEffect(
    () =>
      platform.events.onTray((action) => {
        if (action === 'open') void platform.window.show().catch(() => undefined);
        else if (action === 'pause-sharing' || action === 'resume-sharing') void services.sync.applySettings({ paused: action === 'pause-sharing' }).catch((e: unknown) => toast.error(e));
        else if (action === 'quit') {
          void (async () => {
            await runSavers();
            await platform.window.show().catch(() => undefined);
            if ((await askRecording()) === 'go') await platform.window.quit();
          })().catch((e: unknown) => toast.error(e));
        }
      }),
    [platform, services, runSavers, askRecording, toast],
  );
  // Rust needs to know whether closing hides to the tray (tray icon, quit on close).
  const sharedCount = classes.filter((c) => c.shared).length;
  const prefMap = useStore(services.ctx.prefs.store);
  const trayOnClose = (prefMap['app.trayOnClose'] ?? '1') === '1';
  useEffect(() => {
    void platform.window.setBackgroundMode({ trayOnClose, sharedClasses: sharedCount }).catch(() => undefined);
  }, [platform, trayOnClose, sharedCount]);

  // Toasts sit bottom-centre of main, 16 px above the dock (UX §2.8).
  useEffect(() => {
    const main = mainRef.current;
    const dock = dockRef.current;
    if (!main || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const place = () => {
      const r = main.getBoundingClientRect();
      root.style.setProperty('--toast-x', `${Math.round(r.left + r.width / 2)}px`);
      root.style.setProperty('--toast-bottom', `${Math.round((dock?.getBoundingClientRect().height ?? 0) + 16)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(main);
    if (dock) ro.observe(dock);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      root.style.removeProperty('--toast-x');
      root.style.removeProperty('--toast-bottom');
    };
  }, []);

  // The shell's palette commands (UX §2.9).
  const syncStarted = !!sync.status && sync.status.state !== 'stopped';
  const syncPaused = !!sync.status?.paused;
  const ai = useStore(services.ai.settings);
  const papers = useClassPapers(services, cls?.id ?? null);
  useCommands(
    () => {
      const nav = t('app.commands.group.navigate');
      const create = t('app.commands.group.create');
      const recG = t('app.commands.group.record');
      const view = t('app.commands.group.view');
      const appG = t('app.commands.group.app');
      const aiG = t('app.commands.group.ai');
      const list: Command[] = [
        { id: 'go-today', label: t('app.commands.goToday'), group: nav, icon: Sun, shortcut: key('H', { shift: true }), run: () => go({ name: 'today' }) },
        ...active.map((c, i) => ({ id: `go-class-${c.id}`, label: t('app.commands.goClass', { class: c.name }), group: nav, icon: classIconComponent(c.icon), keywords: [c.shortName], ...(i < 9 ? { shortcut: key(String(i + 1)) } : {}), run: () => go({ name: 'class', classId: c.id }) })),
        { id: 'go-settings', label: t('app.commands.goSettings'), group: nav, icon: Settings, shortcut: key(','), run: () => go({ name: 'settings' }) },
        ...SETTINGS_SECTIONS.map((s) => ({ id: `go-settings-${s}`, label: t('app.commands.goSettingsSection', { section: t(`settings.sections.${s}`) }), group: nav, icon: Settings, run: () => go({ name: 'settings', section: s }) })),
        { id: 'class-new', label: t('app.commands.classNew'), group: create, icon: Plus, run: () => dialogsApi.open('new-class', {}) },
        { id: 'class-join', label: t('app.commands.classJoin'), group: create, icon: LogIn, shortcut: key('J', { shift: true }), run: () => dialogsApi.open('join', {}) },
        {
          id: 'record-toggle', label: recording ? t('app.commands.recordStop') : t('app.commands.recordStart'), group: recG, icon: recording ? Square : CircleDot,
          shortcut: key('R', { shift: true }), run: toggleRecording,
        },
        { id: 'ask-all', label: t('app.commands.askAll'), group: aiG, icon: Sparkles, disabled: !ai.enabled, run: () => go({ name: 'ask' }) },
        { id: 'theme-system', label: t('app.commands.themeSystem'), group: view, icon: SunMoon, run: () => void app.setPref('ui.theme', 'system') },
        { id: 'theme-light', label: t('app.commands.themeLight'), group: view, icon: Sun, run: () => void app.setPref('ui.theme', 'light') },
        { id: 'theme-dark', label: t('app.commands.themeDark'), group: view, icon: Moon, run: () => void app.setPref('ui.theme', 'dark') },
        ...UI_LOCALES.map((l) => ({ id: `lang-${l}`, label: t('app.commands.language', { language: UI_LOCALE_META[l].nativeName.replace(/ \(.*\)$/, '') }), group: view, icon: Languages, run: () => void app.setPref('ui.locale', l) })),
        { id: 'shortcuts', label: t('app.commands.shortcuts'), group: appG, icon: Keyboard, shortcut: 'F1', run: () => dialogsApi.open('shortcuts', {}) },
        { id: 'diagnostics-copy', label: t('app.commands.diagnosticsCopy'), group: appG, icon: Copy, run: copyDiagnostics },
      ];
      if (syncStarted) {
        list.push({
          id: 'sync-pause', label: syncPaused ? t('app.commands.syncResume') : t('app.commands.syncPause'), group: appG, icon: syncPaused ? CircleCheck : CirclePause,
          run: () => services.sync.applySettings({ paused: !syncPaused }),
        });
      }
      if (recording) {
        const paused = recording.status.state === 'paused';
        list.push({ id: 'record-pause', label: paused ? t('app.commands.recordResume') : t('app.commands.recordPause'), group: recG, icon: paused ? Play : Pause, run: () => (paused ? services.recording.resume() : services.recording.pause()) });
        for (const [kind, k] of MARKER_KEYS) {
          list.push({ id: `record-mark-${kind}`, label: t('app.commands.recordMark', { kind: t(`record.markers.${kind}`) }), group: recG, shortcut: k, run: () => services.recording.mark(kind) });
        }
      }
      if (app.example) list.push({ id: 'example-leave', label: t('app.commands.exampleLeave'), group: appG, icon: LogOut, run: () => app.example?.leave() });
      if (cls) {
        for (const tab of tabsOf(cls.shared)) {
          list.push({ id: `go-tab-${tab}`, label: t('app.commands.goTab', { tab: t(`classes.tabs.${tab}`), class: cls.shortName }), group: nav, icon: TAB_ICON[tab], keywords: [cls.name], priority: 1, run: () => go({ name: 'class', classId: cls.id, tab }) });
        }
        if (cls.shared) list.push({ id: 'class-invite', label: t('app.commands.classInvite', { class: cls.shortName }), group: create, icon: UserPlus, run: () => dialogsApi.open('invite', { classId: cls.id }) });
        else list.push({ id: 'class-share', label: t('app.commands.classShare', { class: cls.shortName }), group: create, icon: FolderSync, run: () => go({ name: 'class', classId: cls.id, tab: 'share' }) });
        list.push(
          { id: 'lecture-import', label: t('app.commands.lectureImport'), group: create, icon: AudioLines, keywords: [cls.shortName], run: () => dialogsApi.open('import', { classId: cls.id }) },
          { id: 'doc-add', label: t('app.commands.docAdd'), group: create, icon: FilePlus2, keywords: [cls.shortName], run: async () => (await ACTIONS.importDocuments()).default(services, cls.id) },
          { id: 'exam-add-date', label: t('app.commands.examAddDate'), group: create, icon: CalendarDays, keywords: [cls.shortName], run: () => dialogsApi.open('exam-date', { classId: cls.id }) },
          { id: 'exam-add-paper', label: t('app.commands.examAddPaper'), group: create, icon: ClipboardCheck, keywords: [cls.shortName], run: () => dialogsApi.open('exam-paper', { classId: cls.id }) },
          { id: 'note-new', label: t('app.commands.noteNew', { class: cls.shortName }), group: create, icon: NotebookPen, run: async () => (await ACTIONS.newNote()).default(services, cls.id) },
          { id: 'ask-class', label: t('app.commands.askClass', { class: cls.shortName }), group: aiG, icon: Sparkles, disabled: !ai.enabled, run: () => go({ name: 'class', classId: cls.id, tab: 'ask' }) },
        );
        if (papers > 0) list.push({ id: 'practice-class', label: t('app.commands.practiceClass', { class: cls.shortName }), group: create, icon: GraduationCap, run: () => go({ name: 'practice', classId: cls.id }) });
      }
      return list;
    },
    [t, key, active, cls, recording, syncStarted, syncPaused, ai.enabled, papers, app.example, go, dialogsApi, services, toggleRecording, copyDiagnostics],
  );

  const example = app.example;
  return (
    <div className={cx('shell', collapsed && 'shell--collapsed')} data-testid="shell">
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        mainRef.current?.querySelector<HTMLElement>('h1')?.focus();
      }}>
        {t('a11y.skipToContent')}
      </a>
      <Rail services={services} version={version} collapsed={collapsed} narrow={narrow} onToggleCollapsed={toggleCollapsed} onSearch={() => setPalette(true)} />
      <main className="shell__main" id="main" ref={mainRef}>
        {example ? (
          <div className="example-ribbon" role="note" data-testid="example-ribbon">
            <span>{t('app.example.ribbon')}</span>
            <Button size="sm" variant="ghost" onClick={example.leave} data-testid="example-leave">
              {t('app.example.leave')}
            </Button>
          </div>
        ) : null}
        <div className="shell__screen">
          <ScreenHost services={services} />
        </div>
        <div ref={dockRef} className="shell__dock">
          <Dock services={services} />
        </div>
      </main>
      <DialogHost services={services} />
      <OverlayHost services={services} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} providers={providers} classId={classId} services={services} />
    </div>
  );
}

/** How many exam papers a class has (the palette's "Practise {class}"). */
function useClassPapers(services: AppServicesImpl, classId: string | null): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!classId) {
      setN(0);
      return undefined;
    }
    try {
      const store = services.forClass(classId).exams.list;
      const read = () => setN(store.get().papers.filter((p) => p.questions.length > 0).length);
      read();
      return store.subscribe(read);
    } catch {
      setN(0);
      return undefined;
    }
  }, [services, classId]);
  return n;
}

/** The ready phase: everything that needs the services. */
export function useReadyServices(): AppServicesImpl | null {
  const { phase } = useAppState();
  return useMemo(() => (phase.name === 'ready' ? phase.services : null), [phase]);
}

