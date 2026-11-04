// Top-level state (architecture §11.4, UX §2.1): the platform, the preferences, and the phase — loading,
// welcome (identity.json has no name: onboarding), or ready with the services. Never StrictMode (D49):
// services are created once per phase. Onboarding steps 1–2 run in the welcome phase (no services yet);
// once the name is given the services start and steps 3–4 (AI key, ready) run in the ready phase with
// `onboarding` set, so the key test goes through AiService (UX §3.1).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { detectUiLocale, isUiLocale, type UiLocale } from '../core/i18n/languages';
import { hlcNodeOf, shortIdOf } from '../core/model/ids';
import type { Platform } from '../platform/types';
import { systemClock, type AppContext } from '../services/context';
import { createPlatformHlcClock } from '../services/hlcClock';
import { createIdentityService, type IdentityService } from '../services/identity';
import { createServices, type AppServicesImpl } from '../services/index';
import { createPrefsStore, PREF_DEFAULTS, type PrefKey, type PrefsStore } from '../services/prefs';
import { Store } from '../services/store';
import { createInlineExtractHost, createInlineHost } from '../workers/hosts';
import type { DialogId, DialogPropsMap } from '../features/registry';
import type { Route } from './routes';
import { Savers, type Saver, type SaverOptions } from './savers';
import { arriveFocus } from './arrival';
import { useStore } from './useStore';

export { SAVE_STAGE, type Saver, type SaverOptions } from './savers';

export type Phase =
  | { name: 'loading' }
  | { name: 'welcome' }
  | { name: 'ready'; services: AppServicesImpl; initialRoute?: Route };

export interface InitialDialog { id: DialogId; props: DialogPropsMap[DialogId] }

/** What the host (main.tsx, demo/boot.ts) passes in. */
export interface AppStateOptions {
  /** Context pieces the host provides (the demo's frozen clock and seeded rand); defaults: system clock, inline hosts. */
  context?: Partial<Pick<AppContext, 'clock' | 'rand' | 'imagePrep' | 'pdfRender' | 'indexHost' | 'extractHost'>>;
  /** The first route once ready (the demo's `route=`); default Today. */
  initialRoute?: (services: AppServicesImpl) => Route | undefined;
  /** A dialog opened after the first render of the ready phase (the demo's `dialog=`). */
  initialDialog?: (services: AppServicesImpl) => InitialDialog | null;
  /** The browser demo: shows the example ribbon; `leave` returns to an empty library. */
  example?: { leave(): void } | null;
  /** Called once the services exist (the demo installs its hooks). */
  onReady?: (services: AppServicesImpl) => void;
}

export interface UiPrefs {
  locale: UiLocale;
  theme: 'system' | 'light' | 'dark';
  textSize: number;
  readingFont: 'default' | 'atkinson' | 'opendyslexic';
  reduceMotion: boolean;
}

export interface AppStateValue {
  platform: Platform;
  phase: Phase;
  /** The live prefs.json view (null until loaded). */
  prefsStore: PrefsStore | null;
  /** Typed UI preferences derived from prefs.json (defaults before it loads). */
  prefs: UiPrefs;
  /** The interface language (shorthand for prefs.locale). */
  locale: UiLocale;
  /** Validates and saves one preference; a failure is logged, not thrown. */
  setPref: (key: PrefKey, value: string) => Promise<void>;
  /**
   * Onboarding step 2: creates this computer's sharing identity (`platform.sync.identity()`, no daemon, no port),
   * the person key and identity.json, then enters the ready phase with `onboarding` still on (steps 3–4).
   * Rejects with the PlatformError of the failed step (SYNC_UNAVAILABLE: the sharing component is missing).
   */
  finishOnboarding: (input: { name: string; deviceName?: string; colour?: string | null }) => Promise<void>;
  /** True between onboarding step 2 and its last step: the ready phase shows the rest of onboarding. */
  onboarding: boolean;
  /** Leaves onboarding for the shell (Today). */
  endOnboarding: () => void;
  /** Settings › Profile (and onboarding's Back): name, computer name, colour in identity.json. */
  updateIdentity: (patch: { name?: string; deviceName?: string; colour?: string | null }) => Promise<void>;
  /** Onboarding's [Try the example]: the in-memory example library with the ribbon (UX §3.1). */
  startExample: () => Promise<void>;
  example: { leave(): void } | null;
  /**
   * The ready phase's say on closing the window (UX §3.15.1, D48): called after the savers with what Tramado would
   * do by itself ('hide' to the tray when sharing, else 'quit'); may answer 'stay' (a question is shown instead).
   */
  setCloseHook: (hook: ((decision: 'hide' | 'quit') => Promise<'hide' | 'quit' | 'stay'>) | null) => void;
  initialDialog: InitialDialog | null;
  registerSaver: (fn: Saver, opts?: SaverOptions) => () => void;
  runSavers: () => Promise<void>;
}

const Ctx = createContext<AppStateValue | null>(null);

const systemLocale = (): string | null => (typeof navigator !== 'undefined' ? navigator.language : null);

