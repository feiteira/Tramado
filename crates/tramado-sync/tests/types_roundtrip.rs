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
