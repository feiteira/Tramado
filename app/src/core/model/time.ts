// Wall-clock strings shared with Rust's tramado_base::time (test-vectors/time.json).
// `instant(ms)` writes the `Instant` of folder spec §2 ("YYYY-MM-DDTHH:MM:SS.mmmZ");
// `parseRfc3339` reads any RFC 3339 time Syncthing or a person writes (fractions up to 9 digits,
// "Z" or ±hh:mm offsets) to milliseconds since the epoch, or null when malformed.

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Days since 1970-01-01 → civil date (Howard Hinnant's algorithm; also used by the Rust twin). */
function civilFromDays(z: number): { y: number; m: number; d: number } {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

/** Civil date → days since 1970-01-01. */
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** "YYYY-MM-DDTHH:MM:SS.mmmZ" for `ms` since the epoch (UTC). */
export function instant(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  let rest = ms - days * 86_400_000;
  const { y, m, d } = civilFromDays(days);
  const hh = Math.floor(rest / 3_600_000);
  rest -= hh * 3_600_000;
  const mm = Math.floor(rest / 60_000);
  rest -= mm * 60_000;
  const ss = Math.floor(rest / 1000);
  const mmm = rest - ss * 1000;
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}.${pad(mmm, 3)}Z`;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}:\d{2})$/;

/** Milliseconds since the epoch for an RFC 3339 time, or null. Fractions below 1 ms are truncated. */
export function parseRfc3339(s: string): number | null {
  const m = RFC3339.exec(s);
  if (!m) return null;
  const [y, mo, d, hh, mi, ss] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || hh > 23 || mi > 59 || ss > 60) return null;
  const monthDays = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  if (d > monthDays) return null;
  const frac = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
  let offsetMin = 0;
  const tz = m[8]!;
  if (tz !== 'Z' && tz !== 'z') {
    const oh = Number(tz.slice(1, 3));
    const om = Number(tz.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMin = (tz[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  return daysFromCivil(y, mo, d) * 86_400_000 + hh * 3_600_000 + mi * 60_000 + Math.min(ss, 59) * 1000 + frac - offsetMin * 60_000;
}