/** Typed UI preferences from the flat prefs map (UX §3.14.2; architecture §13.3). */
export function uiPrefsOf(map: Readonly<Record<string, string>>): UiPrefs {
  const get = (k: keyof typeof PREF_DEFAULTS) => map[k] ?? PREF_DEFAULTS[k];
  const raw = get('ui.locale');
  const theme = get('ui.theme');
  const font = get('ui.readingFont');
  return {
    locale: isUiLocale(raw) ? raw : detectUiLocale(systemLocale()),
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    textSize: Number(get('ui.textSize')) || 1,
    readingFont: font === 'atkinson' || font === 'opendyslexic' ? font : 'default',
    reduceMotion: get('ui.reduceMotion') === '1',
  };
}

const EMPTY_PREFS = new Store<Readonly<Record<string, string>>>({});

export function AppStateProvider({ platform: basePlatform, options: baseOptions = {}, children }: { platform: Platform; options?: AppStateOptions; children: ReactNode }) {
  // [Try the example] swaps in the demo's memory platform for the rest of the session (desktop; UX §3.1).
  const [exampleSession, setExampleSession] = useState<{ platform: Platform; options: AppStateOptions } | null>(null);
  const platform = exampleSession?.platform ?? basePlatform;
  const options = exampleSession?.options ?? baseOptions;
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [onboarding, setOnboarding] = useState(false);
  const closeHook = useRef<((decision: 'hide' | 'quit') => Promise<'hide' | 'quit' | 'stay'>) | null>(null);
  const [prefsStore, setPrefsStore] = useState<PrefsStore | null>(null);
  const [initialDialog, setInitialDialog] = useState<InitialDialog | null>(null);
  const identityRef = useRef<IdentityService | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [savers] = useState(() => new Savers());
  const prefMap = useStore(prefsStore?.store ?? EMPTY_PREFS);
  const prefs = useMemo(() => uiPrefsOf(prefMap), [prefMap]);

  // Builds the context and the services, loads the library and boots sync (architecture §4.4 step 4).
  const enter = useCallback(
    async (prefsStore: PrefsStore, ids: IdentityService) => {
      const opts = optionsRef.current;
      const info = await platform.info();
      const device = await platform.sync.identity();
      const clock = opts.context?.clock ?? systemClock;
      const ctx: AppContext = {
        platform,
        info,
        clock,
        rand: opts.context?.rand ?? Math.random,
        prefs: prefsStore,
        identity: ids.identity,
        device: new Store({ deviceId: device.deviceId, shortId: shortIdOf(device.deviceId) }),
        hlc: await createPlatformHlcClock(platform, hlcNodeOf(device.deviceId), () => clock.now()),
        imagePrep: opts.context?.imagePrep ?? { prepare: () => Promise.reject(new Error('image preparation is not available yet')) },
        pdfRender: opts.context?.pdfRender ?? { pages: async () => 0, renderJpeg: () => Promise.reject(new Error('PDF rendering is not available yet')) },
        // M0: the workers are stubs (T-DOCS), so both hosts run inline on the main thread.
        indexHost: opts.context?.indexHost ?? createInlineHost(),
        extractHost: opts.context?.extractHost ?? createInlineExtractHost(),
        log: (level, msg, data) => platform.log(level, msg, data),
      };
      const services = createServices(ctx);
      await services.library.load();
      const booted = services.sync.boot().catch((e: unknown) => platform.log('warn', 'sync boot failed', { error: String(e) }));
      // G1 (T-LECTURES): re-attach to recordings and imports left from before a reload, and start volunteering
      // once sync has booted (claims read the folders' state).
      void services.recording.recover().catch((e: unknown) => platform.log('warn', 'recording recovery failed', { error: String(e) }));
      void booted
        .then(() => services.transcription.start())
        .catch((e: unknown) => platform.log('warn', 'transcription queue failed to start', { error: String(e) }));
      opts.onReady?.(services);
      setInitialDialog(opts.initialDialog?.(services) ?? null);
      setPhase({ name: 'ready', services, initialRoute: opts.initialRoute?.(services) });
    },
    [platform],
  );

  // Discovery: prefs, identity, then the phase (again when the example session replaces the platform).
  useEffect(() => {
    let live = true;
    setPhase({ name: 'loading' });
    void (async () => {
      try {
        const store = await createPrefsStore(platform);
        const ids = await createIdentityService(platform);
        if (!live) return;
        identityRef.current = ids;
        setPrefsStore(store);
        if (!ids.identity.get()) setPhase({ name: 'welcome' });
        else await enter(store, ids);
      } catch (e) {
        platform.log('error', 'start-up failed', { error: String(e) });
        console.error('start-up failed', e);
        if (live) setPhase({ name: 'welcome' });
      }
    })();
    return () => {
      live = false;
    };
  }, [platform, enter]);

  // Leaving a phase disposes its services.
  useEffect(() => (phase.name === 'ready' ? () => phase.services.dispose() : undefined), [phase]);

  // The focus follows the phase change (Trama's arrival rule).
  useEffect(() => {
    if (phase.name === 'welcome') arriveFocus();
  }, [phase.name]);

  const setPref = useCallback(
    async (key: PrefKey, value: string) => {
      if (!prefsStore) return;
      try {
        await prefsStore.set(key, value);
      } catch (e) {
        platform.log('warn', 'saving a preference failed', { key, error: String(e) });
      }
    },
    [platform, prefsStore],
  );

  const finishOnboarding = useCallback(
    async (input: { name: string; deviceName?: string; colour?: string | null }) => {
      const ids = identityRef.current;
      if (!ids || !prefsStore) return;
      const name = input.name.trim();
      // This computer's sharing identity first: without it no class can be created (UX §3.1).
      await platform.sync.identity();
      await ids.create({ name, deviceName: input.deviceName?.trim() || name, colour: input.colour ?? null }, Date.now());
      setOnboarding(true);
      await enter(prefsStore, ids);
    },
    [enter, platform, prefsStore],
  );

  const endOnboarding = useCallback(() => setOnboarding(false), []);

  const updateIdentity = useCallback(
    async (patch: { name?: string; deviceName?: string; colour?: string | null }) => {
      const ids = identityRef.current;
      if (!ids) return;
      await ids.update(patch);
      // Classmates see the change through my member file in every class (UX §3.14.1).
      if (phase.name === 'ready') {
        const { services } = phase;
        await Promise.all(
          services.library.classes.get().map((c) =>
            Promise.resolve()
              .then(() => services.forClass(c.id).info.refreshOwnMemberFile())
              .catch((e: unknown) => platform.log('warn', 'member file not refreshed', { classId: c.id, error: String(e) })),
          ),
        );
      }
    },
    [phase, platform],
  );

  const startExample = useCallback(async () => {
    const info = await basePlatform.info().catch(() => null);
    const lang = prefsStore?.get('ui.locale') || detectUiLocale(systemLocale());
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    if (basePlatform.kind === 'demo' || info?.os === 'web') {
      // The browser demo: the example is the demo without `demo=empty` (a shareable address).
      const q = new URLSearchParams(window.location.search);
      q.delete('demo');
      q.set('lang', lang);
      q.set('theme', theme);
      window.location.assign(`${window.location.pathname}?${q.toString()}`);
      return;
    }
    // The desktop: the same fictional library, in memory, beside the real (still empty) one. Leaving reloads the window.
    const { bootDemo } = await import('../demo/boot');
    const props = await bootDemo(`?lang=${lang}&theme=${theme}`);
    setExampleSession({
      platform: props.platform,
      options: { ...props.options, example: { leave: () => window.location.reload() } },
    });
  }, [basePlatform, prefsStore]);

  // Window close (architecture §11.4): savers, then hide to the tray when sharing, else quit; the ready phase may
  // ask first (the first close with a shared class, a recording running).
  useEffect(
    () =>
      platform.window.onCloseRequested(async () => {
        await savers.run();
        const shared = phase.name === 'ready' ? phase.services.library.classes.get().filter((c) => c.shared).length : 0;
        const decision = prefsStore?.get('app.trayOnClose') === '1' && shared > 0 ? 'hide' : 'quit';
        const hook = phase.name === 'ready' ? closeHook.current : null;
        return hook ? hook(decision).catch(() => decision) : decision;
      }),
    [platform, savers, phase, prefsStore],
  );
  const setCloseHook = useCallback((hook: ((decision: 'hide' | 'quit') => Promise<'hide' | 'quit' | 'stay'>) | null) => {
    closeHook.current = hook;
  }, []);

  const registerSaver = useCallback((fn: Saver, opts?: SaverOptions) => savers.register(fn, opts), [savers]);
  const runSavers = useCallback(() => savers.run(), [savers]);

  const value = useMemo<AppStateValue>(
    () => ({
      platform,
      phase,
      prefsStore,
      prefs,
      locale: prefs.locale,
      setPref,
      finishOnboarding,
      onboarding: onboarding && phase.name === 'ready',
      endOnboarding,
      updateIdentity,
      startExample,
      example: options.example ?? null,
      initialDialog,
      registerSaver,
      runSavers,
      setCloseHook,
    }),
    [platform, phase, prefsStore, prefs, setPref, finishOnboarding, onboarding, endOnboarding, updateIdentity, startExample, options.example, initialDialog, registerSaver, runSavers, setCloseHook],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState outside AppStateProvider');
  return v;
}

export const usePlatform = (): Platform => useAppState().platform;

/** The services of the ready phase (screens are only rendered then). */
export function useServices(): AppServicesImpl {
  const { phase } = useAppState();
  if (phase.name !== 'ready') throw new Error('useServices before the ready phase');
  return phase.services;
}

/** Registers a saver for the lifetime of the calling component (savers run before close and phase changes). */
export function useSaver(fn: Saver, opts?: SaverOptions): void {
  const { registerSaver } = useAppState();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => registerSaver(() => ref.current(), opts), [registerSaver, opts]);
}
