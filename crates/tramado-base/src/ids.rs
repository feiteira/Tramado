// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Identifiers (folder spec §2, §2.1): validators, generators and the derived IDs that Rust
//! needs (device IDs from certificates, member IDs from person keys). The TypeScript twin is
//! `app/src/core/model/{ids,derive}.ts`; both are tested against `test-vectors/ids.json`.

use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};

const B32_UPPER: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn all_b32_lower(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_lowercase() || (b'2'..=b'7').contains(&b))
}

fn all_b32_upper(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b))
}

/// `^tramado-[a-z2-7]{26}$`
pub fn is_class_id(s: &str) -> bool {
    s.strip_prefix("tramado-")
        .is_some_and(|rest| rest.len() == 26 && all_b32_lower(rest))
}

/// `^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$` (the canonical dashed form; check characters not verified,
/// see [`is_valid_device_id`]).
pub fn is_device_id(s: &str) -> bool {
    let groups: Vec<&str> = s.split('-').collect();
    groups.len() == 8 && groups.iter().all(|g| g.len() == 7 && all_b32_upper(g))
}

/// `^[A-Z2-7]{7}$`
pub fn is_short_id(s: &str) -> bool {
    s.len() == 7 && all_b32_upper(s)
}

/// `^[a-z2-7]{26}$`
pub fn is_member_id(s: &str) -> bool {
    s.len() == 26 && all_b32_lower(s)
}

/// `^[0-9a-f]{64}$`
pub fn is_hex64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The first 7 characters of a device ID (what Syncthing reports as `modifiedBy`).
pub fn short_id(device: &str) -> &str {
    device.get(..7).unwrap_or(device)
}

/// `^[0-7][0-9A-HJKMNP-TV-Z]{25}$`
pub fn is_ulid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 26 && (b'0'..=b'7').contains(&b[0]) && b[1..].iter().all(|c| CROCKFORD.contains(c))
}

/// A ULID from a 48-bit time and 80 bits (Crockford base32, upper case).
pub fn ulid_from_parts(ms: u64, rand80: &[u8; 10]) -> String {
    let mut value: u128 = u128::from(ms & 0xFFFF_FFFF_FFFF) << 80;
    for (i, b) in rand80.iter().enumerate() {
        value |= u128::from(*b) << (72 - 8 * i);
    }
    let mut out = [0u8; 26];
    for (i, slot) in out.iter_mut().enumerate() {
        let shift = 125 - 5 * i as u32;
        // 26 × 5 = 130 bits: the first character carries the top 3 bits only.
        let idx = if i == 0 {
            (value >> 125) & 0x7
        } else {
            (value >> shift) & 0x1F
        };
        *slot = CROCKFORD[idx as usize];
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A new random ULID: 48-bit time + 80 random bits.
pub fn new_ulid(now_ms: u64) -> String {
    let mut r = [0u8; 10];
    fill_random(&mut r);
    ulid_from_parts(now_ms, &r)
}

/// `bytes` random bytes as lower-case hex.
pub fn random_token_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    fill_random(&mut b);
    hex_lower(&b)
}

/// `[A-Za-z0-9]{len}` (Syncthing API key, GUI password), without modulo bias.
pub fn random_alnum(len: usize) -> String {
    const ALPHABET: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut out = String::with_capacity(len);
    let mut buf = [0u8; 64];
    while out.len() < len {
        fill_random(&mut buf);
        for b in buf {
            // 248 = 4 × 62: values above are dropped so every character is equally likely.
            if b < 248 && out.len() < len {
                out.push(ALPHABET[usize::from(b % 62)] as char);
            }
        }
    }
    out
}

/// `[a-z0-9]{len}` (the random part of temporary file names, folder spec §4.4).
pub fn random_lower_alnum(len: usize) -> String {
    const ALPHABET: &[u8; 36] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut out = String::with_capacity(len);
    let mut buf = [0u8; 32];
    while out.len() < len {
        fill_random(&mut buf);
        for b in buf {
            // 252 = 7 × 36.
            if b < 252 && out.len() < len {
                out.push(ALPHABET[usize::from(b % 36)] as char);
            }
        }
    }
    out
}

/// Fills `buf` from the operating system's random source. That source practically never fails;
/// if it does, the bytes come from a hash of the time, the process and a counter, and the
/// failure is logged (callers that need key material check [`try_fill_random`] instead).
pub fn fill_random(buf: &mut [u8]) {
    if try_fill_random(buf).is_ok() {
        return;
    }
    log::error!("the operating system's random source failed; using a time-based fallback");
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut filled = 0;
    while filled < buf.len() {
        let mut h = Sha256::new();
        h.update(crate::time::now_ms().to_le_bytes());
        h.update(std::process::id().to_le_bytes());
        h.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
        h.update((buf.as_ptr() as usize).to_le_bytes());
        if let Ok(d) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
            h.update(d.subsec_nanos().to_le_bytes());
        }
        let block = h.finalize();
        let n = (buf.len() - filled).min(block.len());
        buf[filled..filled + n].copy_from_slice(&block[..n]);
        filled += n;
    }
}

