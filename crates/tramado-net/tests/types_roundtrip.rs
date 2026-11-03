// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Serde round trip of the IPC types of this crate over `test-vectors/ipc-samples.json`
//! (architecture §5): each sample deserialises and serialises back to the same JSON.

use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tramado_net::ai::{AiBase, AiPipeRequest, AiWireEvent, Method};
use tramado_net::privacy::PrivacyLevel;

fn samples(type_name: &str) -> Vec<Value> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-vectors/ipc-samples.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    let list = v["types"][type_name]
        .as_array()
        .unwrap_or_else(|| panic!("no samples for {type_name}"))
        .clone();
    assert!(!list.is_empty(), "{type_name}");
    list
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
    for sample in samples(type_name) {
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
    roundtrip::<PrivacyLevel>("PrivacyLevel");
    roundtrip::<Method>("Method");
    roundtrip::<AiBase>("AiBase");
    roundtrip::<AiWireEvent>("AiWireEvent");
    roundtrip::<AiPipeRequest>("AiPipeRequest");
}
