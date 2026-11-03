// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The shared test vectors (`test-vectors/*.json`, architecture §17) that `tramado-base`
//! implements: class paths, error codes, time strings, derived and device IDs, and the IPC
//! samples of the types this crate owns. The TypeScript suite reads the same files.

use std::path::PathBuf;

use serde_json::Value;
use tramado_base::confine::{confine, validate_class_path};
use tramado_base::error::{AppError, Code};
use tramado_base::registry::{ClassEntry, ClassEntryView};
use tramado_base::watch::ClassChanged;
use tramado_base::{ids, time};

fn vectors(name: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-vectors")
        .join(name);
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
    serde_json::from_str(&text).unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

/// JSON equality where numbers compare by value (`1` == `1.0`).
pub fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

fn b64_decode(input: &str) -> Vec<u8> {
    let val = |c: u8| -> u32 {
        match c {
            b'A'..=b'Z' => u32::from(c - b'A'),
            b'a'..=b'z' => u32::from(c - b'a') + 26,
            b'0'..=b'9' => u32::from(c - b'0') + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => panic!("bad base64 {c}"),
        }
    };
    let mut out = Vec::new();
    let mut acc = 0u32;
    let mut bits = 0;
    for c in input.bytes().filter(|c| *c != b'=') {
        acc = (acc << 6) | val(c);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

fn hex_decode(h: &str) -> Vec<u8> {
    (0..h.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn class_paths() {
    let v = vectors("class-paths.json");
    let valid = v["valid"].as_array().unwrap();
    assert!(valid.len() >= 5);
    for p in valid {
        assert!(validate_class_path(s(p)).is_ok(), "should be valid: {p}");
    }
    let invalid = v["invalid"].as_array().unwrap();
    assert!(invalid.len() >= 16);
    for case in invalid {
        let e = validate_class_path(s(&case["path"])).unwrap_err();
        assert_eq!(e.code(), Code::Invalid, "{case}");
    }
    // `confine` applies the same rules (and adds the symlink walk).
    let dir = tempfile::tempdir().unwrap();
    for p in valid {
        assert!(confine(dir.path(), s(p)).is_ok(), "{p}");
    }
    for case in invalid {
        assert!(confine(dir.path(), s(&case["path"])).is_err(), "{case}");
    }
}

#[test]
fn error_codes() {
    let v = vectors("error-codes.json");
    let codes: Vec<&str> = v["codes"].as_array().unwrap().iter().map(s).collect();
    let ours: Vec<&str> = Code::ALL.iter().map(|c| c.as_str()).collect();
    assert_eq!(
        ours, codes,
        "Rust Code list == test-vectors/error-codes.json (same order)"
    );
}

#[test]
fn time_strings() {
    let v = vectors("time.json");
    for case in v["instant"].as_array().unwrap() {
        assert_eq!(
            time::instant(case["ms"].as_u64().unwrap()),
            s(&case["instant"]),
            "{case}"
        );
    }
    for case in v["parse"].as_array().unwrap() {
        assert_eq!(
            time::parse_rfc3339(s(&case["s"])),
            Some(case["ms"].as_i64().unwrap()),
            "{case}"
        );
    }
    for bad in v["invalid"].as_array().unwrap() {
        assert_eq!(time::parse_rfc3339(s(bad)), None, "{bad}");
    }
}

#[test]
fn derived_and_device_ids() {
    let v = vectors("ids.json");
    for case in v["classId"].as_array().unwrap() {
        assert_eq!(
            ids::derive_class_id(s(&case["deviceId"]), s(&case["idNonce"])),
            s(&case["classId"]),
            "{case}"
        );
    }
    for case in v["itemId"].as_array().unwrap() {
        let got = ids::derive_item_id(
            case["ms"].as_u64().unwrap(),
            s(&case["deviceId"]),
            s(&case["idNonce"]),
        );
        assert_eq!(got, s(&case["itemId"]), "{case}");
    }
    for case in v["memberId"].as_array().unwrap() {
        assert_eq!(
            ids::member_id(&hex_decode(s(&case["pubHex"]))),
            s(&case["memberId"]),
            "{case}"
        );
    }
    for case in v["deviceIdOfCert"].as_array().unwrap() {
        let der = b64_decode(s(&case["certDerB64"]));
        assert_eq!(ids::sha256_hex(&der), s(&case["sha256Hex"]));
        let id = ids::device_id_from_cert_der(&der);
        assert_eq!(id, s(&case["deviceId"]), "{case}");
        assert!(ids::is_valid_device_id(&id));
    }
    for case in v["deviceIdOfHash"].as_array().unwrap() {
        let mut h = [0u8; 32];
        h.copy_from_slice(&hex_decode(s(&case["hashHex"])));
        assert_eq!(
            ids::device_id_from_sha256(&h),
            s(&case["deviceId"]),
            "{case}"
        );
    }
    for case in v["shortId"].as_array().unwrap() {
        assert_eq!(ids::short_id(s(&case["deviceId"])), s(&case["shortId"]));
        assert!(ids::is_short_id(s(&case["shortId"])));
    }
    for bad in v["invalidDeviceIds"].as_array().unwrap() {
        assert!(!ids::is_valid_device_id(s(bad)), "{bad}");
    }
}

#[test]
fn ipc_samples_of_base_types() {
    let v = vectors("ipc-samples.json");
    let types = &v["types"];
    for sample in types["Code"].as_array().unwrap() {
        let c: Code = serde_json::from_value(sample.clone()).unwrap();
        assert_eq!(&serde_json::to_value(c).unwrap(), sample);
    }
    for sample in types["ErrorPayload"].as_array().unwrap() {
        let code: Code = serde_json::from_value(sample["code"].clone()).unwrap();
        let mut e = AppError::new(code, s(&sample["message"]));
        if let Some(d) = sample.get("data") {
            e = e.with_data(d.clone());
        }
        assert!(
            same_json(&serde_json::to_value(&e).unwrap(), sample),
            "{sample}"
        );
    }
    for sample in types["ClassChangedEvent"].as_array().unwrap() {
        let e: ClassChanged = serde_json::from_value(sample.clone()).unwrap();
        assert!(
            same_json(&serde_json::to_value(&e).unwrap(), sample),
            "{sample}"
        );
    }
    for sample in types["ClassEntry"].as_array().unwrap() {
        let view: ClassEntryView = serde_json::from_value(sample.clone()).unwrap();
        assert!(
            view.entry.unknown.is_empty(),
            "every field is known: {:?}",
            view.entry.unknown
        );
        assert!(
            same_json(&serde_json::to_value(&view).unwrap(), sample),
            "{sample}"
        );
        let entry: ClassEntry = view.entry;
        assert!(ids::is_class_id(&entry.class_id));
    }
}
