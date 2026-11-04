// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The engine behind [`crate::SyncEngine`]: run state, the start-up routine of every Syncthing
//! generation (readiness, identity check, GUI lock, priming, managed settings, start-up passes),
//! the ticker (`tramado-sync-ticker`: early evictions 1 s, sweep 5 s, discovery 10 s,
//! reconciliation and leaving 60 s) and the worker (`tramado-sync-work`: scans and small jobs).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock, RwLock, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::registry::ClassEntry;
use tramado_base::{ids, time};

use crate::admission::Admission;
use crate::appdata::AppDataStore;
use crate::client::{folder_devices, Client, HttpRest};
use crate::config_writer::ConfigWriter;
use crate::ctx::{Ctx, Now};
use crate::discovery::{Discovery, HttpLookup, Lookuper, LOOKUP_URL};
use crate::events::{self, Loop};
use crate::guard::Guard;
use crate::init::{self, InstanceFile, Prepared};
use crate::managed;
use crate::policy::PolicyStore;
use crate::scan::{Task, WorkQueue};
use crate::supervisor::{self, KILL_HARD, KILL_NONE, KILL_TERM};
use crate::types::*;
use crate::{folders, reconcile, selfheal, SyncConfig, SyncSink};

pub type PickResolver = Arc<dyn Fn(&str) -> AppResult<PathBuf> + Send + Sync>;

pub(crate) struct Run {
    pub want: bool,
    pub gen: u64,
    pub state: SyncState,
    pub pid: Option<u32>,
    pub client: Option<Client>,
    pub forbidden: Option<Arc<AtomicBool>>,
    pub sync_port: Option<u16>,
    pub gui_port: Option<u16>,
    pub api_key: Option<String>,
    pub started_at_ms: Option<u64>,
    pub restarts: u32,
    pub error: Option<Code>,
    pub kill: u8,
    pub supervisor: Option<JoinHandle<()>>,
    pub version: Option<String>,
}

#[derive(Default)]
struct Cursor {
    gen: u64,
    a: u64,
    b: u64,
}

pub(crate) struct Inner {
    pub cfg: SyncConfig,
    pub sink: Arc<dyn SyncSink>,
    pub home: PathBuf,
    pub dev_isolated: bool,
    pub policy: PolicyStore,
    pub appdata: AppDataStore,
    pub writer: ConfigWriter,
    pub run: Mutex<Run>,
    pub run_cv: Condvar,
    pub adm: Mutex<Admission>,
    pub guard: Mutex<Guard>,
    pub disc: Mutex<Discovery>,
    pub work: WorkQueue,
    identity: Mutex<Option<InstanceFile>>,
    pub picks: RwLock<Option<PickResolver>>,
    cursor: Mutex<Cursor>,
    threads: Mutex<bool>,
    shutdown: AtomicBool,
    session_started: OnceLock<Instant>,
    reset_restore: Mutex<BTreeSet<String>>,
    admitted_me: Mutex<HashSet<(String, String)>>,
    completion: Mutex<HashMap<(String, String), DeviceCompletion>>,
    errors: Mutex<VecDeque<DiagError>>,
    lookuper: Box<dyn Lookuper>,
    emitter: Box<dyn Fn(SyncEvent) + Send + Sync>,
    pub weak: Weak<Inner>,
}

fn unavailable(msg: &str) -> AppError {
    AppError::new(Code::SyncUnavailable, msg.to_string())
}

fn folder_state(s: &str, paused: bool) -> FolderState {
    match s {
        "idle" => FolderState::Idle,
        "scanning" => FolderState::Scanning,
        "syncing" => FolderState::Syncing,
        "sync-preparing" => FolderState::SyncPreparing,
        "sync-waiting" => FolderState::SyncWaiting,
        "scan-waiting" => FolderState::ScanWaiting,
        "error" => FolderState::Error,
        _ if paused => FolderState::Paused,
        _ => FolderState::Unknown,
    }
}

fn remote_state(v: &Value) -> RemoteState {
    match v.as_str() {
        Some("valid") => RemoteState::Valid,
        Some("notSharing") => RemoteState::NotSharing,
        Some("paused") => RemoteState::Paused,
        _ => RemoteState::Unknown,
    }
}

fn completion_of(v: &Value) -> DeviceCompletion {
    DeviceCompletion {
        completion: v["completion"].as_f64().unwrap_or(0.0),
        need_items: v["needItems"].as_u64().unwrap_or(0),
        remote_state: remote_state(&v["remoteState"]),
    }
}

/// Syncthing's RFC 3339 (ns, offsets) → Tramado's `Instant`; `None` for the zero time.
fn to_instant(s: &str) -> Option<String> {
    let ms = time::parse_rfc3339(s)?;
    (ms > 0).then(|| time::instant(ms as u64))
}

impl Inner {
    pub fn new(cfg: SyncConfig, sink: Arc<dyn SyncSink>) -> Arc<Inner> {
        let home = cfg.paths.syncthing_home();
        let dev_isolated = cfg.paths.dev_isolated;
        let lookup_url = std::env::var("TRAMADO_DISCOVERY_URL")
            .ok()
            .filter(|u| !u.is_empty() && dev_isolated)
            .unwrap_or_else(|| LOOKUP_URL.to_string());
        let lookuper: Box<dyn Lookuper> = Box::new(HttpLookup::new(&cfg.version, &lookup_url));
        let s2 = sink.clone();
        Arc::new_cyclic(|weak| Inner {
            policy: PolicyStore::load(&home),
            appdata: AppDataStore::load(&home),
            home,
            dev_isolated,
            writer: ConfigWriter::new(),
            run: Mutex::new(Run {
                want: false,
                gen: 0,
                state: SyncState::Stopped,
                pid: None,
                client: None,
                forbidden: None,
                sync_port: None,
                gui_port: None,
                api_key: None,
                started_at_ms: None,
                restarts: 0,
                error: None,
                kill: KILL_NONE,
                supervisor: None,
                version: None,
            }),
            run_cv: Condvar::new(),
            adm: Mutex::new(Admission::default()),
            guard: Mutex::new(Guard::default()),
            disc: Mutex::new(Discovery::default()),
            work: WorkQueue::default(),
            identity: Mutex::new(None),
            picks: RwLock::new(None),
            cursor: Mutex::new(Cursor::default()),
            threads: Mutex::new(false),
            shutdown: AtomicBool::new(false),
            session_started: OnceLock::new(),
            reset_restore: Mutex::new(BTreeSet::new()),
            admitted_me: Mutex::new(HashSet::new()),
            completion: Mutex::new(HashMap::new()),
            errors: Mutex::new(VecDeque::new()),
            lookuper,
            emitter: Box::new(move |e| s2.event(e)),
            weak: weak.clone(),
            sink,
            cfg,
        })
    }

    fn lock_run(&self) -> std::sync::MutexGuard<'_, Run> {
        self.run.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn emit(&self, e: SyncEvent) {
        (self.emitter)(e)
    }

    pub fn is_shutdown(&self) -> bool {
        self.shutdown.load(Ordering::SeqCst)
    }

    pub fn note_error(&self, msg: &str) {
        let mut q = self.errors.lock().unwrap_or_else(|e| e.into_inner());
        q.push_back(DiagError {
            when: time::instant(time::now_ms()),
            message: crate::diag::truncate_device_ids(msg),
        });
        while q.len() > 20 {
            q.pop_front();
        }
    }

    // ── identity ───────────────────────────────────────────────────────────────────────

