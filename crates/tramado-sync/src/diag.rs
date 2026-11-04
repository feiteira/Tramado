// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Diagnostics for "Copy diagnostics" (sync spec §23): status, ports, listeners, connections,
//! recent errors and the log tail, with every device ID truncated to its ShortId and nothing
//! that could carry the API key.

/// Replaces every dashed device ID in `s` by its ShortId (first 7 characters).
pub fn truncate_device_ids(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let is_b32 = |c: u8| c.is_ascii_uppercase() || (b'2'..=b'7').contains(&c);
    while i < b.len() {
        if i + 63 <= b.len() && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let cand = &b[i..i + 63];
            let shaped =
                cand.iter().enumerate().all(
                    |(k, c)| {
                        if k % 8 == 7 {
                            *c == b'-'
                        } else {
                            is_b32(*c)
                        }
                    },
                );
            let ends = i + 63 == b.len() || !b[i + 63].is_ascii_alphanumeric();
            if shaped && ends {
                out.push_str(&s[i..i + 7]);
                i += 63;
                continue;
            }
        }
        let ch = s[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// A log line safe to copy: device IDs truncated, API-key-like values masked.
pub fn scrub(line: &str, api_key: Option<&str>) -> String {
    let mut s = truncate_device_ids(line);
    if let Some(k) = api_key.filter(|k| !k.is_empty()) {
        s = s.replace(k, "<key>");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_ids_become_short_ids() {
        let id = "LMRSFKK-CDQBSRF-UNW65YW-RJASPVK-ISWFVO5-CP2CB54-64AZW4S-U5MGNQH";
        assert_eq!(
            truncate_device_ids(&format!("INF Connected to {id} at tcp")),
            "INF Connected to LMRSFKK at tcp"
        );
        assert_eq!(truncate_device_ids(id), "LMRSFKK");
        assert_eq!(truncate_device_ids("ação — ok"), "ação — ok");
        assert_eq!(scrub("key=SECRETKEY1", Some("SECRETKEY1")), "key=<key>");
    }
}
