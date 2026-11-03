// How long a transcription takes: the time left while it runs, and how fast this computer
// turned out to be, so the next one can be estimated before it starts.

/** Where the progress stood when the estimate started counting. */
export interface ProgressMark {
  at: number;
  percent: number;
}

/** Below this much progress or time, a rate says nothing yet. */
const MIN_PERCENT = 2;
const MIN_MS = 15_000;

/** Milliseconds left at `percent`, from the rate since `mark`; null until it can be told. */
export function timeLeft(mark: ProgressMark, percent: number, now: number): number | null {
  const done = percent - mark.percent;
  const spent = now - mark.at;
  if (done < MIN_PERCENT || spent < MIN_MS || percent >= 100) return null;
  return Math.round((spent / done) * (100 - percent));
}

/** Seconds of audio per second of work; null for too short a recording to tell. */
export function measuredSpeed(audioMs: number, tookMs: number): number | null {
  // Loading the model takes a few seconds whatever the length: short clips would look slow.
  if (audioMs < 60_000 || tookMs <= 0) return null;
  return audioMs / tookMs;
}

/** The speed to remember: the last one weighed with what was known before. */
export function blendSpeed(before: number | null, now: number): number {
  return before && Number.isFinite(before) && before > 0 ? (before + now) / 2 : now;
}

/** "1:40:05", "52:10": language-neutral, for the audit trail. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Whole minutes for "about N minutes left", and hours and minutes past an hour. */
export function roundedDuration(ms: number): { hours: number; minutes: number } {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes < 60 ? { hours: 0, minutes } : { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
