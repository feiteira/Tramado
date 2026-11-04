// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The typed REST client of the managed Syncthing (sync spec §3, §4).
//!
//! Every call goes through the [`Rest`] trait, so the algorithms above it (admission,
//! reconciliation, bans, folders) are unit-tested against an in-memory fake and the real
//! binary only in the contract tests. Rules: header `X-API-Key`, JSON bodies, timeouts of §3.2,
//! a `403` means the key is wrong (the engine restarts the instance), and every path crossing
//! this boundary is converted between Syncthing's native form and a class path (§3.6).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tramado_base::error::{AppError, AppResult, Code};

/// Ordinary REST calls (§3.2).
pub const ORDINARY: Duration = Duration::from_secs(10);
/// `POST /rest/db/scan` returns when the scan is done.
pub const SCAN: Duration = Duration::from_secs(120);
/// Event long-polls are made with `timeout=60`.
pub const LONG_POLL: Duration = Duration::from_secs(75);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Put => "PUT",
            Method::Patch => "PATCH",
            Method::Delete => "DELETE",
        }
    }
}

/// A response: the status and the body (JSON when it parses, else the text as a string).
#[derive(Debug, Clone)]
pub struct Resp {
    pub status: u16,
    pub body: Value,
}

/// One HTTP exchange with Syncthing's REST API. `path` includes the query string.
pub trait Rest: Send + Sync {
    fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        timeout: Duration,
    ) -> AppResult<Resp>;
}

/// The real transport: `ureq` over loopback with the API key in a header (never on a URL).
pub struct HttpRest {
    agent: ureq::Agent,
    base: String,
    key: String,
    forbidden: Arc<AtomicBool>,
}

impl HttpRest {
    pub fn new(gui_port: u16, key: &str) -> Self {
        HttpRest {
            agent: tramado_net::http::loopback_agent(),
            base: format!("http://127.0.0.1:{gui_port}"),
            key: key.to_string(),
            forbidden: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Set once a call was answered `403` (the key is wrong: restart, §3.1).
    pub fn forbidden_flag(&self) -> Arc<AtomicBool> {
        self.forbidden.clone()
    }
}

fn transport_error(e: ureq::Error) -> AppError {
    let msg = match &e {
        ureq::Error::Timeout(_) => "Syncthing did not answer in time".to_string(),
        _ => format!("Syncthing is not reachable: {e}"),
    };
    AppError::new(Code::SyncUnavailable, msg)
}

impl Rest for HttpRest {
    fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        timeout: Duration,
    ) -> AppResult<Resp> {
        let url = format!("{}{}", self.base, path);
        let res = match method {
            Method::Get | Method::Delete => {
                let rb = if method == Method::Get {
                    self.agent.get(&url)
                } else {
                    self.agent.delete(&url)
                };
                rb.config()
                    .timeout_recv_response(Some(timeout))
                    .timeout_per_read(Some(timeout))
                    .build()
                    .header("X-API-Key", &self.key)
                    .call()
            }
            Method::Post | Method::Put | Method::Patch => {
                let rb = match method {
                    Method::Post => self.agent.post(&url),
                    Method::Put => self.agent.put(&url),
                    _ => self.agent.patch(&url),
                };
                let rb = rb
                    .config()
                    .timeout_recv_response(Some(timeout))
                    .timeout_per_read(Some(timeout))
                    .build()
                    .header("X-API-Key", &self.key);
                match body {
                    Some(b) => rb
                        .header("Content-Type", "application/json")
                        .send(serde_json::to_vec(b)?.as_slice()),
                    None => rb.send_empty(),
                }
            }
        };
        let mut res = res.map_err(transport_error)?;
        let status = res.status().as_u16();
        let text = res
            .body_mut()
            .with_config()
            .limit(64 << 20)
            .read_to_string()
            .map_err(transport_error)?;
        if status == 403 {
            self.forbidden.store(true, Ordering::SeqCst);
        }
        let body = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or(Value::String(text))
        };
        Ok(Resp { status, body })
    }
}

/// Percent-encodes a query value (folder IDs, device IDs, class paths).
const QUERY: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

pub fn enc(s: &str) -> String {
    utf8_percent_encode(s, QUERY).to_string()
}

