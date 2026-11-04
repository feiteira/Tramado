// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! An in-memory Syncthing for unit tests (the "fake client" of plan §3.2): the config endpoints
//! with Syncthing's replace semantics (§3.3), pending devices and folders (which disappear once
//! the device is configured or the folder shared with it, as in the real daemon), `db/file`,
//! completion, connections and a log of every call.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::Duration;

use percent_encoding::percent_decode_str;
use serde_json::{json, Map, Value};
use tramado_base::error::AppResult;

use crate::client::{Method, Resp, Rest};

pub const ME: &str = "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";

#[derive(Default)]
pub struct State {
    pub me: String,
    pub config: Value,
    pub pending_devices: BTreeMap<String, Value>,
    /// folder → device → offer
    pub pending_folders: BTreeMap<String, BTreeMap<String, Value>>,
    pub files: HashMap<(String, String), Value>,
    pub connections: Map<String, Value>,
    pub completion: HashMap<(String, String), Value>,
    pub ignores: HashMap<String, Vec<String>>,
    pub status: HashMap<String, Value>,
    pub versions: HashMap<String, Value>,
    pub restored: Vec<(String, Value)>,
    /// path prefixes that answer 500
    pub fail: Vec<String>,
    pub calls: Vec<(Method, String, Option<Value>)>,
}

pub struct FakeSt {
    pub st: Mutex<State>,
}

fn query(q: &str) -> HashMap<String, String> {
    q.split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| {
            (
                k.to_string(),
                percent_decode_str(v).decode_utf8_lossy().into_owned(),
            )
        })
        .collect()
}

fn ok(body: Value) -> AppResult<Resp> {
    Ok(Resp { status: 200, body })
}

fn status(code: u16, text: &str) -> AppResult<Resp> {
    Ok(Resp {
        status: code,
        body: Value::String(text.to_string()),
    })
}

fn merge(dst: &mut Value, patch: &Value) {
    if let (Some(d), Some(p)) = (dst.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            d.insert(k.clone(), v.clone());
        }
    }
}

impl FakeSt {
    pub fn new() -> Self {
        let me = ME.to_string();
        let config = json!({
            "version": 52,
            "devices": [{"deviceID": me, "name": "Tramado", "addresses": ["dynamic"], "paused": false,
                         "ignoredFolders": []}],
            "folders": [],
            "remoteIgnoredDevices": [],
            "options": {},
            "gui": {"user": "tramado", "password": "$2a$10$x"},
            "defaults": {}
        });
        FakeSt {
            st: Mutex::new(State {
                me,
                config,
                ..State::default()
            }),
        }
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut State) -> T) -> T {
        f(&mut self.st.lock().unwrap())
    }

    pub fn calls(&self) -> Vec<(Method, String, Option<Value>)> {
        self.with(|s| s.calls.clone())
    }

    pub fn clear_calls(&self) {
        self.with(|s| s.calls.clear())
    }

    /// Calls that changed the config.
    pub fn writes(&self) -> Vec<(Method, String, Option<Value>)> {
        self.calls()
            .into_iter()
            .filter(|(m, p, _)| *m != Method::Get && p.starts_with("/rest/config"))
            .collect()
    }

    pub fn add_folder(&self, id: &str, devices: &[&str]) {
        self.with(|s| {
            let devs: Vec<Value> = devices.iter().map(|d| json!({"deviceID": d})).collect();
            s.config["folders"].as_array_mut().unwrap().push(
                json!({"id": id, "label": "TGDC", "path": "/x", "paused": false, "devices": devs}),
            );
        })
    }

    pub fn add_device(&self, id: &str) {
        self.with(|s| {
            if s.configured(id) {
                return;
            }
            s.config["devices"].as_array_mut().unwrap().push(
                json!({"deviceID": id, "name": "", "addresses": ["dynamic"], "paused": false, "ignoredFolders": []}),
            )
        })
    }

    pub fn knock(&self, dev: &str, name: &str, address: &str) {
        self.with(|s| {
            s.pending_devices.insert(
                dev.to_string(),
                json!({"time": "2026-11-04T10:00:00Z", "name": name, "address": address}),
            );
        })
    }

    pub fn offer(&self, folder: &str, dev: &str) {
        self.with(|s| {
            s.pending_folders.entry(folder.to_string()).or_default().insert(
                dev.to_string(),
                json!({"time": "2026-11-04T10:00:01Z", "label": "TGDC", "receiveEncrypted": false, "remoteEncrypted": false}),
            );
        })
    }

    pub fn set_file(&self, folder: &str, path: &str, v: Value) {
        self.with(|s| {
            s.files.insert((folder.to_string(), path.to_string()), v);
        })
    }

    pub fn connect(&self, dev: &str) {
        self.with(|s| {
            s.connections.insert(
                dev.to_string(),
                json!({"connected": true, "paused": false, "address": "127.0.0.1:22100", "type": "tcp-client"}),
            );
        })
    }

    pub fn folder_devices(&self, folder: &str) -> Vec<String> {
        self.with(|s| {
            s.config["folders"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["id"] == folder)
                .map(crate::client::folder_devices)
                .unwrap_or_default()
        })
    }

    pub fn device_ids(&self) -> Vec<String> {
        self.with(|s| {
            s.config["devices"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|d| d["deviceID"].as_str().map(str::to_string))
                .collect()
        })
    }

    pub fn ignored_ids(&self) -> Vec<(String, String)> {
        self.with(|s| {
            s.config["remoteIgnoredDevices"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| {
                    (
                        d["deviceID"].as_str().unwrap().to_string(),
                        d["name"].as_str().unwrap_or_default().to_string(),
                    )
                })
                .collect()
        })
    }

    pub fn device(&self, id: &str) -> Option<Value> {
        self.with(|s| {
            s.config["devices"]
                .as_array()
                .unwrap()
                .iter()
                .find(|d| d["deviceID"] == id)
                .cloned()
        })
    }
}

