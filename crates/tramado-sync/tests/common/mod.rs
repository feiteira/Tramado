// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Harness for the contract and two-instance tests (sync spec §24): real `tramado-syncthing`
//! processes on loopback only (no discovery, relays or NAT), each in its own temporary home,
//! always stopped (and killed if needed) when the test ends, even on failure.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::{json, Value};
use tramado_base::classfs::ClassFs;
use tramado_base::ids;
use tramado_base::paths::Paths;
use tramado_base::registry::{ClassEntry, ClassRegistry};
use tramado_sync::appdata::AppDataStore;
use tramado_sync::client::{Client, HttpRest};
use tramado_sync::config_writer::ConfigWriter;
use tramado_sync::ctx::{Ctx, Now};
use tramado_sync::policy::PolicyStore;
use tramado_sync::{init, managed, supervisor};
use tramado_sync::{ClassPolicy, SyncConfig, SyncEngine, SyncEvent, SyncSettings, SyncSink};

pub fn bin() -> PathBuf {
    let b = std::env::var_os("TRAMADO_SYNCTHING_BIN")
        .map(PathBuf::from)
        .expect("TRAMADO_SYNCTHING_BIN must point at the pinned Syncthing (npm run test:contract)");
    assert!(b.is_file(), "{} is missing", b.display());
    b
}

pub fn wait_until(timeout: Duration, mut f: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    loop {
        if f() {
            return true;
        }
        if start.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// `blocksHash` of sync spec §12.1: base64(SHA-256(h1 ‖ … ‖ hn)), 128 KiB blocks.
pub fn blocks_hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut all = Vec::new();
    for chunk in bytes.chunks(128 << 10) {
        all.extend_from_slice(&Sha256::digest(chunk));
    }
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(&all))
}

// ── raw instances (contract tests) ────────────────────────────────────────────────────────

/// One `tramado-syncthing` driven directly over REST.
pub struct Raw {
    pub dir: tempfile::TempDir,
    pub home: PathBuf,
    pub id: String,
    pub port: u16,
    pub gui: u16,
    pub c: Client,
    child: Option<Child>,
}

impl Raw {
    pub fn new() -> Raw {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("syncthing");
        let inst = init::create_identity(&bin(), &home).unwrap();
        let mut r = Raw {
            home,
            id: inst.device_id,
            port: 0,
            gui: 0,
            c: Client::new(Arc::new(HttpRest::new(1, "x"))),
            child: None,
            dir,
        };
        r.start();
        r
    }

    pub fn start(&mut self) {
        let prep = init::prespawn(&self.home, true, false).unwrap();
        let (child, _) =
            supervisor::spawn(&bin(), &self.home, prep.gui_port, &prep.api_key).unwrap();
        self.child = Some(child);
        self.port = prep.sync_port;
        self.gui = prep.gui_port;
        self.c = Client::new(Arc::new(HttpRest::new(prep.gui_port, &prep.api_key)));
        assert!(
            wait_until(Duration::from_secs(15), || self.c.health()),
            "Syncthing became ready"
        );
        self.c
            .patch_options(&managed::options_body(
                self.port,
                &managed::default_settings(),
                true,
            ))
            .unwrap();
    }

