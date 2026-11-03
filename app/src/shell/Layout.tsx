// The ready phase's frame (UX §2.2): rail + main (example ribbon, the screen from SCREENS, the dock), the
// dialog host (DIALOGS), the overlay host (OVERLAYS), the palette (PALETTE_PROVIDERS) and the global keys
// of UX §2.10. M0 builds it; UI-SHELL owns it in wave 2.
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Keyboard, LogIn, Plus, Settings, Sun } from 'lucide-react';
import type { AppServicesImpl } from '../services/index';
import type { AppServices } from '../services/types/common';
import { DIALOGS, OVERLAYS, PALETTE_PROVIDERS, SCREENS, type DialogId } from '../features/registry';
import { Button } from '../ui/components/Button';
import { Spinner } from '../ui/components/Feedback';
import { useI18n, type I18n } from '../ui/i18n';
import { NARROW_RAIL, useMediaQuery } from '../ui/media';
import { isTextEntry, modalOpen } from '../ui/focus';
import { cx } from '../ui/cx';
import { useAppState } from './AppState';
import { CommandPalette, type PaletteProvider } from './CommandPalette';
import { Dock } from './Dock';
import { ErrorBoundary } from './ErrorBoundary';
import { Missing, missingKindOf } from './Placeholder';
import { Rail } from './Rail';
import { useRouter } from './router';
import type { Route } from './routes';
import { useCommands } from './useCommands';
import { useDialogs } from './useDialogs';
import { useStore } from './useStore';
import { useKeyLabel } from './keys';
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

/** The screen word of the window title (UX §2.1). */
function screenName(route: Route, { t }: Pick<I18n, 't'>): string {
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
  const { route } = useRouter();
  const classes = useStore(services.library.classes);
  const classId = 'classId' in route ? route.classId : null;
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
    <Suspense fallback={null}>
      <D key={current.key} props={current.props} services={services} close={close} />
    </Suspense>
  );
}

function OverlayHost({ services }: { services: AppServicesImpl }) {
  return (
    <Suspense fallback={null}>
      {overlays.map((O, i) => (
        <O key={i} services={services} />
      ))}
    </Suspense>
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

export function Layout({ services }: { services: AppServicesImpl }) {
  const i18n = useI18n();
  const { t } = i18n;
  const app = useAppState();
  const { route, go, back, canGoBack } = useRouter();
  const dialogsApi = useDialogs();
  const key = useKeyLabel();
  const classes = useStore(services.library.classes);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const narrowWindow = useMediaQuery(NARROW_RAIL);
  const narrow = collapsed || narrowWindow;
  const [palette, setPalette] = useState(false);
  const providers = useProviders(services);
  const [version, setVersion] = useState('');
  const classId = 'classId' in route ? route.classId : null;

  useEffect(() => {
    void services.ctx.platform.info().then((i) => setVersion(i.version), () => undefined);
  }, [services]);

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
    const cls = classId ? classes.find((c) => c.id === classId) : undefined;
    const title = cls ? t('app.windowTitle', { screen, class: cls.shortName }) : t('app.windowTitleShort', { screen });
    document.title = title;
    void services.ctx.platform.window.setTitle(title).catch(() => undefined);
  }, [route, classId, classes, i18n, t, services]);

  // Global keys (UX §2.10): Ctrl/⌘+K palette, F1 or ? shortcuts, Ctrl/⌘+, settings, Ctrl/⌘+1…9 classes, Alt+← back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (modalOpen() || palette) return;
      if (e.key === 'F1' || (e.key === '?' && !mod && !isTextEntry(e.target))) {
        e.preventDefault();
        dialogsApi.open('shortcuts', {});
      } else if (mod && e.key === ',') {
        e.preventDefault();
        go({ name: 'settings' });
      } else if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const c = classes.filter((x) => !x.archived)[Number(e.key) - 1];
        if (c) {
          e.preventDefault();
          go({ name: 'class', classId: c.id });
        }
      } else if (e.altKey && e.key === 'ArrowLeft' && canGoBack) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, dialogsApi, go, back, canGoBack, classes]);

  // The shell's own palette commands (UX §2.9): navigation and creation.
  useCommands(
    () => [
      { id: 'go-today', label: t('app.commands.goToday'), group: t('app.commands.group.navigate'), icon: Sun, run: () => go({ name: 'today' }) },
      { id: 'go-settings', label: t('app.commands.goSettings'), group: t('app.commands.group.navigate'), icon: Settings, shortcut: key(','), run: () => go({ name: 'settings' }) },
      ...classes
        .filter((c) => !c.archived)
        .map((c) => ({ id: `go-class-${c.id}`, label: t('app.commands.goClass', { class: c.name }), group: t('app.commands.group.navigate'), keywords: [c.shortName], run: () => go({ name: 'class', classId: c.id }) })),
      { id: 'class-new', label: t('app.commands.classNew'), group: t('app.commands.group.create'), icon: Plus, run: () => dialogsApi.open('new-class', {}) },
      { id: 'class-join', label: t('app.commands.classJoin'), group: t('app.commands.group.create'), icon: LogIn, run: () => dialogsApi.open('join', {}) },
      { id: 'shortcuts', label: t('app.commands.shortcuts'), group: t('app.commands.group.app'), icon: Keyboard, shortcut: 'F1', run: () => dialogsApi.open('shortcuts', {}) },
    ],
    [t, classes, go, dialogsApi, key],
  );

  const example = app.example;
  return (
    <div className={cx('shell', collapsed && 'shell--collapsed')} data-testid="shell">
      <Rail services={services} version={version} collapsed={collapsed} narrow={narrow} onToggleCollapsed={toggleCollapsed} onSearch={() => setPalette(true)} />
      <main className="shell__main" id="main">
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
        <Dock services={services} />
      </main>
      <DialogHost services={services} />
      <OverlayHost services={services} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} providers={providers} classId={classId} />
    </div>
  );
}

/** The ready phase: everything that needs the services. */
export function useReadyServices(): AppServicesImpl | null {
  const { phase } = useAppState();
  return useMemo(() => (phase.name === 'ready' ? phase.services : null), [phase]);
}
