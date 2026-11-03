// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Wall-clock helpers without a time crate (architecture §5.1 `time`). The TypeScript twin is
//! `app/src/core/model/time.ts`; both are tested against `test-vectors/time.json`.

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch (0 if the clock is before 1970).
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Days since 1970-01-01 → (year, month 1–12, day 1–31). Howard Hinnant's `civil_from_days`.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097); // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// (year, month, day) → days since 1970-01-01. Howard Hinnant's `days_from_civil`.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400); // [0, 399]
    let m = i64::from(m);
    let d = i64::from(d);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// `Instant` of folder spec §2: `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC, milliseconds).
pub fn instant(ms: u64) -> String {
    let ms = ms as i128;
    let days = (ms.div_euclid(86_400_000)) as i64;
    let rest = ms.rem_euclid(86_400_000) as u64;
    let (y, mo, d) = civil_from_days(days);
    let h = rest / 3_600_000;
    let mi = (rest / 60_000) % 60;
    let s = (rest / 1000) % 60;
    let milli = rest % 1000;
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{milli:03}Z")
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(y) => 29,
        _ => 28,
    }
}

fn digits(s: &[u8], from: usize, n: usize) -> Option<u32> {
    let part = s.get(from..from + n)?;
    let mut v = 0u32;
    for b in part {
        if !b.is_ascii_digit() {
            return None;
        }
        v = v * 10 + u32::from(b - b'0');
    }
    Some(v)
}

/// Parses an RFC 3339 date-time into milliseconds since the epoch: fractional seconds of up to
/// nine digits (truncated to milliseconds), `Z` or `±hh:mm`; `T` may be `t` or a space and `Z`
/// may be `z` (RFC 3339 §5.6 note). Syncthing's `lastSeen`,
/// `versionTime` and `modified` carry nanoseconds and offsets. `None` for anything else.
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 {
        return None;
    }
    let year = i64::from(digits(b, 0, 4)?);
    let month = digits(b, 5, 2)?;
    let day = digits(b, 8, 2)?;
    let hour = digits(b, 11, 2)?;
    let minute = digits(b, 14, 2)?;
    let second = digits(b, 17, 2)?;
    if b[4] != b'-'
        || b[7] != b'-'
        || !matches!(b[10], b'T' | b't' | b' ')
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    if !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut i = 19;
    let mut frac_ms: i64 = 0;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let n = i - start;
        if n == 0 || n > 9 {
            return None;
        }
        // The first three digits are the milliseconds; the rest are truncated.
        for k in 0..3 {
            let digit = if k < n {
                i64::from(b[start + k] - b'0')
            } else {
                0
            };
            frac_ms = frac_ms * 10 + digit;
        }
    }
    let offset_min: i64 = match b.get(i) {
        Some(b'Z' | b'z') if i + 1 == b.len() => 0,
        Some(sign @ (b'+' | b'-')) if i + 6 == b.len() && b[i + 3] == b':' => {
            let oh = i64::from(digits(b, i + 1, 2)?);
            let om = i64::from(digits(b, i + 4, 2)?);
            if oh > 23 || om > 59 {
                return None;
            }
            let total = oh * 60 + om;
            if *sign == b'+' {
                total
            } else {
                -total
            }
        }
        _ => return None,
    };
    let days = days_from_civil(year, month, day);
    let secs = days * 86_400 + i64::from(hour) * 3600 + i64::from(minute) * 60 + i64::from(second)
        - offset_min * 60;
    Some(secs * 1000 + frac_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_instants() {
        assert_eq!(instant(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(instant(1_793_721_438_157), "2026-11-03T15:57:18.157Z");
        assert_eq!(instant(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(instant(253_402_300_799_999), "9999-12-31T23:59:59.999Z");
    }

    #[test]
    fn parses_rfc3339() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339("2026-11-03T15:57:18.157Z"),
            Some(1_793_721_438_157)
        );
        assert_eq!(
            parse_rfc3339("2026-11-03T15:57:18.157999999Z"),
            Some(1_793_721_438_157)
        );
        assert_eq!(
            parse_rfc3339("2026-11-03T16:57:18.157+01:00"),
            Some(1_793_721_438_157)
        );
        assert_eq!(
            parse_rfc3339("2026-11-03T14:27:18.1-01:30"),
            Some(1_793_721_438_100)
        );
        assert_eq!(
            parse_rfc3339("0001-01-01T00:00:00Z"),
            Some(-62_135_596_800_000)
        );
        for bad in [
            "",
            "2026-11-03",
            "2026-11-03T18:37:18",
            "2026-13-03T18:37:18Z",
            "2026-02-29T18:37:18Z",
            "2026-11-03T24:00:00Z",
            "2026-11-03T18:37:18.Z",
            "2026-11-03T18:37:18.1234567890Z",
            "2026-11-03T18:37:18+0100",
            "2026-11-03T18:37:18Zx",
        ] {
            assert_eq!(parse_rfc3339(bad), None, "{bad}");
        }
        assert_eq!(
            parse_rfc3339("2024-02-29T00:00:00Z"),
            Some(1_709_164_800_000)
        );
    }

    #[test]
    fn round_trips() {
        for ms in [
            0u64,
            1,
            999,
            86_399_999,
            1_000_000_000_000,
            1_793_721_438_157,
            4_102_444_800_000,
        ] {
            let s = instant(ms);
            assert_eq!(parse_rfc3339(&s), Some(ms as i64), "{s}");
        }
        assert!(now_ms() > 1_700_000_000_000);
    }
}
