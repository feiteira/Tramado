// FakeMedia (UX §7.1, §2.11 `Player`): a silent player for the browser demo, whose lectures have no real audio. It
// keeps a position driven by `performance.now()` while playing, reports it at 4 Hz, and implements the
// `PlayerHandle` the lecture view drives (play, pause, toggle, seek, skip, rate). `tick(ms)` moves media time by hand
// (the `__tramadoDemo.tick` hook: screenshots and tests never wait for real time).

/** UX §2.11: the handle a `Player` exposes (`ref`). */
export interface PlayerHandle {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  skip(deltaMs: number): void;
  setRate(r: number): void;
  readonly ms: number;
  readonly playing: boolean;
}

export interface FakeMedia extends PlayerHandle {
  readonly durationMs: number;
  readonly rate: number;
  /** Time updates: 4 Hz while playing, and once after every seek, skip, pause, rate change and tick. */
  onTime(cb: (ms: number) => void): () => void;
  /** Playback reached the end (the player pauses there). */
  onEnded(cb: () => void): () => void;
  /** Advances media time by `ms` (scaled by nothing: media milliseconds), playing or not. */
  tick(ms: number): void;
  /** Stops the timer and drops every listener. */
  dispose(): void;
}

export interface FakeMediaDeps {
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/** The playback rates the lecture view offers (UX §3.5.2); others are clamped into [0.5, 3]. */
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
const TIME_UPDATE_MS = 250;

/** Every FakeMedia not yet disposed, so the demo's `tick(ms)` hook can move them all (UX §7.2). */
const LIVE = new Set<FakeMedia>();

/** Advances every live FakeMedia by `ms` of media time (wire into `__tramadoDemo.tick`). */
export function tickFakeMedia(ms: number): void {
  for (const m of [...LIVE]) m.tick(ms);
}

export function createFakeMedia(durationMs: number, deps: FakeMediaDeps = {}): FakeMedia {
  const now = deps.now ?? (() => performance.now());
  const startTimer = deps.setInterval ?? ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms));
  const stopTimer = deps.clearInterval ?? ((h: unknown) => globalThis.clearInterval(h as ReturnType<typeof setInterval>));
  const duration = Math.max(0, Math.floor(durationMs));
  const timeListeners = new Set<(ms: number) => void>();
  const endListeners = new Set<() => void>();
  let base = 0;           // media position when `since` was taken
  let since = 0;          // now() at the last (re)start
  let playing = false;
  let rate = 1;
  let timer: unknown = null;
  let disposed = false;

  const clamp = (ms: number) => Math.min(duration, Math.max(0, ms));
  const position = () => (playing ? clamp(base + (now() - since) * rate) : base);
  const emit = () => {
    const ms = position();
    for (const cb of [...timeListeners]) cb(ms);
  };
  const stopClock = () => {
    if (timer !== null) stopTimer(timer);
    timer = null;
  };
  const end = () => {
    base = duration;
    playing = false;
    stopClock();
    emit();
    for (const cb of [...endListeners]) cb();
  };
  const onTimer = () => {
    if (!playing) return;
    if (position() >= duration) end();
    else emit();
  };
  /** Re-bases the clock at the current position (before a rate change or a jump). */
  const rebase = (ms: number) => {
    base = clamp(ms);
    since = now();
  };

  const media: FakeMedia = {
    get ms() {
      return Math.round(position());
    },
    get playing() {
      return playing;
    },
    get rate() {
      return rate;
    },
    durationMs: duration,
    play() {
      if (disposed || playing) return;
      if (base >= duration) base = 0;
      playing = true;
      since = now();
      timer = startTimer(onTimer, TIME_UPDATE_MS);
      emit();
    },
    pause() {
      if (!playing) return;
      base = position();
      playing = false;
      stopClock();
      emit();
    },
    toggle() {
      if (playing) media.pause();
      else media.play();
    },
    seek(ms: number) {
      if (!Number.isFinite(ms)) return;
      rebase(ms);
      if (playing && base >= duration) end();
      else emit();
    },
    skip(deltaMs: number) {
      if (!Number.isFinite(deltaMs)) return;
      media.seek(position() + deltaMs);
    },
    setRate(r: number) {
      if (!Number.isFinite(r) || r <= 0) return;
      rebase(position());
      rate = Math.min(MAX_RATE, Math.max(MIN_RATE, r));
      emit();
    },
    onTime(cb) {
      timeListeners.add(cb);
      return () => {
        timeListeners.delete(cb);
      };
    },
    onEnded(cb) {
      endListeners.add(cb);
      return () => {
        endListeners.delete(cb);
      };
    },
    tick(ms: number) {
      if (!Number.isFinite(ms) || ms <= 0) return;
      rebase(position() + ms);
      if (base >= duration) end();
      else emit();
    },
    dispose() {
      disposed = true;
      LIVE.delete(media);
      playing = false;
      stopClock();
      timeListeners.clear();
      endListeners.clear();
    },
  };
  LIVE.add(media);
  return media;
}
