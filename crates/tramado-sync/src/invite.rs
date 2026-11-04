// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Invite codes, decoded and validated **in Rust** (sync spec §7.2–§7.3, §9.5): a join adds
//! exactly the devices of the code Rust decoded itself, never a list the webview made up.

use base64::Engine as _;
use serde_json::Value;
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::ids;

use crate::types::DeviceSpec;

pub const MAX_CODE: usize = 4096;
const MIN_CODE: usize = 40;
const MAX_DEVICES: usize = 3;
const MAX_ADDRESSES: usize = 5;

/// What a join needs from a valid `InviteV1`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invite {
    /// `f`: the class (folder) ID.
    pub folder: String,
    /// `l`, ≤ 120 chars.
    pub label: String,
    /// `n`, ≤ 64 chars.
    pub inviter_name: String,
    /// `d`, normalised, 1–3, each with its valid addresses.
    pub devices: Vec<DeviceSpec>,
    /// `t`
    pub created: u64,
    /// `x` (advisory)
    pub expires: Option<u64>,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(Code::SyncInviteInvalid, msg.to_string())
}

/// Canonical dashed device ID for any case, dashes or spaces, or `None` (local twin of
/// `GET /rest/svc/deviceid` for 56-character IDs; the Luhn check characters must be right).
pub fn normalize_device_id(s: &str) -> Option<String> {
    let flat: String = s
        .chars()
        .filter(|c| *c != '-' && *c != ' ')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if flat.len() != 56
        || !flat
            .bytes()
            .all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b))
    {
        return None;
    }
    let groups: Vec<&str> = (0..8).map(|i| &flat[i * 7..(i + 1) * 7]).collect();
    let id = groups.join("-");
    ids::is_valid_device_id(&id).then_some(id)
}

fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_code_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// The first `tr[ip]<digits>_<payload>` in the text (§7.2 parsing rule):
/// `(kind, version digits, payload)`.
fn find_code(text: &str) -> AppResult<Option<(char, String, String)>> {
    let b = text.as_bytes();
    let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b't' && b[i + 1] == b'r' && (i == 0 || !is_word(b[i - 1])) {
            let kind = b[i + 2];
            if kind == b'i' || kind == b'p' {
                let mut j = i + 3;
                let ds = j;
                while j < b.len() && b[j].is_ascii_digit() {
                    j += 1;
                }
                if j > ds && j < b.len() && b[j] == b'_' {
                    let ps = j + 1;
                    let mut k = ps;
                    while k < b.len() && is_code_char(b[k]) {
                        k += 1;
                    }
                    let len = k - ps;
                    if len >= MIN_CODE {
                        if len > MAX_CODE {
                            return Err(invalid("the invite code is too long"));
                        }
                        return Ok(Some((
                            kind as char,
                            text[ds..j].to_string(),
                            text[ps..k].to_string(),
                        )));
                    }
                }
            }
        }
        i += 1;
    }
    Ok(None)
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn valid_host(h: &str) -> bool {
    if let Some(inner) = h.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
        return inner.parse::<std::net::Ipv6Addr>().is_ok();
    }
    !h.is_empty()
        && h.len() <= 253
        && h.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
}

fn valid_host_port(hp: &str) -> bool {
    let Some((host, port)) = hp.rsplit_once(':') else {
        return false;
    };
    valid_host(host) && port.parse::<u16>().is_ok_and(|p| p > 0)
}

/// `tcp://host:port`, `quic://host:port` or `relay://host:port/?id=…` (§7.3).
pub fn valid_address(a: &str) -> bool {
    if a.len() > 300 || a.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    if let Some(hp) = a
        .strip_prefix("tcp://")
        .or_else(|| a.strip_prefix("quic://"))
    {
        return valid_host_port(hp);
    }
    if let Some(rest) = a.strip_prefix("relay://") {
        let (hp, q) = match rest.split_once("/?") {
            Some((hp, q)) => (hp, q),
            None => match rest.split_once('?') {
                Some((hp, q)) => (hp, q),
                None => return false,
            },
        };
        return valid_host_port(hp)
            && q.split('&')
                .any(|kv| kv.strip_prefix("id=").is_some_and(|v| !v.is_empty()));
    }
    false
}

