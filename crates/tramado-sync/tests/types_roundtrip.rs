// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Serde round trip of the sync IPC types over `test-vectors/ipc-samples.json` (architecture
//! §5), and the decision names of `test-vectors/admission.json` (R-SYNC adds `decide()` and
//! checks every case).

use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tramado_sync::{Decision, SyncEvent};

fn vectors(name: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-vectors")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

/// JSON equality where numbers compare by value (`1` == `1.0`).
fn same_json(a: &Value, b: &Value) -> bool {
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

fn roundtrip<T: Serialize + DeserializeOwned>(type_name: &str) {
    let v = vectors("ipc-samples.json");
    let list = v["types"][type_name]
        .as_array()
        .unwrap_or_else(|| panic!("no samples for {type_name}"))
        .clone();
    assert!(!list.is_empty());
    for sample in list {
        let t: T = serde_json::from_value(sample.clone())
            .unwrap_or_else(|e| panic!("{type_name} {sample}: {e}"));
        let back = serde_json::to_value(&t).unwrap();
        assert!(
            same_json(&back, &sample),
            "{type_name}: {sample} came back as {back}"
        );
    }
}

#[test]
fn types_roundtrip() {
    roundtrip::<SyncEvent>("SyncEvent");
}

#[test]
fn every_sync_event_variant_has_a_sample() {
    let v = vectors("ipc-samples.json");
    let kinds: Vec<String> = v["types"]["SyncEvent"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["type"].as_str().unwrap().to_string())
        .collect();
    for k in [
        "status",
        "gap",
        "remoteChange",
        "folder",
        "completion",
        "indexUpdated",
        "connection",
        "joinRequest",
        "joinRequestGone",
        "admitted",
        "admittedMe",
        "folderOffer",
        "foreignWrite",
        "massDelete",
        "massDeleteRemote",
        "folderErrors",
        "markerMissing",
        "listenAddresses",
    ] {
        assert!(kinds.iter().any(|x| x == k), "no sample of {k}");
    }
}

#[test]
fn admission_decisions_parse() {
    let v = vectors("admission.json");
    let cases = v["cases"].as_array().unwrap();
    assert!(cases.len() >= 11);
    for c in cases {
        let _: Decision =
            serde_json::from_value(c["expect"].clone()).unwrap_or_else(|e| panic!("{c}: {e}"));
    }
}

/// `decide()` (architecture §5.3) on every case of the shared vectors, through the public API
/// (TS `core/sync/admission.ts` runs the same file).
#[test]
fn admission_decide_matches_every_vector() {
    use std::collections::BTreeMap;
    use tramado_sync::admission::decide;
    use tramado_sync::{ClassPolicy, FolderOffer, GlobalPolicy};
    let v = vectors("admission.json");
    let devices = v["devices"].as_object().unwrap().clone();
    let dev = |s: &str| {
        devices
            .get(s)
            .and_then(Value::as_str)
            .unwrap_or(s)
            .to_string()
    };
    let list = |x: &Value| -> Vec<String> {
        x.as_array()
            .into_iter()
            .flatten()
            .map(|d| dev(d.as_str().unwrap()))
            .collect()
    };
    let class = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    for c in v["cases"].as_array().unwrap() {
        let p = &c["policy"];
        let mut policies = BTreeMap::new();
        policies.insert(
            class.to_string(),
            ClassPolicy {
                class_id: class.into(),
                label: "x".into(),
                ask_before_admit: p["askBeforeAdmit"].as_bool().unwrap_or(false),
                roster: vec![],
                known_devices: list(&p["knownDevices"]),
                banned_devices: list(&p["bannedDevices"]),
                updated_at: String::new(),
            },
        );
        let g = &c["global"];
        let global = GlobalPolicy {
            own_devices: list(&g["ownDevices"]),
            pairing_open_until: g["pairingOpenUntil"].as_u64(),
        };
        let o = &c["offer"];
        let offer = FolderOffer {
            folder_id: o["folderId"].as_str().unwrap_or(class).into(),
            device_id: dev(o["deviceId"].as_str().unwrap_or("D1")),
            in_folder: o["inFolder"].as_bool().unwrap_or(false),
        };
        let want: Decision = serde_json::from_value(c["expect"].clone()).unwrap();
        assert_eq!(
            decide(&policies, &global, &offer, c["now"].as_u64().unwrap_or(0)),
            want,
            "{}",
            c["name"]
        );
    }
}
