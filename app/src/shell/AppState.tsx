// Top-level state (architecture §11.4, UX §2.1): the platform, the preferences, and the phase — loading,
// welcome (identity.json has no name: onboarding), or ready with the services. M0 implements it;
// UI-SHELL owns it in wave 2. Never StrictMode (D49): services are created once per phase.
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
  /** Onboarding: creates the person key and identity.json, then enters the ready phase. */
  finishOnboarding: (input: { name: string; deviceName?: string; colour?: string | null }) => Promise<void>;
  example: { leave(): void } | null;
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

export function AppStateProvider({ platform, options = {}, children }: { platform: Platform; options?: AppStateOptions; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [prefsStore, setPrefsStore] = useState<PrefsStore | null>(null);
  const [initialDialog, setInitialDialog] = useState<InitialDialog | null>(null);
  const identityRef = useRef<IdentityService | null>(null);
  const optionsRef = useRef(options);
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

  // Discovery: prefs, identity, then the phase.
  useEffect(() => {
    let live = true;
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
      await ids.create({ name, deviceName: input.deviceName ?? name, colour: input.colour ?? null }, Date.now());
      await enter(prefsStore, ids);
    },
    [enter, prefsStore],
  );

  // Window close (architecture §11.4): savers, then hide to the tray when sharing, else quit.
  useEffect(
    () =>
      platform.window.onCloseRequested(async () => {
        await savers.run();
        const shared = phase.name === 'ready' ? phase.services.library.classes.get().filter((c) => c.shared).length : 0;
        return prefsStore?.get('app.trayOnClose') === '1' && shared > 0 ? 'hide' : 'quit';
      }),
    [platform, savers, phase, prefsStore],
  );

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
      example: options.example ?? null,
      initialDialog,
      registerSaver,
      runSavers,
    }),
    [platform, phase, prefsStore, prefs, setPref, finishOnboarding, options.example, initialDialog, registerSaver, runSavers],
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