    pub fn me(&self) -> Option<String> {
        self.identity
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|i| i.device_id.clone())
    }

    pub fn identity(&self) -> AppResult<SyncIdentity> {
        let mut g = self.identity.lock().unwrap_or_else(|e| e.into_inner());
        if g.is_none() {
            let inst = if !init::config_path(&self.home).is_file() {
                let bin = self
                    .cfg
                    .sidecar
                    .clone()
                    .filter(|b| b.is_file())
                    .ok_or_else(|| unavailable("the Syncthing sidecar is missing"))?;
                let lost = self.cfg.registry.list().iter().any(|e| e.shared);
                let inst = init::create_identity(&bin, &self.home)?;
                if lost {
                    self.appdata.update(|a| a.lost_identity = true)?;
                }
                inst
            } else if let Some(i) = init::read_instance(&self.home) {
                i
            } else {
                let cert = std::fs::read_to_string(self.home.join("cert.pem"))
                    .map_err(|_| unavailable("the sharing identity is damaged"))?;
                let der = crate::sign::pem_der(&cert, "CERTIFICATE")
                    .ok_or_else(|| unavailable("the sharing identity is damaged"))?;
                let i = InstanceFile {
                    format: init::INSTANCE_FORMAT.to_string(),
                    version: 1,
                    device_id: ids::device_id_from_cert_der(&der),
                    sync_port: None,
                    install_id: ids::random_token_hex(16),
                    machine: init::machine_id(),
                    created_at: time::instant(time::now_ms()),
                };
                init::write_instance(&self.home, &i)?;
                i
            };
            self.cfg.fs.set_device(&inst.device_id);
            *g = Some(inst);
        }
        let i = g.as_ref().ok_or_else(|| unavailable("no identity"))?;
        Ok(SyncIdentity {
            device_id: i.device_id.clone(),
            short_id: ids::short_id(&i.device_id).to_string(),
            sync_port: init::read_instance(&self.home)
                .and_then(|x| x.sync_port)
                .or(i.sync_port)
                .unwrap_or(0),
        })
    }

    pub fn forget_identity(&self) {
        *self.identity.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    // ── settings ───────────────────────────────────────────────────────────────────────

    pub fn settings(&self) -> SyncSettings {
        self.appdata
            .read(|a| a.settings.clone())
            .unwrap_or_else(managed::default_settings)
    }

    /// Whether a class folder must stay paused (global pause, the person, the guard).
    pub fn paused_effective(&self, class: &str) -> bool {
        let restoring = self
            .reset_restore
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(class);
        self.settings().paused
            || self.appdata.read(|a| {
                a.user_paused.contains(class) || (a.guard_paused.contains(class) && !restoring)
            })
    }

    fn any_joining(&self) -> bool {
        self.cfg
            .registry
            .list()
            .iter()
            .any(|e| e.shared && e.joining)
    }

    // ── status ─────────────────────────────────────────────────────────────────────────

    pub fn status(&self) -> SyncStatus {
        let s = self.settings();
        let device_id = self.me();
        let r = self.lock_run();
        SyncStatus {
            state: r.state,
            device_id,
            version: r.version.clone(),
            sync_port: r.sync_port,
            local_only: s.local_only,
            paused: s.paused,
            started_at: r.started_at_ms.map(time::instant),
            restarts: r.restarts,
            error: r.error,
        }
    }

    fn emit_status(&self) {
        self.emit(SyncEvent::Status {
            status: self.status(),
        });
    }

    fn set_state(&self, state: SyncState) {
        {
            let mut r = self.lock_run();
            if r.state == state {
                return;
            }
            r.state = state;
        }
        self.run_cv.notify_all();
        self.emit_status();
    }

    pub fn client(&self) -> Option<Client> {
        let r = self.lock_run();
        if r.state == SyncState::Running {
            r.client.clone()
        } else {
            None
        }
    }

    fn running_client(&self) -> AppResult<Client> {
        self.client()
            .ok_or_else(|| unavailable("sharing is not running"))
    }

    fn started_mono(&self) -> Instant {
        *self.session_started.get_or_init(Instant::now)
    }

    /// Runs `f` with a context over the running instance.
    pub fn with_ctx<T>(&self, f: impl FnOnce(&Ctx) -> AppResult<T>) -> AppResult<T> {
        let c = self.running_client()?;
        let me = self.me().ok_or_else(|| unavailable("no identity"))?;
        let ctx = Ctx {
            c: &c,
            me: &me,
            registry: &self.cfg.registry,
            policy: &self.policy,
            appdata: &self.appdata,
            writer: &self.writer,
            emit: &*self.emitter,
            now: Now::current(),
            started: self.started_mono(),
        };
        f(&ctx)
    }

    /// Admission work from the event loops and the ticker; errors are logged.
    pub fn with_admission(&self, f: impl FnOnce(&mut Admission, &Ctx) -> AppResult<()>) {
        let r = self.with_ctx(|ctx| {
            let mut adm = self.adm.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut adm, ctx)
        });
        if let Err(e) = r {
            if e.code() != Code::SyncUnavailable {
                log::warn!("sync: admission: {e}");
            }
        }
    }

    // ── supervisor callbacks ───────────────────────────────────────────────────────────

    pub fn want_running(&self) -> bool {
        self.lock_run().want
    }

    pub fn fail(&self, code: Code, msg: &str) {
        log::error!("sync: {msg}");
        self.note_error(msg);
        {
            let mut r = self.lock_run();
            r.want = false;
            r.error = Some(code);
            r.client = None;
            r.pid = None;
            r.state = SyncState::Error;
        }
        self.run_cv.notify_all();
        self.emit_status();
    }

    pub fn spawned(&self, pid: u32, p: &Prepared) -> u64 {
        let rest = HttpRest::new(p.gui_port, &p.api_key);
        let forbidden = rest.forbidden_flag();
        let gen = {
            let mut r = self.lock_run();
            r.gen += 1;
            r.pid = Some(pid);
            r.client = Some(Client::new(Arc::new(rest)));
            r.forbidden = Some(forbidden);
            r.sync_port = Some(p.sync_port);
            r.gui_port = Some(p.gui_port);
            r.api_key = Some(p.api_key.clone());
            r.kill = KILL_NONE;
            if r.state != SyncState::Restarting {
                r.state = SyncState::Starting;
            }
            r.gen
        };
        self.run_cv.notify_all();
        self.emit_status();
        if let Some(me) = self.weak.upgrade() {
            let _ = std::thread::Builder::new()
                .name("tramado-sync-ready".into())
                .spawn(move || me.ready(gen));
        }
        gen
    }

    pub fn take_kill_request(&self) -> u8 {
        std::mem::replace(&mut self.lock_run().kill, KILL_NONE)
    }

    pub fn exited(&self, gen: u64, code: Option<i32>) {
        {
            let mut r = self.lock_run();
            if r.gen == gen {
                r.pid = None;
                r.client = None;
                r.forbidden = None;
            }
        }
        let _ = code;
        self.run_cv.notify_all();
    }

    pub fn sleep_unless_stopped(&self, d: Duration) -> bool {
        let deadline = Instant::now() + d;
        let mut r = self.lock_run();
        while r.want {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            r = self
                .run_cv
                .wait_timeout(r, left)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        r.want
    }

    pub fn restarting(&self) {
        self.lock_run().restarts += 1;
        self.set_state(SyncState::Restarting);
    }

    pub fn supervisor_done(&self) {
        let state = self.lock_run().state;
        if state != SyncState::Error {
            self.set_state(SyncState::Stopped);
        }
        self.run_cv.notify_all();
    }

    fn request_kill(&self, gen: u64, how: u8) {
        let mut r = self.lock_run();
        if r.gen == gen && r.pid.is_some() {
            r.kill = how;
        }
    }

    // ── readiness and the start-up routine (§2.5 steps 1–4) ────────────────────────────

    fn ready(self: Arc<Self>, gen: u64) {
        let client = {
            let r = self.lock_run();
            if r.gen != gen {
                return;
            }
            r.client.clone()
        };
        let Some(client) = client else {
            return;
        };
        let start = Instant::now();
        loop {
            if self.lock_run().gen != gen {
                return;
            }
            if client.health() {
                break;
            }
            if start.elapsed() > supervisor::READY_TIMEOUT {
                self.note_error("Syncthing did not become ready in 15 s");
                self.request_kill(gen, KILL_HARD);
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        match self.on_ready(gen, &client) {
            Ok(()) => {}
            Err(e) if e.data().is_some_and(|d| d["fatal"] == true) => {
                {
                    let mut r = self.lock_run();
                    r.want = false;
                }
                let _ = client.shutdown(Duration::from_secs(2));
                self.fail(e.code(), &e.to_string());
                self.request_kill(gen, KILL_TERM);
            }
            Err(e) => {
                self.note_error(&format!("start-up: {e}"));
                log::warn!("sync: start-up routine failed: {e}");
                if self.lock_run().gen == gen {
                    self.request_kill(gen, KILL_HARD);
                }
            }
        }
    }

    fn on_ready(&self, gen: u64, c: &Client) -> AppResult<()> {
        // 2. the identity must not have changed
        let my = c.my_id()?;
        let me = self.me().unwrap_or_default();
        if my != me {
            return Err(
                unavailable("the sharing identity changed").with_data(json!({ "fatal": true }))
            );
        }
        // 3. the GUI stays locked with a hashed password
        let gui = c.gui()?;
        if !gui["password"]
            .as_str()
            .unwrap_or_default()
            .starts_with("$2")
        {
            c.patch_gui(&json!({ "user": "tramado", "password": ids::random_alnum(32) }))?;
        }
        // 4. prime both loops while every class folder is still paused
        let (a, b) = events::prime(c);
        {
            let mut cur = self.cursor.lock().unwrap_or_else(|e| e.into_inner());
            *cur = Cursor { gen, a, b };
        }
        let ctx = Ctx {
            c,
            me: &me,
            registry: &self.cfg.registry,
            policy: &self.policy,
            appdata: &self.appdata,
            writer: &self.writer,
            emit: &*self.emitter,
            now: Now::current(),
            started: self.started_mono(),
        };
        self.apply_managed(&ctx)?;
        {
            let mut r = self.lock_run();
            if r.gen != gen {
                return Ok(());
            }
            r.started_at_ms = Some(time::now_ms());
            r.version = c
                .version()
                .ok()
                .or_else(|| Some(crate::SYNCTHING_VERSION.into()));
            r.error = None;
        }
        self.set_state(SyncState::Running);
        log::info!("sync: Syncthing is running");
        self.startup_passes(&ctx);
        Ok(())
    }

    /// §2.7: options, own name, every shared class's folder settings, ignores and pause state.
    fn apply_managed(&self, ctx: &Ctx) -> AppResult<()> {
        let settings = self.settings();
        let port = self.lock_run().sync_port.unwrap_or(0);
        let lost = self.appdata.read(|a| a.lost_identity);
        let left: BTreeSet<String> = self.cfg.registry.left_classes().into_iter().collect();
        ctx.writer.run(|| -> AppResult<()> {
            ctx.c
                .patch_options(&managed::options_body(port, &settings, self.dev_isolated))?;
            ctx.c.patch_device(
                ctx.me,
                &json!({ "name": managed::device_name(self.any_joining(), Some(&settings)) }),
            )?;
            for entry in ctx.shared_classes() {
                if left.contains(&entry.class_id) {
                    continue;
                }
                if let Err(e) = self.manage_folder(ctx, &entry, lost) {
                    log::warn!(
                        "sync: managed settings of {}: {e}",
                        ids::short_id(&entry.class_id)
                    );
                    self.note_error(&format!("managed settings: {e}"));
                }
            }
            Ok(())
        })?;
        self.reset_restore
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .for_each(|c| {
                self.appdata.update_quiet(|a| {
                    a.guard_paused.remove(c);
                });
            });
        self.reset_restore
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        if lost {
            self.appdata.update_quiet(|a| a.lost_identity = false);
        }
        Ok(())
    }

    fn manage_folder(&self, ctx: &Ctx, entry: &ClassEntry, lost: bool) -> AppResult<()> {
        let id = &entry.class_id;
        let existing = ctx.c.folder(id)?;
        let label = self
            .policy
            .get(id)
            .map(|p| p.label)
            .filter(|l| !l.is_empty())
            .or_else(|| {
                existing
                    .as_ref()
                    .and_then(|f| f["label"].as_str().map(str::to_string))
            })
            .unwrap_or_else(|| {
                entry
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            });
        if existing.is_none() {
            if !entry.path.is_dir() {
                ctx.emit(SyncEvent::MarkerMissing {
                    class_id: id.clone(),
                });
                return Ok(());
            }
            let mut devices = vec![ctx.me.to_string()];
            if lost {
                devices.extend(self.lost_identity_devices(ctx, entry)?);
            }
            folders::create_folder(
                ctx,
                id,
                &label,
                &entry.path,
                &devices,
                &managed::ignore_lines_for(entry, &[]),
                false,
            )?;
        } else {
            ctx.c.patch_folder(id, &managed::folder_settings(&label))?;
            let current = ctx.c.ignores(id).unwrap_or_default();
            ctx.c
                .set_ignores(id, &managed::ignore_lines_for(entry, &current))?;
        }
        if !self.paused_effective(id) {
            ctx.c.patch_folder(id, &json!({ "paused": false }))?;
        }
        Ok(())
    }

    /// After a lost identity (§2.3): every device with a member file in the local copy (from the
    /// last policy's roster, else the member files on disk), configured with its addresses.
    fn lost_identity_devices(&self, ctx: &Ctx, entry: &ClassEntry) -> AppResult<Vec<String>> {
        let mut found: BTreeMap<String, Vec<String>> = BTreeMap::new();
        if let Some(p) = self.policy.get(&entry.class_id) {
            for r in p.roster {
                found.insert(r.device_id, r.addresses);
            }
        }
        if found.is_empty() {
            if let Ok(rd) = std::fs::read_dir(entry.path.join(".tramado").join("members")) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let Some(dev) = name.strip_suffix(".json") else {
                        continue;
                    };
                    if !ids::is_device_id(dev) {
                        continue;
                    }
                    let addrs = std::fs::read(e.path())
                        .ok()
                        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                        .and_then(|v| {
                            v["addresses"].as_array().map(|a| {
                                a.iter()
                                    .filter_map(|x| x.as_str().map(str::to_string))
                                    .collect::<Vec<_>>()
                            })
                        })
                        .unwrap_or_default();
                    found.insert(dev.to_string(), addrs);
                }
            }
        }
        found.remove(ctx.me);
        for (d, addrs) in &found {
            if ctx.c.device(d)?.is_none() {
                let mut a: Vec<String> = addrs
                    .iter()
                    .filter(|x| crate::invite::valid_address(x))
                    .cloned()
                    .collect();
                a.push("dynamic".into());
                ctx.c.add_device(&json!({
                    "deviceID": d, "addresses": a, "compression": "metadata",
                    "introducer": false, "autoAcceptFolders": false
                }))?;
            }
        }
        Ok(found.into_keys().collect())
    }

    /// §2.5 step 4 passes: admission, reconciliation, self-heal, leaving; then listener check.
    fn startup_passes(&self, ctx: &Ctx) {
        {
            let mut adm = self.adm.lock().unwrap_or_else(|e| e.into_inner());
            if let Err(e) = adm.handle_pending_devices(ctx) {
                log::warn!("sync: start-up admission: {e}");
            }
            if let Err(e) = adm.handle_pending_folders(ctx) {
                log::warn!("sync: start-up admission: {e}");
            }
        }
        for entry in ctx.shared_classes() {
            self.reconcile_one(ctx, &entry.class_id);
            for e in selfheal::startup_pass(ctx, &self.cfg.fs, &entry.class_id) {
                ctx.emit(e);
            }
            if entry.leaving.is_some() {
                self.work.push(Task::Leave(entry.class_id.clone()));
            }
        }
        self.check_listener(ctx);
        self.check_joining(ctx);
    }

    fn reconcile_one(&self, ctx: &Ctx, class: &str) {
        let discovered = self
            .disc
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .discovered
            .clone();
        let adm = self.adm.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(e) = reconcile::reconcile(ctx, &adm, class, &discovered) {
            log::warn!("sync: reconcile {}: {e}", ids::short_id(class));
        }
    }

    /// §2.7: a listener error on the sync port → probe a new one and PATCH it.
    fn check_listener(&self, ctx: &Ctx) {
        let Some(port) = self.lock_run().sync_port else {
            return;
        };
        let Ok(st) = ctx.c.system_status() else {
            return;
        };
        let failing = st["connectionServiceStatus"].as_object().is_some_and(|m| {
            m.iter().any(|(uri, v)| {
                uri.starts_with("tcp://")
                    && uri.ends_with(&format!(":{port}"))
                    && !v["error"].is_null()
            })
        });
        if !failing {
            return;
        }
        let Ok(p) = init::probe_sync_port() else {
            return;
        };
        if let Some(mut inst) = init::read_instance(&self.home) {
            inst.sync_port = Some(p);
            let _ = init::write_instance(&self.home, &inst);
        }
        self.lock_run().sync_port = Some(p);
        let body = managed::options_body(p, &self.settings(), self.dev_isolated);
        let _ = ctx.writer.run(|| {
            ctx.c
                .patch_options(&json!({ "listenAddresses": body["listenAddresses"] }))
        });
        log::warn!("sync: the sync port was taken; moved to {p}");
    }

    /// Joiner side (§8): `remoteState: valid` from any member → `admittedMe`.
    fn check_joining(&self, ctx: &Ctx) {
        for e in ctx.shared_classes().into_iter().filter(|e| e.joining) {
            let Ok(Some(f)) = ctx.c.folder(&e.class_id) else {
                continue;
            };
            for d in folder_devices(&f).iter().filter(|d| *d != ctx.me) {
                if let Ok(v) = ctx.c.completion(&e.class_id, d) {
                    if v["remoteState"] == "valid" {
                        self.maybe_admitted_me(&e.class_id, d);
                    }
                }
            }
        }
    }

    // ── event-loop helpers ─────────────────────────────────────────────────────────────

    pub fn events_cursor(&self, which: Loop) -> Option<(Client, u64, u64)> {
        let c = self.client()?;
        let gen = self.lock_run().gen;
        let cur = self.cursor.lock().unwrap_or_else(|e| e.into_inner());
        if cur.gen != gen {
            return None;
        }
        Some((
            c,
            gen,
            match which {
                Loop::A => cur.a,
                Loop::B => cur.b,
            },
        ))
    }

    pub fn advance_cursor(
        &self,
        which: Loop,
        gen: u64,
        since: u64,
        events: &[crate::client::Event],
    ) -> bool {
        let mut cur = self.cursor.lock().unwrap_or_else(|e| e.into_inner());
        if cur.gen != gen {
            return false;
        }
        let max = events
            .iter()
            .map(|e| e.id)
            .max()
            .unwrap_or(since)
            .max(since);
        match which {
            Loop::A => cur.a = max,
            Loop::B => cur.b = max,
        }
        true
    }

    pub fn work_after_gap(&self) {
        self.with_admission(|adm, ctx| {
            adm.handle_pending_devices(ctx)?;
            adm.handle_pending_folders(ctx)
        });
        let classes: Vec<String> = self
            .cfg
            .registry
            .list()
            .into_iter()
            .filter(|e| e.shared)
            .map(|e| e.class_id)
            .collect();
        for t in events::gap_tasks(&classes) {
            self.work.push(t);
        }
    }

    pub fn note_connected(&self, dev: &str) {
        self.disc
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .last_connected
            .insert(dev.to_string(), Instant::now());
    }

    pub fn note_completion(&self, class: &str, dev: &str, d: &Value) {
        self.completion
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((class.to_string(), dev.to_string()), completion_of(d));
    }

    pub fn maybe_admitted_me(&self, class: &str, dev: &str) {
        let joining = self
            .cfg
            .registry
            .get(class)
            .is_some_and(|e| e.class_id == class && e.joining);
        if !joining {
            return;
        }
        let first = self
            .admitted_me
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((class.to_string(), dev.to_string()));
        if first {
            self.emit(SyncEvent::AdmittedMe {
                class_id: class.to_string(),
                by_device: dev.to_string(),
            });
        }
    }

    pub fn leaving_nudge(&self, class: &str) {
        if self
            .cfg
            .registry
            .get(class)
            .is_some_and(|e| e.class_id == class && e.leaving.is_some())
        {
            self.work.push(Task::Leave(class.to_string()));
        }
    }

    pub fn folder_view(
        &self,
        c: &Client,
        class: &str,
        summary: Option<&Value>,
        fresh: bool,
    ) -> AppResult<FolderView> {
        let f = c
            .folder(class)?
            .ok_or_else(|| AppError::not_found("the class is not shared"))?;
        let paused = f["paused"].as_bool().unwrap_or(false);
        let st = match summary {
            Some(s) => s.clone(),
            None => c.db_status(class).unwrap_or(Value::Null),
        };
        let me = self.me().unwrap_or_default();
        let devices: Vec<String> = folder_devices(&f);
        let mut completion = BTreeMap::new();
        for d in devices.iter().filter(|d| **d != me) {
            let cached = self
                .completion
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&(class.to_string(), d.clone()))
                .cloned();
            let v = match (fresh, cached) {
                (false, Some(v)) => v,
                _ => match c.completion(class, d) {
                    Ok(v) => completion_of(&v),
                    Err(_) => continue,
                },
            };
            completion.insert(d.clone(), v);
        }
        let err = st["error"].as_str().unwrap_or_default();
        Ok(FolderView {
            class_id: class.to_string(),
            label: f["label"].as_str().unwrap_or_default().to_string(),
            path: f["path"].as_str().unwrap_or_default().to_string(),
            paused,
            state: folder_state(st["state"].as_str().unwrap_or_default(), paused),
            global_files: st["globalFiles"].as_u64().unwrap_or(0),
            in_sync_files: st["inSyncFiles"].as_u64().unwrap_or(0),
            need_files: st["needFiles"].as_u64().unwrap_or(0),
            need_bytes: st["needBytes"].as_u64().unwrap_or(0),
            pull_errors: st["pullErrors"].as_u64().unwrap_or(0),
            error: (!err.is_empty()).then(|| err.to_string()),
            devices,
            completion,
        })
    }

    pub fn emit_folder(&self, class: &str, summary: Option<&Value>) {
        let Some(c) = self.client() else { return };
        if let Ok(folder) = self.folder_view(&c, class, summary, false) {
            self.emit(SyncEvent::Folder { folder });
        }
    }

    pub fn emit_folder_errors(&self, class: &str) {
        let Some(c) = self.client() else { return };
        if let Ok(list) = c.folder_errors(class) {
            self.emit(SyncEvent::FolderErrors {
                class_id: class.to_string(),
                errors: list
                    .into_iter()
                    .map(|(path, error)| FolderError { path, error })
                    .collect(),
            });
        }
    }

    pub fn emit_listen_addresses(&self) {
        if let Ok(addresses) = self.own_addresses() {
            self.emit(SyncEvent::ListenAddresses { addresses });
        }
    }

    pub fn own_addresses(&self) -> AppResult<Vec<String>> {
        let c = self.running_client()?;
        Ok(crate::discovery::own_addresses(
            &c.system_status()?,
            self.dev_isolated,
        ))
    }

    pub fn is_own_change(&self, class: &str, path: &str) -> bool {
        self.guard
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_own(class, path, Instant::now())
            || self
                .cfg
                .fs
                .is_recent_self_write(class, path, Duration::from_secs(10))
    }

    pub fn local_guard(&self, class: &str, path: &str, deleted: bool) {
        let trip = self
            .guard
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .local_change(class, path, deleted, Instant::now());
        let Some((count, sample)) = trip else { return };
        log::warn!(
            "sync: {count} deletions in {} not made by Tramado: pausing",
            ids::short_id(class)
        );
        let _ = self.with_ctx(|ctx| {
            ctx.writer
                .run(|| ctx.c.patch_folder(class, &json!({ "paused": true })))
        });
        self.appdata.update_quiet(|a| {
            a.guard_paused.insert(class.to_string());
        });
        self.emit(SyncEvent::MassDelete {
            class_id: class.to_string(),
            count,
            sample,
        });
    }

    pub fn remote_guard(&self, class: &str, by: &str, path: &str, deleted: bool) {
        let trip = self
            .guard
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remote_change(class, by, path, deleted, Instant::now());
        if let Some((count, sample)) = trip {
            self.emit(SyncEvent::MassDeleteRemote {
                class_id: class.to_string(),
                by: by.to_string(),
                count,
                sample,
            });
        }
    }

    pub fn self_heal(&self, class: &str, path: &str, by: &str, remote: bool) {
        let me = self.me().unwrap_or_default();
        if remote && by == ids::short_id(&me) {
            return;
        }
        let ev = self.with_ctx(|ctx| Ok(selfheal::heal(ctx, &self.cfg.fs, class, path, by)));
        if let Ok(Some(e)) = ev {
            self.emit(e);
        }
    }

    // ── threads ────────────────────────────────────────────────────────────────────────

    fn ensure_threads(self: &Arc<Self>) {
        let mut started = self.threads.lock().unwrap_or_else(|e| e.into_inner());
        if *started {
            return;
        }
        *started = true;
        for (name, which) in [
            ("tramado-sync-events-a", Loop::A),
            ("tramado-sync-events-b", Loop::B),
        ] {
            let w = self.weak.clone();
            let _ = std::thread::Builder::new()
                .name(name.into())
                .spawn(move || events::run(w, which));
        }
        let w = self.weak.clone();
        let _ = std::thread::Builder::new()
            .name("tramado-sync-ticker".into())
            .spawn(move || ticker(w));
        let w = self.weak.clone();
        let _ = std::thread::Builder::new()
            .name("tramado-sync-work".into())
            .spawn(move || worker(w));
    }

    fn tick(&self, n: u64) {
        let forbidden = self
            .lock_run()
            .forbidden
            .as_ref()
            .is_some_and(|f| f.load(Ordering::SeqCst));
        if forbidden {
            log::warn!("sync: the API key was refused; restarting Syncthing");
            let gen = self.lock_run().gen;
            self.request_kill(gen, KILL_TERM);
            return;
        }
        let _ = self.with_ctx(|ctx| {
            {
                let mut adm = self.adm.lock().unwrap_or_else(|e| e.into_inner());
                if adm.early_evictions(ctx).unwrap_or(false) {
                    let _ = adm.apply_ignores(ctx);
                }
                if n.is_multiple_of(5) {
                    if let Err(e) = adm.sweep(ctx) {
                        log::warn!("sync: sweep: {e}");
                    }
                }
            }
            if n.is_multiple_of(5) {
                self.check_joining(ctx);
            }
            if n.is_multiple_of(10) {
                let s = self.settings();
                let off = s.local_only || s.paused || self.dev_isolated;
                let policies = self.policy.all();
                let addrs = |d: &str| -> Vec<String> {
                    policies
                        .values()
                        .flat_map(|p| p.roster.iter())
                        .filter(|r| r.device_id == d)
                        .flat_map(|r| r.addresses.clone())
                        .collect()
                };
                let started = self.started_mono();
                self.disc.lock().unwrap_or_else(|e| e.into_inner()).tick(
                    ctx,
                    started,
                    off,
                    &*self.lookuper,
                    &addrs,
                );
            }
            if n.is_multiple_of(60) {
                for e in ctx.shared_classes() {
                    self.reconcile_one(ctx, &e.class_id);
                    if e.leaving.is_some() {
                        self.work.push(Task::Leave(e.class_id.clone()));
                    }
                }
                self.check_listener(ctx);
            }
            Ok(())
        });
    }

    fn run_task(&self, t: Task) {
        let res = match &t {
            Task::Scan { class, sub } => match self.client() {
                Some(c) => match c.scan(class, sub.as_deref()) {
                    Err(e) if e.code() == Code::SyncFolderMarkerMissing => {
                        self.emit(SyncEvent::MarkerMissing {
                            class_id: class.clone(),
                        });
                        Ok(())
                    }
                    r => r,
                },
                None => Ok(()),
            },
            Task::Ignores(class) => self.with_ctx(|ctx| {
                let Some(entry) = ctx.class(class).filter(|e| e.shared) else {
                    return Ok(());
                };
                let current = ctx.c.ignores(class).unwrap_or_default();
                ctx.c
                    .set_ignores(class, &managed::ignore_lines_for(&entry, &current))
            }),
            Task::DeviceName => self.with_ctx(|ctx| {
                let name = managed::device_name(self.any_joining(), Some(&self.settings()));
                ctx.writer
                    .run(|| ctx.c.patch_device(ctx.me, &json!({ "name": name })))
            }),
            Task::Leave(class) => self.with_ctx(|ctx| {
                let keep: HashSet<String> = self
                    .adm
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .provisional
                    .keys()
                    .cloned()
                    .collect();
                let sink = self.sink.clone();
                let trash = move |p: &Path| sink.trash(p);
                let mirror = self.cfg.paths.private_dir(class).join("mirror");
                if folders::finish_leaving(ctx, class, &keep, &trash, &mirror)? {
                    self.work.push(Task::DeviceName);
                }
                Ok(())
            }),
            Task::Reconcile(class) => self.with_ctx(|ctx| {
                self.reconcile_one(ctx, class);
                Ok(())
            }),
        };
        if let Err(e) = res {
            if e.code() != Code::SyncUnavailable {
                log::warn!("sync: {t:?}: {e}");
            }
        }
    }

    // ── public operations (SyncEngine delegates here) ──────────────────────────────────

    pub fn start(self: &Arc<Self>) -> AppResult<SyncStatus> {
        self.identity()?;
        if self.cfg.sidecar.as_ref().is_none_or(|b| !b.is_file()) {
            return Err(unavailable("the Syncthing sidecar is missing"));
        }
        self.ensure_threads();
        {
            let mut r = self.lock_run();
            let alive = r.supervisor.as_ref().is_some_and(|h| !h.is_finished());
            if !alive {
                r.want = true;
                r.error = None;
                r.kill = KILL_NONE;
                r.state = SyncState::Starting;
                let _ = self.started_mono();
                let me = self.clone();
                r.supervisor = Some(
                    std::thread::Builder::new()
                        .name("tramado-syncthing".into())
                        .spawn(move || supervisor::run(me))
                        .map_err(|e| {
                            AppError::new(Code::IoError, format!("cannot start a thread: {e}"))
                        })?,
                );
            }
        }
        self.emit_status();
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut r = self.lock_run();
        while r.state != SyncState::Running && r.state != SyncState::Error && r.want {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            r = self
                .run_cv
                .wait_timeout(r, left)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        if r.state == SyncState::Error {
            let code = r.error.unwrap_or(Code::SyncUnavailable);
            drop(r);
            return Err(AppError::new(code, "sharing could not start"));
        }
        drop(r);
        Ok(self.status())
    }

    /// Starts Syncthing if it is not running (share, join, accept).
    pub fn ensure_running(self: &Arc<Self>) -> AppResult<()> {
        if self.client().is_some() {
            return Ok(());
        }
        let st = self.start()?;
        if st.state != SyncState::Running {
            return Err(unavailable("sharing is still starting"));
        }
        Ok(())
    }

    pub fn stop(&self, deadline: Duration) {
        let start = Instant::now();
        let (client, handle) = {
            let mut r = self.lock_run();
            r.want = false;
            (r.client.clone(), r.supervisor.take())
        };
        self.run_cv.notify_all();
        if let Some(c) = client {
            let _ = c.shutdown(Duration::from_secs(2));
        }
        let wait_pid = |until: Duration| {
            let mut r = self.lock_run();
            while r.pid.is_some() {
                let left = until.saturating_sub(start.elapsed());
                if left.is_zero() {
                    break;
                }
                r = self
                    .run_cv
                    .wait_timeout(r, left.min(Duration::from_millis(50)))
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
            r.pid.is_some()
        };
        let term_at = Duration::from_secs(3).min(deadline);
        if wait_pid(term_at) {
            let gen = self.lock_run().gen;
            self.request_kill(gen, KILL_TERM);
            if wait_pid(deadline) {
                self.request_kill(gen, KILL_HARD);
                wait_pid(deadline + Duration::from_secs(1));
            }
        }
        if let Some(h) = handle {
            let t = Instant::now();
            while !h.is_finished() && t.elapsed() < Duration::from_secs(2) {
                std::thread::sleep(Duration::from_millis(20));
            }
            if h.is_finished() {
                let _ = h.join();
            }
        }
        {
            let mut r = self.lock_run();
            r.client = None;
            if r.state != SyncState::Error {
                r.state = SyncState::Stopped;
            }
        }
        self.run_cv.notify_all();
        self.emit_status();
    }

    pub fn shutdown_threads(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> AppResult<SyncSnapshot> {
        let status = self.status();
        let existing = crate::existing::detect();
        let Some(c) = self.client() else {
            return Ok(SyncSnapshot {
                status,
                folders: vec![],
                devices: vec![],
                join_requests: vec![],
                folder_offers: vec![],
                existing,
            });
        };
        let me = self.me().unwrap_or_default();
        let cfg = c.config()?;
        let mut folders = Vec::new();
        for e in self.cfg.registry.list().into_iter().filter(|e| e.shared) {
            if let Ok(v) = self.folder_view(&c, &e.class_id, None, true) {
                folders.push(v);
            }
        }
        let conns = c.connections().unwrap_or(Value::Null);
        let stats = c.stats_device().unwrap_or(Value::Null);
        let (provisional, join_requests) = {
            let adm = self.adm.lock().unwrap_or_else(|e| e.into_inner());
            let p: HashSet<String> = adm.provisional.keys().cloned().collect();
            (p, adm.join_requests())
        };
        let pend = c.pending_folders().unwrap_or_default();
        let folder_offers = self
            .adm
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .folder_offers(&pend);
        let mut devices = Vec::new();
        for d in cfg["devices"].as_array().into_iter().flatten() {
            let id = d["deviceID"].as_str().unwrap_or_default().to_string();
            if id == me {
                continue;
            }
            let conn = &conns[&id];
            let folders_of: Vec<String> = cfg["folders"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|f| folder_devices(f).contains(&id))
                .filter_map(|f| f["id"].as_str().map(str::to_string))
                .collect();
            devices.push(DeviceView {
                device_id: id.clone(),
                name: d["name"].as_str().unwrap_or_default().to_string(),
                connected: conn["connected"].as_bool().unwrap_or(false),
                relay: conn["type"].as_str().unwrap_or_default().contains("relay"),
                address: conn["address"]
                    .as_str()
                    .filter(|a| !a.is_empty())
                    .map(str::to_string),
                paused: d["paused"].as_bool().unwrap_or(false),
                last_seen: stats[&id]["lastSeen"].as_str().and_then(to_instant),
                folders: folders_of,
                provisional: provisional.contains(&id),
                ignored: false,
            });
        }
        for d in cfg["remoteIgnoredDevices"].as_array().into_iter().flatten() {
            let id = d["deviceID"].as_str().unwrap_or_default().to_string();
            devices.push(DeviceView {
                device_id: id.clone(),
                name: String::new(),
                connected: false,
                relay: false,
                address: None,
                paused: false,
                last_seen: stats[&id]["lastSeen"].as_str().and_then(to_instant),
                folders: vec![],
                provisional: false,
                ignored: true,
            });
        }
        Ok(SyncSnapshot {
            status,
            folders,
            devices,
            join_requests,
            folder_offers,
            existing,
        })
    }

    pub fn apply_settings(&self, s: SyncSettings) -> AppResult<()> {
        if s.max_send_kbps > 10_000_000 || s.max_recv_kbps > 10_000_000 {
            return Err(AppError::invalid("bandwidth limit out of range"));
        }
        self.appdata.update(|a| a.settings = Some(s.clone()))?;
        let Some(c) = self.client() else {
            return Ok(());
        };
        let port = self.lock_run().sync_port.unwrap_or(0);
        let me = self.me().unwrap_or_default();
        self.writer.run(|| -> AppResult<()> {
            c.patch_options(&managed::options_body(port, &s, self.dev_isolated))?;
            c.patch_device(
                &me,
                &json!({ "name": managed::device_name(self.any_joining(), Some(&s)) }),
            )?;
            for e in self.cfg.registry.list().into_iter().filter(|e| e.shared) {
                if c.folder(&e.class_id)?.is_some() {
                    c.patch_folder(
                        &e.class_id,
                        &json!({ "paused": self.paused_effective(&e.class_id) }),
                    )?;
                }
            }
            Ok(())
        })?;
        self.emit_status();
        Ok(())
    }

    pub fn set_class_policy(&self, p: ClassPolicy) -> AppResult<()> {
        if !ids::is_class_id(&p.class_id) {
            return Err(AppError::invalid("not a class ID"));
        }
        let entry = self
            .cfg
            .registry
            .get(&p.class_id)
            .filter(|e| e.class_id == p.class_id)
            .ok_or_else(|| AppError::not_found("no such class"))?;
        let class = p.class_id.clone();
        let label = p.label.clone();
        self.policy.set(p)?;
        if !entry.shared {
            return Ok(());
        }
        let r = self.with_ctx(|ctx| {
            if !label.is_empty() {
                if let Some(f) = ctx.c.folder(&class)? {
                    if f["label"].as_str() != Some(label.as_str()) {
                        ctx.writer
                            .run(|| ctx.c.patch_folder(&class, &json!({ "label": label })))?;
                    }
                }
            }
            self.reconcile_one(ctx, &class);
            let mut adm = self.adm.lock().unwrap_or_else(|e| e.into_inner());
            adm.handle_pending_folders(ctx)
        });
        match r {
            Err(e) if e.code() == Code::SyncUnavailable => Ok(()),
            Err(e) => {
                log::warn!("sync: policy push of {}: {e}", ids::short_id(&class));
                Ok(())
            }
            Ok(()) => {
                self.work.push(Task::Ignores(class));
                Ok(())
            }
        }
    }

    pub fn resolve_parent(&self, parent: Option<&str>) -> AppResult<PathBuf> {
        match parent {
            Some(tok) => {
                let r = self
                    .picks
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
                    .ok_or_else(|| AppError::invalid("picks are not available"))?;
                r(tok)
            }
            None => Ok(self
                .cfg
                .registry
                .root_dir()
                .unwrap_or_else(|| self.cfg.paths.default_classes_root.clone())),
        }
    }

    pub fn join_class(self: &Arc<Self>, req: JoinRequest) -> AppResult<ClassEntry> {
        let me = self.identity()?.device_id;
        let inv = crate::invite::decode(&req.code, Some(&me))?;
        if !folders::valid_dir_name(&req.dir_name) {
            return Err(AppError::invalid("bad folder name"));
        }
        let dir = self
            .resolve_parent(req.parent.as_deref())?
            .join(&req.dir_name);
        if self.cfg.registry.get(&inv.folder).is_some() {
            return Err(AppError::conflict("this class is already on this computer")
                .with_data(json!({ "classId": inv.folder })));
        }
        if dir.exists() {
            return Err(AppError::conflict("the folder exists"));
        }
        self.ensure_running()?;
        let mirror = self.cfg.paths.private_dir(&inv.folder).join("mirror");
        let unpause = !self.settings().paused;
        let entry = self.with_ctx(|ctx| {
            folders::join_class(ctx, &inv, &dir, req.include_audio, unpause, &mirror)
        })?;
        self.work.push(Task::DeviceName);
        log::info!("sync: joining {}", ids::short_id(&inv.folder));
        Ok(entry)
    }

    pub fn accept_folder(self: &Arc<Self>, req: AcceptFolderRequest) -> AppResult<ClassEntry> {
        if !folders::valid_dir_name(&req.dir_name) {
            return Err(AppError::invalid("bad folder name"));
        }
        let dir = self
            .resolve_parent(req.parent.as_deref())?
            .join(&req.dir_name);
        self.ensure_running()?;
        let unpause = !self.settings().paused;
        let entry = self.with_ctx(|ctx| {
            folders::accept_folder(
                ctx,
                &req.folder_id,
                &req.offered_by,
                &req.label,
                &dir,
                req.include_audio,
                unpause,
            )
        })?;
        self.adm
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .offers
            .retain(|(f, _), _| *f != req.folder_id);
        self.work.push(Task::DeviceName);
        Ok(entry)
    }

    pub fn cancel_join(&self, class: &str) -> AppResult<()> {
        let keep: HashSet<String> = self
            .adm
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .provisional
            .keys()
            .cloned()
            .collect();
        self.with_ctx(|ctx| folders::cancel_join(ctx, class, &keep))?;
        self.work.push(Task::DeviceName);
        Ok(())
    }

    pub fn leave_class(&self, class: &str, opts: LeaveOptions) -> AppResult<()> {
        let entry = self
            .cfg
            .registry
            .get(class)
            .filter(|e| e.class_id == class)
            .ok_or_else(|| AppError::not_found("no such class"))?;
        if !entry.shared {
            return Err(AppError::conflict("the class is not shared"));
        }
        let afterwards = match opts.afterwards {
            LeaveAfterwards::KeepLocal => "keepLocal",
            LeaveAfterwards::Trash => "trash",
        };
        self.cfg.registry.update(class, |e| {
            e.leaving = Some(tramado_base::registry::Leaving {
                since: time::instant(time::now_ms()),
                afterwards: afterwards.to_string(),
            });
            e.joining = false;
        })?;
        self.work.push(Task::Leave(class.to_string()));
        Ok(())
    }

    pub fn resolve_mass_delete(&self, class: &str, action: MassDeleteAction) -> AppResult<()> {
        if self.cfg.registry.get(class).filter(|e| e.shared).is_none() {
            return Err(AppError::not_found("no such shared class"));
        }
        self.guard
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reset(class);
        match action {
            MassDeleteAction::Confirm => {
                self.appdata.update(|a| {
                    a.guard_paused.remove(class);
                })?;
                let paused = self.paused_effective(class);
                self.with_ctx(|ctx| {
                    ctx.writer
                        .run(|| ctx.c.patch_folder(class, &json!({ "paused": paused })))
                })
            }
            MassDeleteAction::Restore => {
                let c = self.running_client()?;
                let gen = self.lock_run().gen;
                self.writer
                    .run(|| c.patch_folder(class, &json!({ "paused": true })))?;
                self.reset_restore
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(class.to_string());
                // Syncthing forgets the folder's index and exits with code 3; the supervisor
                // respawns it, the folder starts paused and the start-up routine resumes it.
                c.reset_folder(class)?;
                let deadline = Instant::now() + Duration::from_secs(45);
                let mut r = self.lock_run();
                while !(r.gen > gen && r.state == SyncState::Running) && r.want {
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        break;
                    }
                    r = self
                        .run_cv
                        .wait_timeout(r, left)
                        .unwrap_or_else(|e| e.into_inner())
                        .0;
                }
                Ok(())
            }
        }
    }

    pub fn resolve_copied_identity(
        self: &Arc<Self>,
        action: CopiedIdentityAction,
    ) -> AppResult<SyncIdentity> {
        match action {
            CopiedIdentityAction::Same => {
                let mut inst = init::read_instance(&self.home)
                    .ok_or_else(|| unavailable("the sharing identity is missing"))?;
                inst.machine = init::machine_id();
                init::write_instance(&self.home, &inst)?;
            }
            CopiedIdentityAction::New => {
                self.stop(Duration::from_secs(5));
                let stamp = time::instant(time::now_ms())
                    .replace([':', '.'], "")
                    .replace('T', "-");
                let moved = self
                    .home
                    .with_file_name(format!("syncthing.copied-{stamp}"));
                if self.home.exists() {
                    std::fs::rename(&self.home, &moved)?;
                }
                self.forget_identity();
                let id = self.identity()?;
                // keep what the app pushed (rosters re-create the folders, §2.3) and mark the
                // lost-identity path
                let _ = std::fs::copy(
                    moved.join(crate::policy::FILE_NAME),
                    self.home.join(crate::policy::FILE_NAME),
                );
                let shared = self.cfg.registry.list().iter().any(|e| e.shared);
                self.appdata.update(|a| {
                    a.lost_identity = shared;
                    a.seen_member.clear();
                    a.proof_at.clear();
                })?;
                let _ = id;
            }
        }
        {
            let mut r = self.lock_run();
            if r.error == Some(Code::SyncIdentityCopied) {
                r.error = None;
                r.state = SyncState::Stopped;
            }
        }
        self.emit_status();
        self.identity()
    }

    pub fn file_info(&self, class: &str, paths: &[String]) -> AppResult<Vec<FileSyncInfo>> {
        if paths.len() > 500 {
            return Err(AppError::invalid("at most 500 paths"));
        }
        let c = self.running_client()?;
        let me = self.me().unwrap_or_default();
        let mut out = Vec::with_capacity(paths.len());
        for p in paths {
            tramado_base::confine::validate_class_path(p)?;
            let f = c.db_file(class, p)?.unwrap_or_default();
            let l = f.local.clone().unwrap_or_default();
            let g = f.global.clone().unwrap_or_default();
            out.push(FileSyncInfo {
                path: p.clone(),
                local_modified_by: l.modified_by.clone(),
                local_deleted: l.deleted,
                local_size: f.local.as_ref().and(l.size),
                local_blocks_hash: l.blocks_hash.clone(),
                local_modified: l.modified.as_deref().and_then(to_instant),
                local_version: l.version.clone(),
                local_sequence: l.sequence,
                global_modified_by: g.modified_by.clone(),
                global_deleted: g.deleted,
                availability: f.holders().into_iter().filter(|d| *d != me).collect(),
            });
        }
        Ok(out)
    }

    pub fn wait_available(
        &self,
        class: &str,
        path: &str,
        min: usize,
        timeout: Duration,
    ) -> AppResult<bool> {
        tramado_base::confine::validate_class_path(path)?;
        let deadline = Instant::now() + timeout.min(Duration::from_secs(600));
        loop {
            let c = self.running_client()?;
            let n = c
                .db_file(class, path)?
                .map(|f| f.holders().len())
                .unwrap_or(0);
            if n >= min {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }

    pub fn wait_caught_up(&self, class: &str, timeout: Duration) -> AppResult<CaughtUp> {
        let start = Instant::now();
        let deadline = start + timeout.min(Duration::from_secs(600));
        loop {
            let c = self.running_client()?;
            let me = self.me().unwrap_or_default();
            let f = c
                .folder(class)?
                .ok_or_else(|| AppError::not_found("the class is not shared"))?;
            let conns = c.connections().unwrap_or(Value::Null);
            let mut pending = Vec::new();
            for d in folder_devices(&f).into_iter().filter(|d| *d != me) {
                if !conns[&d]["connected"].as_bool().unwrap_or(false) {
                    continue;
                }
                let v = c.completion(class, &d)?;
                let done = v["remoteState"] == "valid"
                    && v["needItems"].as_u64().unwrap_or(0) == 0
                    && v["completion"].as_f64().unwrap_or(0.0) >= 100.0;
                if !done {
                    pending.push(d);
                }
            }
            let st = c.db_status(class)?;
            let local_done = st["needTotalItems"].as_u64().unwrap_or(0) == 0
                && !matches!(
                    st["state"].as_str(),
                    Some("syncing" | "sync-preparing" | "scanning")
                );
            let complete = pending.is_empty() && local_done;
            if complete || Instant::now() >= deadline {
                return Ok(CaughtUp {
                    complete,
                    waited_ms: start.elapsed().as_millis() as u64,
                    pending,
                });
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    pub fn device_stats(&self) -> AppResult<BTreeMap<String, DeviceStat>> {
        let c = self.running_client()?;
        let v = c.stats_device()?;
        Ok(v.as_object()
            .map(|m| {
                m.iter()
                    .map(|(d, s)| {
                        (
                            d.clone(),
                            DeviceStat {
                                last_seen: s["lastSeen"].as_str().and_then(to_instant),
                                last_connection_duration_s: s["lastConnectionDurationS"]
                                    .as_f64()
                                    .unwrap_or(0.0),
                            },
                        )
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    pub fn versions(&self, class: &str) -> AppResult<Vec<VersionEntry>> {
        let c = self.running_client()?;
        let mut out = Vec::new();
        for (path, list) in c.versions(class)? {
            for v in list {
                out.push(VersionEntry {
                    path: path.clone(),
                    version_time: v["versionTime"]
                        .as_str()
                        .and_then(to_instant)
                        .unwrap_or_default(),
                    mod_time: v["modTime"]
                        .as_str()
                        .and_then(to_instant)
                        .unwrap_or_default(),
                    size: v["size"].as_u64().unwrap_or(0),
                });
            }
        }
        Ok(out)
    }

    pub fn restore(&self, class: &str, items: &[RestoreItem]) -> AppResult<()> {
        let c = self.running_client()?;
        for i in items {
            tramado_base::confine::validate_class_path(&i.path)?;
        }
        let pairs: Vec<(String, String)> = items
            .iter()
            .map(|i| (i.path.clone(), i.version_time.clone()))
            .collect();
        let failed = c.restore_versions(class, &pairs)?;
        if failed.as_object().is_some_and(|m| !m.is_empty()) {
            return Err(AppError::not_found("some versions could not be restored")
                .with_data(json!({ "failed": failed.as_object().map(|m| m.keys().cloned().collect::<Vec<_>>()) })));
        }
        Ok(())
    }

    pub fn pause_class(&self, class: &str, paused: bool) -> AppResult<()> {
        let effective = paused
            || self.settings().paused
            || self.appdata.read(|a| a.guard_paused.contains(class));
        match self.with_ctx(|ctx| folders::pause_class(ctx, class, paused, effective)) {
            Err(e) if e.code() == Code::SyncUnavailable => self.appdata.update(|a| {
                if paused {
                    a.user_paused.insert(class.to_string());
                } else {
                    a.user_paused.remove(class);
                }
            }),
            r => r,
        }
    }

    pub fn diagnostics(&self) -> AppResult<SyncDiagnostics> {
        let status = self.status();
        let (key, port) = {
            let r = self.lock_run();
            (r.api_key.clone(), r.sync_port)
        };
        let c = self.client();
        let gui_open = c.as_ref().is_some_and(|c| c.health());
        let mut listeners = BTreeMap::new();
        let mut connections = 0;
        let mut relayed = 0;
        let mut last_errors: Vec<DiagError> = self
            .errors
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect();
        if let Some(c) = &c {
            if let Ok(st) = c.system_status() {
                if let Some(m) = st["connectionServiceStatus"].as_object() {
                    for (uri, v) in m {
                        listeners.insert(uri.clone(), v["error"].as_str().map(str::to_string));
                    }
                }
            }
            if let Ok(conns) = c.connections() {
                for v in conns.as_object().into_iter().flat_map(|m| m.values()) {
                    if v["connected"].as_bool().unwrap_or(false) {
                        connections += 1;
                        if v["type"].as_str().unwrap_or_default().contains("relay") {
                            relayed += 1;
                        }
                    }
                }
            }
            if let Ok(errs) = c.system_errors() {
                for e in errs["errors"].as_array().into_iter().flatten() {
                    last_errors.push(DiagError {
                        when: e["when"].as_str().and_then(to_instant).unwrap_or_default(),
                        message: crate::diag::scrub(
                            e["message"].as_str().unwrap_or_default(),
                            key.as_deref(),
                        ),
                    });
                }
            }
        }
        let log_tail = supervisor::log_tail(&self.home, 0, 50)
            .into_iter()
            .map(|l| crate::diag::scrub(&l, key.as_deref()))
            .collect();
        Ok(SyncDiagnostics {
            status,
            ports: DiagPorts {
                sync: port,
                gui_open,
            },
            listeners,
            connections,
            relayed,
            last_errors,
            log_tail,
        })
    }

    pub fn normalize_ids(&self, list: &[String]) -> AppResult<Vec<Option<String>>> {
        if list.len() > 500 {
            return Err(AppError::invalid("at most 500 IDs"));
        }
        let c = self.client();
        Ok(list
            .iter()
            .map(|id| match &c {
                Some(c) => c
                    .normalize_device_id(id)
                    .ok()
                    .flatten()
                    .or_else(|| crate::invite::normalize_device_id(id)),
                None => crate::invite::normalize_device_id(id),
            })
            .collect())
    }

    /// The registry changed (TS `class_update`, our own updates): re-apply what depends on it.
    pub fn registry_changed(&self, before: Option<&ClassEntry>, after: Option<&ClassEntry>) {
        let Some(a) = after else {
            return;
        };
        if !a.shared {
            return;
        }
        let ignores_changed = before
            .is_none_or(|b| b.skip_audio != a.skip_audio || b.local_ignores != a.local_ignores);
        if ignores_changed && before.is_some() {
            self.work.push(Task::Ignores(a.class_id.clone()));
        }
        if before.is_none_or(|b| b.joining != a.joining) {
            self.work.push(Task::DeviceName);
        }
    }
}

fn ticker(weak: Weak<Inner>) {
    let mut n: u64 = 0;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        n += 1;
        let Some(inner) = weak.upgrade() else {
            return;
        };
        if inner.is_shutdown() {
            return;
        }
        if inner.client().is_some() {
            inner.tick(n);
        }
    }
}

fn worker(weak: Weak<Inner>) {
    loop {
        let Some(inner) = weak.upgrade() else {
            return;
        };
        if inner.is_shutdown() {
            return;
        }
        let task = inner.work.pop(Duration::from_millis(500));
        if let Some(t) = task {
            inner.run_task(t);
        }
    }
}