impl State {
    fn list(&mut self, key: &str) -> &mut Vec<Value> {
        self.config[key].as_array_mut().expect("config array")
    }

    fn configured(&self, dev: &str) -> bool {
        self.config["devices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["deviceID"] == dev)
    }

    fn ignored(&self, dev: &str) -> bool {
        self.config["remoteIgnoredDevices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["deviceID"] == dev)
    }

    fn shares(&self, folder: &str, dev: &str) -> bool {
        self.config["folders"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["id"] == folder && crate::client::folder_devices(f).iter().any(|d| d == dev))
    }
}

impl Rest for FakeSt {
    fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        _timeout: Duration,
    ) -> AppResult<Resp> {
        let mut s = self.st.lock().unwrap();
        s.calls.push((method, path.to_string(), body.cloned()));
        if s.fail.iter().any(|f| path.starts_with(f.as_str())) {
            return status(500, "fake: failing on purpose");
        }
        let (p, q) = path.split_once('?').unwrap_or((path, ""));
        let q = query(q);
        let seg: Vec<String> = p
            .split('/')
            .map(|x| percent_decode_str(x).decode_utf8_lossy().into_owned())
            .collect();
        let seg: Vec<&str> = seg.iter().map(String::as_str).collect();
        match (method, &seg[..]) {
            (Method::Get, ["", "rest", "noauth", "health"]) => ok(json!({"status": "OK"})),
            (Method::Get, ["", "rest", "system", "status"]) => {
                ok(json!({"myID": s.me, "connectionServiceStatus": {}}))
            }
            (Method::Get, ["", "rest", "system", "connections"]) => {
                ok(json!({"connections": s.connections, "total": {}}))
            }
            (Method::Get, ["", "rest", "stats", "device"]) => ok(json!({})),
            (Method::Get, ["", "rest", "config"]) => ok(s.config.clone()),
            (Method::Put, ["", "rest", "config"]) => {
                s.config = body.cloned().unwrap_or(Value::Null);
                ok(Value::Null)
            }
            (Method::Patch, ["", "rest", "config", "options"]) => {
                let b = body.cloned().unwrap_or_default();
                merge(&mut s.config["options"], &b);
                ok(Value::Null)
            }
            (Method::Get, ["", "rest", "config", "gui"]) => ok(s.config["gui"].clone()),
            (Method::Patch, ["", "rest", "config", "gui"]) => {
                let b = body.cloned().unwrap_or_default();
                merge(&mut s.config["gui"], &b);
                ok(Value::Null)
            }
            (Method::Get, ["", "rest", "config", "devices"]) => ok(s.config["devices"].clone()),
            (Method::Post, ["", "rest", "config", "devices"]) => {
                let mut d = json!({"paused": false, "ignoredFolders": [], "addresses": ["dynamic"], "name": ""});
                merge(&mut d, body.unwrap_or(&Value::Null));
                let id = d["deviceID"].clone();
                let list = s.list("devices");
                list.retain(|x| x["deviceID"] != id); // POST replaces (✔ §3.3)
                list.push(d);
                ok(Value::Null)
            }
            (m, ["", "rest", "config", "devices", id]) => {
                let id = id.to_string();
                let pos = s.list("devices").iter().position(|x| x["deviceID"] == id);
                match (m, pos) {
                    (_, None) => status(404, "no such device"),
                    (Method::Get, Some(i)) => ok(s.list("devices")[i].clone()),
                    (Method::Patch, Some(i)) => {
                        let b = body.cloned().unwrap_or_default();
                        merge(&mut s.list("devices")[i], &b);
                        ok(Value::Null)
                    }
                    (Method::Delete, Some(i)) => {
                        s.list("devices").remove(i);
                        for f in s.list("folders") {
                            if let Some(a) = f["devices"].as_array_mut() {
                                a.retain(|d| d["deviceID"] != id.as_str());
                            }
                        }
                        ok(Value::Null)
                    }
                    _ => status(405, "method"),
                }
            }
            (Method::Get, ["", "rest", "config", "folders"]) => ok(s.config["folders"].clone()),
            (Method::Post, ["", "rest", "config", "folders"]) => {
                let mut f = json!({"paused": false, "devices": []});
                merge(&mut f, body.unwrap_or(&Value::Null));
                let id = f["id"].clone();
                let list = s.list("folders");
                list.retain(|x| x["id"] != id);
                list.push(f);
                ok(Value::Null)
            }
            (m, ["", "rest", "config", "folders", id]) => {
                let id = id.to_string();
                let pos = s.list("folders").iter().position(|x| x["id"] == id);
                match (m, pos) {
                    (_, None) => status(404, "no such folder"),
                    (Method::Get, Some(i)) => ok(s.list("folders")[i].clone()),
                    (Method::Patch, Some(i)) => {
                        let b = body.cloned().unwrap_or_default();
                        merge(&mut s.list("folders")[i], &b);
                        ok(Value::Null)
                    }
                    (Method::Delete, Some(i)) => {
                        s.list("folders").remove(i);
                        ok(Value::Null)
                    }
                    _ => status(405, "method"),
                }
            }
            (Method::Get, ["", "rest", "cluster", "pending", "devices"]) => {
                let mut out = Map::new();
                for (d, v) in &s.pending_devices {
                    if !s.configured(d) && !s.ignored(d) {
                        out.insert(d.clone(), v.clone());
                    }
                }
                ok(Value::Object(out))
            }
            (Method::Delete, ["", "rest", "cluster", "pending", "devices"]) => {
                if let Some(d) = q.get("device") {
                    s.pending_devices.remove(d);
                }
                ok(Value::Null)
            }
            (Method::Get, ["", "rest", "cluster", "pending", "folders"]) => {
                let mut out = Map::new();
                for (f, offers) in &s.pending_folders {
                    let mut by = Map::new();
                    for (d, o) in offers {
                        // shown only once the device is configured (✔ §3.5), never once shared
                        if s.configured(d) && !s.shares(f, d) {
                            by.insert(d.clone(), o.clone());
                        }
                    }
                    if !by.is_empty() {
                        out.insert(f.clone(), json!({"offeredBy": by}));
                    }
                }
                ok(Value::Object(out))
            }
            (Method::Delete, ["", "rest", "cluster", "pending", "folders"]) => {
                if let (Some(f), Some(d)) = (q.get("folder"), q.get("device")) {
                    if let Some(o) = s.pending_folders.get_mut(f) {
                        o.remove(d);
                    }
                }
                ok(Value::Null)
            }
            (Method::Post, ["", "rest", "db", "ignores"]) => {
                let f = q.get("folder").cloned().unwrap_or_default();
                let lines = body
                    .and_then(|b| b["ignore"].as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                s.ignores.insert(f, lines);
                ok(Value::Null)
            }
            (Method::Get, ["", "rest", "db", "ignores"]) => {
                let f = q.get("folder").cloned().unwrap_or_default();
                ok(json!({"ignore": s.ignores.get(&f).cloned().unwrap_or_default()}))
            }
            (Method::Post, ["", "rest", "db", "scan"]) => ok(Value::Null),
            (Method::Get, ["", "rest", "db", "file"]) => {
                let key = (
                    q.get("folder").cloned().unwrap_or_default(),
                    q.get("file").cloned().unwrap_or_default(),
                );
                match s.files.get(&key) {
                    Some(v) => ok(v.clone()),
                    None => status(404, "No such object in the index"),
                }
            }
            (Method::Get, ["", "rest", "db", "completion"]) => {
                let key = (
                    q.get("folder").cloned().unwrap_or_default(),
                    q.get("device").cloned().unwrap_or_default(),
                );
                ok(s.completion.get(&key).cloned().unwrap_or_else(|| {
                    json!({"completion": 100, "needItems": 0, "needBytes": 0, "remoteState": "unknown"})
                }))
            }
            (Method::Get, ["", "rest", "db", "status"]) => {
                let f = q.get("folder").cloned().unwrap_or_default();
                ok(s.status.get(&f).cloned().unwrap_or_else(|| {
                    json!({"state": "idle", "globalFiles": 0, "inSyncFiles": 0, "needFiles": 0,
                           "needBytes": 0, "needTotalItems": 0, "pullErrors": 0, "error": ""})
                }))
            }
            (Method::Get, ["", "rest", "folder", "versions"]) => {
                let f = q.get("folder").cloned().unwrap_or_default();
                ok(s.versions.get(&f).cloned().unwrap_or_else(|| json!({})))
            }
            (Method::Post, ["", "rest", "folder", "versions"]) => {
                let f = q.get("folder").cloned().unwrap_or_default();
                s.restored.push((f, body.cloned().unwrap_or_default()));
                ok(json!({}))
            }
            (Method::Get, ["", "rest", "folder", "errors"]) => ok(json!({"errors": null})),
            (Method::Get, ["", "rest", "svc", "deviceid"]) => {
                let id = q.get("id").cloned().unwrap_or_default();
                match crate::invite::normalize_device_id(&id) {
                    Some(n) => ok(json!({"id": n})),
                    None => ok(json!({"error": "device ID invalid"})),
                }
            }
            (Method::Post, ["", "rest", "system", "shutdown"]) => {
                ok(json!({"ok": "shutting down"}))
            }
            _ => status(404, "fake: no route"),
        }
    }
}