/// A path Syncthing reported (native on Windows) as a class path (§3.6). Syncthing keeps file
/// names in NFC internally, so only the separators need converting.
pub fn to_class_path(native: &str) -> String {
    native.replace('\\', "/")
}

/// A class path in Syncthing's native form (`/` → `\` on Windows only, §3.6).
pub fn to_native(class_path: &str) -> String {
    if cfg!(windows) {
        class_path.replace('/', "\\")
    } else {
        class_path.to_string()
    }
}

/// One side (`local` or `global`) of `GET /rest/db/file`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DbFileSide {
    pub modified_by: Option<String>,
    pub deleted: bool,
    pub size: Option<u64>,
    pub blocks_hash: Option<String>,
    pub modified: Option<String>,
    pub version: Vec<String>,
    pub sequence: Option<u64>,
}

impl DbFileSide {
    fn parse(v: &Value) -> Option<DbFileSide> {
        if !v.is_object() {
            return None;
        }
        Some(DbFileSide {
            modified_by: v["modifiedBy"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            deleted: v["deleted"].as_bool().unwrap_or(false),
            size: v["size"].as_u64(),
            blocks_hash: v["blocksHash"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            modified: v["modified"].as_str().map(str::to_string),
            version: v["version"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            sequence: v["sequence"].as_u64(),
        })
    }
}

/// `GET /rest/db/file`: what this device and the cluster know about one path.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DbFile {
    pub local: Option<DbFileSide>,
    pub global: Option<DbFileSide>,
    /// `(deviceID, fromTemporary)`; `null` in the response means none; never lists this device.
    pub availability: Vec<(String, bool)>,
}

impl DbFile {
    pub fn parse(v: &Value) -> DbFile {
        DbFile {
            local: DbFileSide::parse(&v["local"]),
            global: DbFileSide::parse(&v["global"]),
            availability: v["availability"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|e| {
                            Some((
                                e["id"].as_str()?.to_string(),
                                e["fromTemporary"].as_bool().unwrap_or(false),
                            ))
                        })
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    /// Devices that hold the current global version (not a temporary copy).
    pub fn holders(&self) -> Vec<String> {
        self.availability
            .iter()
            .filter(|(_, tmp)| !tmp)
            .map(|(id, _)| id.clone())
            .collect()
    }
}

/// `GET /rest/cluster/pending/devices` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingDevice {
    pub time: String,
    pub name: String,
    pub address: String,
}

/// One offer inside `GET /rest/cluster/pending/folders`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingOffer {
    pub time: String,
    pub label: String,
}

/// folder → offering device → offer.
pub type PendingFolders = BTreeMap<String, BTreeMap<String, PendingOffer>>;

/// One event of `/rest/events` or `/rest/events/disk`.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub id: u64,
    pub kind: String,
    pub time: String,
    pub data: Value,
}

/// The typed client over a [`Rest`] transport. Cheap to clone.
#[derive(Clone)]
pub struct Client {
    rest: Arc<dyn Rest>,
}

fn status_error(method: Method, path: &str, r: &Resp) -> AppError {
    // Never echo query values (class paths) into logs: keep the endpoint only.
    let endpoint = path.split('?').next().unwrap_or(path);
    let detail = match &r.body {
        Value::String(s) => s.chars().take(200).collect::<String>(),
        Value::Null => String::new(),
        v => v.to_string().chars().take(200).collect(),
    };
    let code = match r.status {
        403 => Code::SyncUnavailable,
        404 => Code::NotFound,
        _ => Code::IoError,
    };
    AppError::new(
        code,
        format!(
            "Syncthing {} {endpoint} answered {}: {detail}",
            method.as_str(),
            r.status
        ),
    )
    .with_data(json!({ "status": r.status }))
}

impl Client {
    pub fn new(rest: Arc<dyn Rest>) -> Self {
        Client { rest }
    }

    pub fn raw(&self, m: Method, path: &str, body: Option<&Value>, t: Duration) -> AppResult<Resp> {
        self.rest.call(m, path, body, t)
    }