pub fn try_fill_random(buf: &mut [u8]) -> Result<(), getrandom::Error> {
    getrandom::fill(buf)
}

pub fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[usize::from(b >> 4)] as char);
        s.push(HEX[usize::from(b & 0xF)] as char);
    }
    s
}

/// Lower-case SHA-256 hex of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

/// RFC 4648 base32, upper case, without padding.
pub fn b32_upper(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for b in bytes {
        acc = (acc << 8) | u32::from(*b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(B32_UPPER[((acc >> bits) & 0x1F) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(B32_UPPER[((acc << (5 - bits)) & 0x1F) as usize] as char);
    }
    out
}

/// RFC 4648 base32, lower case, without padding (`b32` of folder spec §2.1).
pub fn b32_lower(bytes: &[u8]) -> String {
    b32_upper(bytes).to_ascii_lowercase()
}

/// `classId(creatorDeviceId, idNonce)` of folder spec §2.1.
pub fn derive_class_id(creator_device_id: &str, id_nonce: &str) -> String {
    let h = Sha256::digest(format!("tramado-class-v1|{creator_device_id}|{id_nonce}").as_bytes());
    let b = b32_lower(&h);
    format!("tramado-{}", &b[..26])
}

/// `itemId(ms, writerDeviceId, idNonce)` of folder spec §2.1.
pub fn derive_item_id(ms: u64, writer_device_id: &str, id_nonce: &str) -> String {
    let h = Sha256::digest(format!("tramado-item-v1|{writer_device_id}|{id_nonce}").as_bytes());
    let mut r = [0u8; 10];
    r.copy_from_slice(&h[..10]);
    ulid_from_parts(ms, &r)
}

/// `memberId(personPub)` of folder spec §2.1 (`personPub` = the 32 raw public-key bytes).
pub fn member_id(person_pub: &[u8]) -> String {
    let b = b32_lower(&Sha256::digest(person_pub));
    b[..26].to_string()
}

/// Syncthing's Luhn mod 32 check character (lib/protocol/luhn.go, as Syncthing computes it).
fn luhn32(s: &str) -> Option<char> {
    let mut factor = 1;
    let mut sum = 0;
    for c in s.bytes() {
        let cp = B32_UPPER.iter().position(|x| *x == c)?;
        let mut addend = factor * cp;
        factor = if factor == 2 { 1 } else { 2 };
        addend = addend / 32 + addend % 32;
        sum += addend;
    }
    let check = (32 - sum % 32) % 32;
    Some(B32_UPPER[check] as char)
}

/// The canonical device ID of a device certificate (DER bytes): SHA-256, base32, four Luhn
/// check characters, eight dashed groups of seven (Syncthing `protocol.NewDeviceID`).
pub fn device_id_from_cert_der(der: &[u8]) -> String {
    let mut h = [0u8; 32];
    h.copy_from_slice(&Sha256::digest(der));
    device_id_from_sha256(&h)
}

/// The canonical device ID for the SHA-256 of a device certificate.
pub fn device_id_from_sha256(hash: &[u8; 32]) -> String {
    let b = b32_upper(hash); // 52 characters
    let mut with_check = String::with_capacity(56);
    for i in 0..4 {
        let part = &b[i * 13..(i + 1) * 13];
        with_check.push_str(part);
        // Every character of `part` is in the alphabet, so the check character exists.
        with_check.push(luhn32(part).unwrap_or('A'));
    }
    let groups: Vec<&str> = (0..8).map(|i| &with_check[i * 7..(i + 1) * 7]).collect();
    groups.join("-")
}

/// True when `s` is a canonical device ID whose four check characters are right.
pub fn is_valid_device_id(s: &str) -> bool {
    if !is_device_id(s) {
        return false;
    }
    let flat: String = s.chars().filter(|c| *c != '-').collect();
    (0..4).all(|i| {
        let chunk = &flat[i * 14..(i + 1) * 14];
        luhn32(&chunk[..13]).is_some_and(|c| chunk.ends_with(c))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validators() {
        assert!(is_class_id("tramado-geznkyujw4ofedwinfcmzl2rim"));
        assert!(!is_class_id("tramado-geznkyujw4ofedwinfcmzl2ri"));
        assert!(!is_class_id("tramado-GEZNKYUJW4OFEDWINFCMZL2RIM"));
        assert!(!is_class_id("tramado-geznkyujw4ofedwinfcmzl2ri1"));
        assert!(is_device_id(
            "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2"
        ));
        assert!(!is_device_id(
            "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232"
        ));
        assert!(!is_device_id(
            "ab4z76w-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2"
        ));
        assert_eq!(short_id("AB4Z76W-GA7E7XY"), "AB4Z76W");
        assert_eq!(short_id("AB"), "AB");
        assert!(is_ulid("01JBX4Q7Z5W8M2E3C9R6T0YH2K"));
        assert!(!is_ulid("81JBX4Q7Z5W8M2E3C9R6T0YH2K"));
        assert!(!is_ulid("01JBX4Q7Z5W8M2E3C9R6T0YH2I"));
        assert!(is_member_id("k3q7mzx2v4hbtnw5r6yjc2aefg"));
        assert!(is_hex64(&"a".repeat(64)));
        assert!(!is_hex64(&"A".repeat(64)));
    }

    #[test]
    fn ulids_sort_by_time_and_encode_the_time() {
        let a = new_ulid(1_793_721_438_157);
        let b = new_ulid(1_793_721_438_158);
        assert!(is_ulid(&a) && is_ulid(&b));
        assert!(a[..10] < b[..10]);
        // Known value: time 0 and zero randomness.
        assert_eq!(ulid_from_parts(0, &[0; 10]), "0".repeat(26));
        assert_eq!(
            ulid_from_parts(u64::MAX, &[0xFF; 10]),
            "7ZZZZZZZZZZZZZZZZZZZZZZZZZ"
        );
        // The ULID spec's example time 1469918176385 encodes as "01ARYZ6S41".
        assert_eq!(
            &ulid_from_parts(1_469_918_176_385, &[0; 10])[..10],
            "01ARYZ6S41"
        );
    }

    #[test]
    fn random_strings_have_their_alphabets() {
        let k = random_alnum(32);
        assert_eq!(k.len(), 32);
        assert!(k.bytes().all(|b| b.is_ascii_alphanumeric()));
        let t = random_token_hex(16);
        assert_eq!(t.len(), 32);
        assert!(t
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        let l = random_lower_alnum(8);
        assert!(l
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()));
        assert_ne!(random_token_hex(16), random_token_hex(16));
    }

    #[test]
    fn base32_matches_rfc4648() {
        // RFC 4648 §10 test vectors (without padding).
        for (input, out) in [
            ("", ""),
            ("f", "MY"),
            ("fo", "MZXQ"),
            ("foo", "MZXW6"),
            ("foob", "MZXW6YQ"),
            ("fooba", "MZXW6YTB"),
            ("foobar", "MZXW6YTBOI"),
        ] {
            assert_eq!(b32_upper(input.as_bytes()), out);
        }
        assert_eq!(b32_lower(b"foobar"), "mzxw6ytboi");
    }

    #[test]
    fn derived_ids_have_their_shapes() {
        let dev = "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2";
        let c = derive_class_id(dev, "q4m2zx7k3v5hbnw6r2yjc7aefg");
        assert!(is_class_id(&c), "{c}");
        assert_eq!(c, derive_class_id(dev, "q4m2zx7k3v5hbnw6r2yjc7aefg"));
        assert_ne!(c, derive_class_id(dev, "q4m2zx7k3v5hbnw6r2yjc7aefh"));
        let item = derive_item_id(1_793_721_438_157, dev, "q4m2zx7k3v5hbnw6r2yjc7aefg");
        assert!(is_ulid(&item));
        assert_eq!(
            &item[..10],
            &ulid_from_parts(1_793_721_438_157, &[0; 10])[..10]
        );
        assert!(is_member_id(&member_id(&[7u8; 32])));
    }

    #[test]
    fn device_ids_carry_valid_check_characters() {
        let id = device_id_from_cert_der(b"not really a certificate");
        assert!(is_device_id(&id), "{id}");
        assert!(is_valid_device_id(&id));
        let mut broken: Vec<char> = id.chars().collect();
        // Change the first character of the first group: its check character no longer fits.
        broken[0] = if broken[0] == 'A' { 'B' } else { 'A' };
        let broken: String = broken.into_iter().collect();
        assert!(!is_valid_device_id(&broken));
    }
}