    /// Exit code of a stop by API (`None` = killed).
    pub fn stop(&mut self) -> Option<i32> {
        let Some(mut child) = self.child.take() else {
            return None;
        };
        let _ = self.c.shutdown(Duration::from_secs(2));
        let start = Instant::now();
        loop {
            if let Ok(Some(s)) = child.try_wait() {
                return s.code();
            }
            if start.elapsed() > Duration::from_secs(10) {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Waits for the process to exit by itself (after a reset or a restart).
    pub fn wait_exit(&mut self, timeout: Duration) -> Option<i32> {
        let child = self.child.as_mut()?;
        let start = Instant::now();
        loop {
            if let Ok(Some(s)) = child.try_wait() {
                self.child = None;
                return s.code();
            }
            if start.elapsed() > timeout {
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn addr(&self) -> String {
        format!("tcp://127.0.0.1:{}", self.port)
    }

    /// Configures `other` as a device (addresses on loopback).
    pub fn add_device(&self, other: &Raw) {
        self.c
            .add_device(&json!({"deviceID": other.id, "name": "", "addresses": [other.addr()],
                                 "compression": "metadata", "introducer": false, "autoAcceptFolders": false}))
            .unwrap();
    }

    pub fn folder_path(&self, folder: &str) -> PathBuf {
        self.dir.path().join(folder)
    }

    /// Creates `folder` paused, sets the managed ignores, resumes it.
    pub fn create_folder(&self, folder: &str, devices: &[&str]) -> PathBuf {
        let path = self.folder_path(folder);
        let mut devs = vec![self.id.clone()];
        devs.extend(devices.iter().map(|d| d.to_string()));
        self.c
            .add_folder(&managed::folder_create_body(
                folder,
                "TGDC",
                &path.to_string_lossy(),
                &devs,
            ))
            .unwrap();
        self.c
            .set_ignores(folder, &managed::ignore_lines(false, &[], &[]))
            .unwrap();
        self.c
            .patch_folder(folder, &json!({"paused": false}))
            .unwrap();
        path
    }

    pub fn write(&self, folder: &str, rel: &str, bytes: &[u8]) {
        let p = self.folder_path(folder).join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, bytes).unwrap();
        self.c.scan(folder, Some(rel)).unwrap();
    }

    pub fn has(&self, folder: &str, rel: &str, bytes: &[u8]) -> bool {
        std::fs::read(self.folder_path(folder).join(rel))
            .ok()
            .as_deref()
            == Some(bytes)
    }

    pub fn remote_valid(&self, folder: &str, dev: &str) -> bool {
        self.c
            .completion(folder, dev)
            .map(|v| v["remoteState"] == "valid")
            .unwrap_or(false)
    }
}

impl Drop for Raw {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn new_folder_id(seed: &str) -> String {
    ids::derive_class_id(seed, &ids::random_token_hex(16))
}

/// Two raw instances sharing one folder, connected; returns the folder ID.
pub fn shared_pair(a: &Raw, b: &Raw) -> String {
    let f = new_folder_id(&a.id);
    a.add_device(b);
    b.add_device(a);
    a.create_folder(&f, &[&b.id]);
    b.create_folder(&f, &[&a.id]);
    assert!(
        wait_until(Duration::from_secs(20), || a.remote_valid(&f, &b.id)
            && b.remote_valid(&f, &a.id)),
        "the pair connected"
    );
    f
}

/// The stores Rust's algorithms run against, over a raw instance.
pub struct World {
    pub dir: tempfile::TempDir,
    pub registry: ClassRegistry,
    pub policy: PolicyStore,
    pub appdata: AppDataStore,
    pub writer: ConfigWriter,
    pub events: Arc<Mutex<Vec<SyncEvent>>>,
    pub sink: Box<dyn Fn(SyncEvent) + Send + Sync>,
    pub started: Instant,
}

impl World {
    pub fn new() -> World {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("config")).unwrap();
        let events: Arc<Mutex<Vec<SyncEvent>>> = Arc::default();
        let ev = events.clone();
        World {
            registry: ClassRegistry::load(&dir.path().join("config")).unwrap(),
            policy: PolicyStore::load(&dir.path().join("st")),
            appdata: AppDataStore::load(&dir.path().join("st")),
            writer: ConfigWriter::new(),
            sink: Box::new(move |e| ev.lock().unwrap().push(e)),
            events,
            started: Instant::now(),
            dir,
        }
    }

    pub fn ctx<'a>(&'a self, raw: &'a Raw) -> Ctx<'a> {
        Ctx {
            c: &raw.c,
            me: &raw.id,
            registry: &self.registry,
            policy: &self.policy,
            appdata: &self.appdata,
            writer: &self.writer,
            emit: &*self.sink,
            now: Now::current(),
            started: self.started,
        }
    }

    /// Registers `folder` as a shared class at the raw instance's folder path.
    pub fn register(&self, raw: &Raw, folder: &str) {
        let mut e = ClassEntry::new(folder, raw.folder_path(folder));
        e.shared = true;
        self.registry.insert(e).unwrap();
    }
}

pub fn policy(class: &str) -> ClassPolicy {
    ClassPolicy {
        class_id: class.to_string(),
        label: "TGDC".into(),
        ask_before_admit: false,
        roster: vec![],
        known_devices: vec![],
        banned_devices: vec![],
        updated_at: "2026-11-04T10:00:00.000Z".into(),
    }
}

// ── engines (two-instance tests) ──────────────────────────────────────────────────────────

pub struct Sink {
    pub events: Mutex<Vec<SyncEvent>>,
}

impl SyncSink for Sink {
    fn event(&self, e: SyncEvent) {
        self.events.lock().unwrap().push(e);
    }
}

/// One Tramado installation: its own data dir (TRAMADO_DATA_DIR semantics), registry, ClassFs
/// and `SyncEngine`.
pub struct Node {
    pub dir: tempfile::TempDir,
    pub paths: Arc<Paths>,
    pub registry: Arc<ClassRegistry>,
    pub fs: Arc<ClassFs>,
    pub engine: SyncEngine,
    pub sink: Arc<Sink>,
    pub id: String,
}

impl Node {
    pub fn new(name: &str) -> Node {
        let dir = tempfile::tempdir().unwrap();
        let paths = Arc::new(Paths::for_tests(dir.path()));
        for d in [
            &paths.config,
            &paths.data,
            &paths.cache,
            &paths.default_classes_root,
        ] {
            std::fs::create_dir_all(d).unwrap();
        }
        let registry = Arc::new(ClassRegistry::load(&paths.config).unwrap());
        let fs = Arc::new(ClassFs::new(paths.clone(), registry.clone()));
        let sink = Arc::new(Sink {
            events: Mutex::new(Vec::new()),
        });
        let engine = SyncEngine::new(
            SyncConfig {
                paths: paths.clone(),
                fs: fs.clone(),
                registry: registry.clone(),
                version: "0.1.0-test".into(),
                sidecar: Some(bin()),
            },
            sink.clone(),
        );
        let id = engine.identity().unwrap().device_id;
        engine
            .apply_settings(SyncSettings {
                local_only: true,
                paused: false,
                max_send_kbps: 0,
                max_recv_kbps: 0,
                device_name: format!("{name} (test)"),
            })
            .unwrap();
        Node {
            dir,
            paths,
            registry,
            fs,
            engine,
            sink,
            id,
        }
    }

    /// A local class (registered, with a `class.json`), not shared yet.
    pub fn local_class(&self, name: &str) -> String {
        let id = ids::derive_class_id(&self.id, &ids::random_token_hex(16));
        let root = self.paths.default_classes_root.join(name);
        std::fs::create_dir_all(root.join(".tramado")).unwrap();
        std::fs::write(
            root.join(".tramado/class.json"),
            format!("{{\"classId\":\"{id}\"}}"),
        )
        .unwrap();
        self.registry.insert(ClassEntry::new(&id, root)).unwrap();
        id
    }

    pub fn root(&self, class: &str) -> PathBuf {
        self.registry.root(class).unwrap()
    }

    pub fn events(&self) -> Vec<SyncEvent> {
        self.sink.events.lock().unwrap().clone()
    }

    pub fn saw(&self, f: impl Fn(&SyncEvent) -> bool) -> bool {
        self.sink.events.lock().unwrap().iter().any(f)
    }

    /// An invite code for `class` naming this device with its loopback addresses (§7.1).
    pub fn invite(&self, class: &str) -> String {
        let addrs = self.engine.own_addresses().unwrap();
        let v = json!({"v": 1, "f": class, "l": "Teoria Geral do Direito Civil", "c": "#3e63dd", "i": "scale",
                       "m": "k3q7mzx2v4hbtnw5r6yjc2aefg", "n": "Ana Ribeiro",
                       "d": [{"id": self.id.replace('-', ""), "a": addrs}], "t": 1793721438});
        format!(
            "tri1_{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&v).unwrap())
        )
    }

    pub fn push(&self, p: ClassPolicy) {
        self.engine.set_class_policy(p).unwrap();
    }

    /// Writes the member file `members/<me>.json` as the app would (own, mirrored, scanned).
    pub fn write_member_file(&self, class: &str) {
        self.fs
            .write(
                class,
                &format!(".tramado/members/{}.json", self.id),
                b"{\"me\":true}\n",
                true,
            )
            .unwrap();
    }

    pub fn file(&self, class: &str, rel: &str) -> Option<Vec<u8>> {
        std::fs::read(self.root(class).join(rel)).ok()
    }

    pub fn config(&self) -> Value {
        // read through the engine's own REST view
        let diag = self.engine.snapshot().unwrap();
        serde_json::to_value(diag).unwrap()
    }
}

impl Drop for Node {
    fn drop(&mut self) {
        self.engine.stop(Duration::from_secs(5));
    }
}

/// Raw REST access to a node's running instance (assertions only).
pub fn node_client(n: &Node) -> Client {
    let home = n.paths.syncthing_home();
    let rt = supervisor::read_runtime(&home).expect("runtime.json");
    let key = init::api_key(&home).unwrap();
    Client::new(Arc::new(HttpRest::new(rt.gui_port, &key)))
}

pub fn path_of(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}