    /// 2xx → body; anything else → an error carrying the status.
    pub fn send(&self, m: Method, path: &str, body: Option<&Value>) -> AppResult<Value> {
        self.send_t(m, path, body, ORDINARY)
    }

    fn send_t(&self, m: Method, path: &str, body: Option<&Value>, t: Duration) -> AppResult<Value> {
        let r = self.rest.call(m, path, body, t)?;
        if (200..300).contains(&r.status) {
            Ok(r.body)
        } else {
            Err(status_error(m, path, &r))
        }
    }

    pub fn get(&self, path: &str) -> AppResult<Value> {
        self.send(Method::Get, path, None)
    }

    /// 404 → `None`.
    pub fn get_opt(&self, path: &str) -> AppResult<Option<Value>> {
        let r = self.rest.call(Method::Get, path, None, ORDINARY)?;
        match r.status {
            200..=299 => Ok(Some(r.body)),
            404 => Ok(None),
            _ => Err(status_error(Method::Get, path, &r)),
        }
    }

    // ── system ──────────────────────────────────────────────────────────────────────────

    /// `GET /rest/noauth/health` → `{"status":"OK"}` (short timeout: readiness polling).
    pub fn health(&self) -> bool {
        self.rest
            .call(
                Method::Get,
                "/rest/noauth/health",
                None,
                Duration::from_secs(2),
            )
            .map(|r| r.status == 200 && r.body["status"] == "OK")
            .unwrap_or(false)
    }

    pub fn system_status(&self) -> AppResult<Value> {
        self.get("/rest/system/status")
    }

    pub fn my_id(&self) -> AppResult<String> {
        self.system_status()?["myID"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| AppError::new(Code::SyncUnavailable, "Syncthing reported no device ID"))
    }

    pub fn version(&self) -> AppResult<String> {
        Ok(self.get("/rest/system/version")?["version"]
            .as_str()
            .unwrap_or_default()
            .to_string())
    }

    pub fn connections(&self) -> AppResult<Value> {
        Ok(self.get("/rest/system/connections")?["connections"].clone())
    }

    pub fn shutdown(&self, timeout: Duration) -> AppResult<()> {
        self.send_t(Method::Post, "/rest/system/shutdown", None, timeout)
            .map(|_| ())
    }

    pub fn system_errors(&self) -> AppResult<Value> {
        self.get("/rest/system/error")
    }

    pub fn stats_device(&self) -> AppResult<Value> {
        self.get("/rest/stats/device")
    }

    /// `POST /rest/system/reset?folder=` (Syncthing then exits with code 3).
    pub fn reset_folder(&self, folder: &str) -> AppResult<()> {
        self.send(
            Method::Post,
            &format!("/rest/system/reset?folder={}", enc(folder)),
            None,
        )
        .map(|_| ())
    }

    /// `GET /rest/svc/deviceid` → the canonical form, or `None` when invalid.
    pub fn normalize_device_id(&self, id: &str) -> AppResult<Option<String>> {
        let r = self.rest.call(
            Method::Get,
            &format!("/rest/svc/deviceid?id={}", enc(id)),
            None,
            ORDINARY,
        )?;
        if r.status == 403 {
            return Err(status_error(Method::Get, "/rest/svc/deviceid", &r));
        }
        Ok(r.body["id"].as_str().map(str::to_string))
    }

    // ── config ──────────────────────────────────────────────────────────────────────────

    pub fn config(&self) -> AppResult<Value> {
        self.get("/rest/config")
    }

    pub fn put_config(&self, cfg: &Value) -> AppResult<()> {
        self.send(Method::Put, "/rest/config", Some(cfg))
            .map(|_| ())
    }

    pub fn patch_options(&self, body: &Value) -> AppResult<()> {
        self.send(Method::Patch, "/rest/config/options", Some(body))
            .map(|_| ())
    }

    pub fn gui(&self) -> AppResult<Value> {
        self.get("/rest/config/gui")
    }

    pub fn patch_gui(&self, body: &Value) -> AppResult<()> {
        self.send(Method::Patch, "/rest/config/gui", Some(body))
            .map(|_| ())
    }

    pub fn devices(&self) -> AppResult<Vec<Value>> {
        Ok(self
            .get("/rest/config/devices")?
            .as_array()
            .cloned()
            .unwrap_or_default())
    }