/// Decodes and validates an invite (§7.3). `me` is this device: its own invite is refused
/// (`SYNC_INVITE_INVALID` with `data.reason = "own"`).
pub fn decode(text: &str, me: Option<&str>) -> AppResult<Invite> {
    let Some((kind, version, payload)) = find_code(text)? else {
        return Err(invalid("no invite code in the text"));
    };
    if kind == 'p' {
        return Err(invalid("pairing codes are not supported in this version"));
    }
    let v: u64 = version.parse().map_err(|_| invalid("bad invite version"))?;
    if v > 1 {
        return Err(AppError::new(
            Code::NewerFormat,
            "the invite needs a newer Tramado",
        ));
    }
    if v != 1 {
        return Err(invalid("bad invite version"));
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| invalid("the invite code is damaged"))?;
    let json: Value =
        serde_json::from_slice(&bytes).map_err(|_| invalid("the invite code is damaged"))?;
    let pv = json["v"]
        .as_u64()
        .ok_or_else(|| invalid("the invite has no version"))?;
    if pv > 1 {
        return Err(AppError::new(
            Code::NewerFormat,
            "the invite needs a newer Tramado",
        ));
    }
    if pv != 1 {
        return Err(invalid("bad invite version"));
    }
    let folder = json["f"].as_str().unwrap_or_default().to_string();
    if !ids::is_class_id(&folder) {
        return Err(invalid("the invite names no class"));
    }
    let mut devices: Vec<DeviceSpec> = Vec::new();
    for (i, d) in json["d"].as_array().into_iter().flatten().enumerate() {
        if i >= MAX_DEVICES {
            break;
        }
        let Some(id) = d["id"].as_str().and_then(normalize_device_id) else {
            continue;
        };
        if devices.iter().any(|x| x.device_id == id) {
            continue;
        }
        let mut addresses: Vec<String> = Vec::new();
        for a in d["a"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if addresses.len() < MAX_ADDRESSES
                && valid_address(a)
                && !addresses.iter().any(|x| x == a)
            {
                addresses.push(a.to_string());
            }
        }
        devices.push(DeviceSpec {
            device_id: id,
            name: String::new(),
            addresses,
        });
    }
    if devices.is_empty() {
        return Err(invalid("the invite names no valid device"));
    }
    if let Some(me) = me {
        if devices.iter().any(|d| d.device_id == me) {
            return Err(invalid("this is your own invite")
                .with_data(serde_json::json!({ "reason": "own" })));
        }
    }
    let label = truncate(json["l"].as_str().unwrap_or_default().trim(), 120);
    let inviter_name = truncate(json["n"].as_str().unwrap_or_default().trim(), 64);
    if let Some(first) = devices.first_mut() {
        first.name = inviter_name.clone();
    }
    Ok(Invite {
        folder,
        label,
        inviter_name,
        devices,
        created: json["t"].as_u64().unwrap_or(0),
        expires: json["x"].as_u64(),
    })
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use serde_json::json;

    pub const D1: &str = "5QDNN46-YHG4AH2-3NWSGYW-RYXVGJP-JORVLZ4-3VGOMPY-S5KL2O6-AXZBAQE";
    pub const D2: &str = "Z46L5BQ-GJG7OWZ-P5LVPPJ-P3KQOBQ-JH5GPI7-2FJQ25U-CWVVI7Y-DDEGEAT";
    pub const F: &str = "tramado-geznkyujw4ofedwinfcmzl2rim";

    pub fn code(v: &Value) -> String {
        format!(
            "tri1_{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(v).unwrap())
        )
    }

    pub fn invite_json(devs: &[&str]) -> Value {
        json!({"v":1,"f":F,"l":"Teoria Geral do Direito Civil","s":"TGDC","c":"#3e63dd","i":"scale",
               "m":"k3q7mzx2v4hbtnw5r6yjc2aefg","n":"Ana Ribeiro",
               "d": devs.iter().map(|d| json!({"id": d.replace('-', ""), "a": ["tcp://192.168.1.20:22117",
                    "relay://95.216.157.10:22067/?id=NZRTFEN-2BDQUHB", "ftp://x:1", "tcp://bad"]})).collect::<Vec<_>>(),
               "t":1793721438})
    }

    #[test]
    fn device_ids_normalise_locally() {
        assert_eq!(
            normalize_device_id(&D1.to_lowercase().replace('-', "")).as_deref(),
            Some(D1)
        );
        assert_eq!(normalize_device_id(D2).as_deref(), Some(D2));
        // a wrong check character
        let mut bad = D1.to_string();
        bad.replace_range(6..7, if &D1[6..7] == "A" { "B" } else { "A" });
        assert_eq!(normalize_device_id(&bad), None);
        assert_eq!(normalize_device_id("NOTVALID-123"), None);
    }

    #[test]
    fn decodes_a_pasted_sentence_and_keeps_valid_addresses() {
        let text = format!(
            "Join TGDC: tramado://join/{} (from Ana)",
            code(&invite_json(&[D1, D2]))
        );
        let inv = decode(&text, None).unwrap();
        assert_eq!(inv.folder, F);
        assert_eq!(inv.devices.len(), 2);
        assert_eq!(inv.devices[0].device_id, D1);
        assert_eq!(inv.devices[0].name, "Ana Ribeiro");
        assert_eq!(
            inv.devices[0].addresses,
            vec![
                "tcp://192.168.1.20:22117",
                "relay://95.216.157.10:22067/?id=NZRTFEN-2BDQUHB"
            ]
        );
        assert_eq!(inv.label, "Teoria Geral do Direito Civil");
    }

    #[test]
    fn refuses_own_newer_damaged_and_oversized_codes() {
        let c = code(&invite_json(&[D1]));
        let e = decode(&c, Some(D1)).unwrap_err();
        assert_eq!(e.code(), Code::SyncInviteInvalid);
        assert_eq!(e.data().unwrap()["reason"], "own");
        assert_eq!(
            decode(&c.replacen("tri1_", "tri2_", 1), None)
                .unwrap_err()
                .code(),
            Code::NewerFormat
        );
        let mut v2 = invite_json(&[D1]);
        v2["v"] = json!(2);
        assert_eq!(
            decode(&code(&v2), None).unwrap_err().code(),
            Code::NewerFormat
        );
        let mut nof = invite_json(&[D1]);
        nof["f"] = json!("photos");
        assert_eq!(
            decode(&code(&nof), None).unwrap_err().code(),
            Code::SyncInviteInvalid
        );
        let nodev = json!({"v":1,"f":F,"l":"x","n":"y","d":[{"id":"bad","a":[]}],"t":1});
        assert_eq!(
            decode(&code(&nodev), None).unwrap_err().code(),
            Code::SyncInviteInvalid
        );
        let long = format!("tri1_{}", "A".repeat(MAX_CODE + 1));
        assert_eq!(
            decode(&long, None).unwrap_err().code(),
            Code::SyncInviteInvalid
        );
        assert_eq!(
            decode("nothing here", None).unwrap_err().code(),
            Code::SyncInviteInvalid
        );
        let damaged = format!("tri1_{}", "A".repeat(50));
        assert_eq!(
            decode(&damaged, None).unwrap_err().code(),
            Code::SyncInviteInvalid
        );
        // a pairing code is not an invite in 0.1
        assert_eq!(
            decode(&c.replacen("tri1_", "trp1_", 1), None)
                .unwrap_err()
                .code(),
            Code::SyncInviteInvalid
        );
    }

    #[test]
    fn at_most_three_devices_and_five_addresses() {
        let mut v = invite_json(&[D1, D2, D1]);
        v["d"][0]["a"] = json!([
            "tcp://10.0.0.1:1",
            "tcp://10.0.0.2:2",
            "tcp://10.0.0.3:3",
            "tcp://10.0.0.4:4",
            "tcp://10.0.0.5:5",
            "tcp://10.0.0.6:6"
        ]);
        let inv = decode(&code(&v), None).unwrap();
        assert_eq!(inv.devices.len(), 2); // the duplicate is dropped
        assert_eq!(inv.devices[0].addresses.len(), 5);
        assert!(valid_address("tcp://[fd00::1]:22100"));
        assert!(!valid_address("relay://1.2.3.4:22067/"));
    }
}
