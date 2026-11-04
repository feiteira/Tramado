// Local wall times of the fixtures (Europe/Lisbon, the demo's clock zone, UX §7.2) to epoch milliseconds, and
// the `H:MM:SS` audio times of UX §7.3 to milliseconds. Pure: no luxon, so the asset builder can share it.

/** The UTC instant of the last Sunday of `month` (0-based) at 01:00 UTC: the EU summer-time switch. */
function lastSunday1Utc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0, 1));
  return last.getTime() - last.getUTCDay() * 86_400_000;
}

/** Offset of Europe/Lisbon (WET/WEST) at a UTC instant, in milliseconds. */
export function lisbonOffsetMs(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSunday1Utc(y, 2) && utcMs < lastSunday1Utc(y, 9) ? 3_600_000 : 0;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** `2026-10-20T10:00` (Europe/Lisbon) → epoch ms. */
export function lisbon(local: string): number {
  const m = LOCAL.exec(local);
  if (!m) throw new Error(`not a local time: ${local}`);
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [number, number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  // Wall time minus the offset in force then (the gap and overlap hours never occur in the fixtures).
  return naive - lisbonOffsetMs(naive - 3_600_000);
}

/** The RFC 3339 `LocalDateTime` of a Lisbon wall time, with its offset (`+00:00` / `+01:00`). */
export function lisbonDateTime(local: string): string {
  const ms = lisbon(local);
  const off = lisbonOffsetMs(ms) / 3_600_000;
  const base = local.length === 16 ? `${local}:00` : local;
  return `${base}+0${off}:00`;
}

/** `0:41:12`, `41:12` or `12` → milliseconds. */
export function clockMs(t: string): number {
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) throw new Error(`not a clock time: ${t}`);
  return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
}

/** Milliseconds → `m:ss`, or `h:mm:ss` from one hour (citation labels, UX §4.3). */
export function clockLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