    pub fn device(&self, id: &str) -> AppResult<Option<Value>> {
        self.get_opt(&format!("/rest/config/devices/{}", enc(id)))
    }

    /// `POST` only for devices that do not exist (it replaces them, §3.3).
    pub fn add_device(&self, body: &Value) -> AppResult<()> {
        self.send(Method::Post, "/rest/config/devices", Some(body))
            .map(|_| ())
    }

    pub fn patch_device(&self, id: &str, body: &Value) -> AppResult<()> {
        self.send(
            Method::Patch,
            &format!("/rest/config/devices/{}", enc(id)),
            Some(body),
        )
        .map(|_| ())
    }

    pub fn delete_device(&self, id: &str) -> AppResult<()> {
        let r = self.rest.call(
            Method::Delete,
            &format!("/rest/config/devices/{}", enc(id)),
            None,
            ORDINARY,
        )?;
        match r.status {
            200..=299 | 404 => Ok(()),
            _ => Err(status_error(Method::Delete, "/rest/config/devices", &r)),
        }
    }

    pub fn folders(&self) -> AppResult<Vec<Value>> {
        Ok(self
            .get("/rest/config/folders")?
            .as_array()
            .cloned()
            .unwrap_or_default())
    }

    pub fn folder(&self, id: &str) -> AppResult<Option<Value>> {
        self.get_opt(&format!("/rest/config/folders/{}", enc(id)))
    }

    /// `POST` only for folders that do not exist (it replaces them, §3.3).
    pub fn add_folder(&self, body: &Value) -> AppResult<()> {
        self.send(Method::Post, "/rest/config/folders", Some(body))
            .map(|_| ())
    }

    pub fn patch_folder(&self, id: &str, body: &Value) -> AppResult<()> {
        self.send(
            Method::Patch,
            &format!("/rest/config/folders/{}", enc(id)),
            Some(body),
        )
        .map(|_| ())
    }

    /// Files stay on disk (✔).
    pub fn delete_folder(&self, id: &str) -> AppResult<()> {
        let r = self.rest.call(
            Method::Delete,
            &format!("/rest/config/folders/{}", enc(id)),
            None,
            ORDINARY,
        )?;
        match r.status {
            200..=299 | 404 => Ok(()),
            _ => Err(status_error(Method::Delete, "/rest/config/folders", &r)),
        }
    }

    // ── cluster ─────────────────────────────────────────────────────────────────────────

    pub fn pending_devices(&self) -> AppResult<BTreeMap<String, PendingDevice>> {
        let v = self.get("/rest/cluster/pending/devices")?;
        let mut out = BTreeMap::new();
        if let Some(m) = v.as_object() {
            for (id, e) in m {
                out.insert(
                    id.clone(),
                    PendingDevice {
                        time: e["time"].as_str().unwrap_or_default().to_string(),
                        name: e["name"].as_str().unwrap_or_default().to_string(),
                        address: e["address"].as_str().unwrap_or_default().to_string(),
                    },
                );
            }
        }
        Ok(out)
    }

    pub fn dismiss_pending_device(&self, id: &str) -> AppResult<()> {
        self.send(
            Method::Delete,
            &format!("/rest/cluster/pending/devices?device={}", enc(id)),
            None,
        )
        .map(|_| ())
    }

    pub fn pending_folders(&self) -> AppResult<PendingFolders> {
        let v = self.get("/rest/cluster/pending/folders")?;
        let mut out = PendingFolders::new();
        if let Some(m) = v.as_object() {
            for (folder, e) in m {
                let mut offers = BTreeMap::new();
                if let Some(by) = e["offeredBy"].as_object() {
                    for (dev, o) in by {
                        offers.insert(
                            dev.clone(),
                            PendingOffer {
                                time: o["time"].as_str().unwrap_or_default().to_string(),
                                label: o["label"].as_str().unwrap_or_default().to_string(),
                            },
                        );
                    }
                }
                out.insert(folder.clone(), offers);
            }
        }
        Ok(out)
    }

    pub fn dismiss_pending_folder(&self, folder: &str, device: &str) -> AppResult<()> {
        self.send(
            Method::Delete,
            &format!(
                "/rest/cluster/pending/folders?folder={}&device={}",
                enc(folder),
                enc(device)
            ),
            None,
        )
        .map(|_| ())
    }

    // ── db ──────────────────────────────────────────────────────────────────────────────

    pub fn set_ignores(&self, folder: &str, lines: &[String]) -> AppResult<()> {
        self.send(
            Method::Post,
            &format!("/rest/db/ignores?folder={}", enc(folder)),
            Some(&json!({ "ignore": lines })),
        )
        .map(|_| ())
    }

    pub fn ignores(&self, folder: &str) -> AppResult<Vec<String>> {
        Ok(
            self.get(&format!("/rest/db/ignores?folder={}", enc(folder)))?["ignore"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
        )
    }

    /// `POST /rest/db/scan?folder=&sub=`; returns when the scan is done. A `500` means the
    /// folder marker is missing (§22.3) → `SYNC_FOLDER_MARKER_MISSING`.
    pub fn scan(&self, folder: &str, sub: Option<&str>) -> AppResult<()> {
        let mut path = format!("/rest/db/scan?folder={}", enc(folder));
        if let Some(s) = sub.filter(|s| !s.is_empty()) {
            path.push_str("&sub=");
            path.push_str(&enc(&to_native(s)));
        }
        let r = self.rest.call(Method::Post, &path, None, SCAN)?;
        match r.status {
            200..=299 => Ok(()),
            500 => Err(AppError::new(
                Code::SyncFolderMarkerMissing,
                "the class folder or its marker is missing",
            )),
            _ => Err(status_error(Method::Post, "/rest/db/scan", &r)),
        }
    }

    pub fn db_status(&self, folder: &str) -> AppResult<Value> {
        self.get(&format!("/rest/db/status?folder={}", enc(folder)))
    }

    pub fn completion(&self, folder: &str, device: &str) -> AppResult<Value> {
        self.get(&format!(
            "/rest/db/completion?folder={}&device={}",
            enc(folder),
            enc(device)
        ))
    }

    /// `None` when Syncthing has no record of the path (404).
    pub fn db_file(&self, folder: &str, class_path: &str) -> AppResult<Option<DbFile>> {
        Ok(self
            .get_opt(&format!(
                "/rest/db/file?folder={}&file={}",
                enc(folder),
                enc(&to_native(class_path))
            ))?
            .map(|v| DbFile::parse(&v)))
    }

    pub fn need(&self, folder: &str) -> AppResult<Value> {
        self.get(&format!("/rest/db/need?folder={}", enc(folder)))
    }

    // ── folder ──────────────────────────────────────────────────────────────────────────

    /// `{class path: [{versionTime, modTime, size}]}`; a folder without a versioner → `{}`.
    pub fn versions(&self, folder: &str) -> AppResult<BTreeMap<String, Vec<Value>>> {
        let r = self.rest.call(
            Method::Get,
            &format!("/rest/folder/versions?folder={}", enc(folder)),
            None,
            ORDINARY,
        )?;
        if r.status == 500 {
            return Ok(BTreeMap::new());
        }
        if !(200..300).contains(&r.status) {
            return Err(status_error(Method::Get, "/rest/folder/versions", &r));
        }
        let mut out = BTreeMap::new();
        if let Some(m) = r.body.as_object() {
            for (p, list) in m {
                out.insert(
                    to_class_path(p),
                    list.as_array().cloned().unwrap_or_default(),
                );
            }
        }
        Ok(out)
    }

    /// `POST /rest/folder/versions` `{native path: versionTime}`; the answer lists failures.
    pub fn restore_versions(&self, folder: &str, items: &[(String, String)]) -> AppResult<Value> {
        let mut body = serde_json::Map::new();
        for (p, t) in items {
            body.insert(to_native(p), Value::String(t.clone()));
        }
        self.send(
            Method::Post,
            &format!("/rest/folder/versions?folder={}", enc(folder)),
            Some(&Value::Object(body)),
        )
    }

    /// `[(class path, error)]`.
    pub fn folder_errors(&self, folder: &str) -> AppResult<Vec<(String, String)>> {
        let v = self.get(&format!("/rest/folder/errors?folder={}", enc(folder)))?;
        Ok(v["errors"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|e| {
                        (
                            to_class_path(e["path"].as_str().unwrap_or_default()),
                            e["error"].as_str().unwrap_or_default().to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    // ── events ──────────────────────────────────────────────────────────────────────────

    fn parse_events(v: Value) -> Vec<Event> {
        v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|e| {
                        Some(Event {
                            id: e["id"].as_u64()?,
                            kind: e["type"].as_str().unwrap_or_default().to_string(),
                            time: e["time"].as_str().unwrap_or_default().to_string(),
                            data: e["data"].clone(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// `GET /rest/events?events=<mask>&since=<id>&timeout=<s>` (loop A).
    pub fn events(&self, mask: &str, since: u64, timeout_s: u64) -> AppResult<Vec<Event>> {
        let t = Duration::from_secs(timeout_s) + Duration::from_secs(15);
        let v = self.send_t(
            Method::Get,
            &format!("/rest/events?events={mask}&since={since}&timeout={timeout_s}"),
            None,
            t.min(LONG_POLL),
        )?;
        Ok(Self::parse_events(v))
    }

    /// `GET /rest/events/disk?since=<id>&timeout=<s>` (loop B).
    pub fn disk_events(&self, since: u64, timeout_s: u64) -> AppResult<Vec<Event>> {
        let t = Duration::from_secs(timeout_s) + Duration::from_secs(15);
        let v = self.send_t(
            Method::Get,
            &format!("/rest/events/disk?since={since}&timeout={timeout_s}"),
            None,
            t.min(LONG_POLL),
        )?;
        Ok(Self::parse_events(v))
    }
}

/// The device IDs of a folder object (`devices[].deviceID`).
pub fn folder_devices(folder: &Value) -> Vec<String> {
    folder["devices"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|d| d["deviceID"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// `[{"deviceID": …}]` for a PATCH of a folder's devices (the whole array, §3.3).
pub fn devices_body(ids: &[String]) -> Value {
    Value::Array(ids.iter().map(|d| json!({ "deviceID": d })).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_values_are_percent_encoded() {
        assert_eq!(enc(".tramado/chat/A B"), ".tramado%2Fchat%2FA%20B");
        assert_eq!(
            enc("Aula 1 — ação.md"),
            "Aula%201%20%E2%80%94%20a%C3%A7%C3%A3o.md"
        );
        assert_eq!(enc("tramado-abc"), "tramado-abc");
    }

    #[test]
    fn paths_convert_between_native_and_class_form() {
        assert_eq!(
            to_class_path("Aulas\\Aula 1\\lecture.json"),
            "Aulas/Aula 1/lecture.json"
        );
        assert_eq!(
            to_class_path(".tramado/chat/X/2026-11.jsonl"),
            ".tramado/chat/X/2026-11.jsonl"
        );
        if cfg!(windows) {
            assert_eq!(to_native("Aulas/Aula 1"), "Aulas\\Aula 1");
        } else {
            assert_eq!(to_native("Aulas/Aula 1"), "Aulas/Aula 1");
        }
    }

    #[test]
    fn db_file_parses_both_sides_and_availability() {
        let v = json!({
            "availability": [{"id": "B", "fromTemporary": false}, {"id": "C", "fromTemporary": true}],
            "global": {"modifiedBy": "BBBBBBB", "deleted": true, "version": ["BBBBBBB:2"], "sequence": 4},
            "local": {"modifiedBy": "AAAAAAA", "deleted": false, "size": 27, "blocksHash": "x=",
                      "modified": "2026-11-04T08:43:16.720307623Z", "version": ["AAAAAAA:1"], "sequence": 3}
        });
        let f = DbFile::parse(&v);
        assert_eq!(f.holders(), vec!["B".to_string()]);
        let l = f.local.unwrap();
        assert_eq!(l.modified_by.as_deref(), Some("AAAAAAA"));
        assert_eq!(l.size, Some(27));
        assert!(f.global.unwrap().deleted);
        let none = DbFile::parse(&json!({"availability": null, "local": null}));
        assert!(none.availability.is_empty() && none.local.is_none());
    }
}
