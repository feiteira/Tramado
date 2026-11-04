// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! What the Syncthing-facing algorithms (admission, reconciliation, bans, folders, leaving)
//! run against: the REST client, this device, the registry, the stores, the event sink and the
//! clock. The engine builds one per pass; unit tests build one over the in-memory fake.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tramado_base::error::AppResult;
use tramado_base::registry::{ClassEntry, ClassRegistry};

use crate::appdata::AppDataStore;
use crate::client::Client;
use crate::config_writer::ConfigWriter;
use crate::policy::PolicyStore;
use crate::types::SyncEvent;

/// Until this long after Syncthing started, a class whose policy was not pushed this session
/// only narrows access (sync spec §9.2 start-up rule).
pub const STARTUP_GRACE: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy)]
pub struct Now {
    pub mono: Instant,
    pub ms: u64,
}

impl Now {
    pub fn current() -> Self {
        Now {
            mono: Instant::now(),
            ms: tramado_base::time::now_ms(),
        }
    }

    /// `d` later on both clocks (tests).
    pub fn plus(self, d: Duration) -> Self {
        Now {
            mono: self.mono + d,
            ms: self.ms + d.as_millis() as u64,
        }
    }

    pub fn instant(&self) -> String {
        tramado_base::time::instant(self.ms)
    }

    /// RFC 3339 for Syncthing's `time` fields.
    pub fn rfc3339(&self) -> String {
        let s = tramado_base::time::instant(self.ms);
        // "YYYY-MM-DDTHH:MM:SS.mmmZ" → "YYYY-MM-DDTHH:MM:SSZ"
        match s.find('.') {
            Some(i) => format!("{}Z", &s[..i]),
            None => s,
        }
    }
}

pub struct Ctx<'a> {
    pub c: &'a Client,
    pub me: &'a str,
    pub registry: &'a ClassRegistry,
    pub policy: &'a PolicyStore,
    pub appdata: &'a AppDataStore,
    pub writer: &'a ConfigWriter,
    pub emit: &'a (dyn Fn(SyncEvent) + Sync),
    pub now: Now,
    /// When this Syncthing session started (the start-up rule).
    pub started: Instant,
}

impl Ctx<'_> {
    pub fn emit(&self, e: SyncEvent) {
        (self.emit)(e)
    }

    /// The app pushed this class's policy this session, or the grace period is over.
    pub fn policy_received(&self, class: &str) -> bool {
        self.policy.received(class) || self.now.mono >= self.started + STARTUP_GRACE
    }

    /// A registered class by its own ID (not an alias).
    pub fn class(&self, id: &str) -> Option<ClassEntry> {
        self.registry.get(id).filter(|e| e.class_id == id)
    }

    /// Shared, registered classes (including joining and leaving ones).
    pub fn shared_classes(&self) -> Vec<ClassEntry> {
        self.registry
            .list()
            .into_iter()
            .filter(|e| e.shared)
            .collect()
    }

    /// Class IDs this device left, and every alias of a registered class (§9.2, §17, §18.2).
    pub fn retired_ids(&self) -> BTreeSet<String> {
        let mut out: BTreeSet<String> = self.registry.left_classes().into_iter().collect();
        for e in self.registry.list() {
            out.extend(e.aliases.iter().cloned());
        }
        out
    }

    /// The Syncthing folder label of a class: the policy's, else the configured one.
    pub fn label(&self, class: &str) -> String {
        if let Some(p) = self.policy.get(class) {
            if !p.label.is_empty() {
                return p.label;
            }
        }
        self.c
            .folder(class)
            .ok()
            .flatten()
            .and_then(|f| f["label"].as_str().map(str::to_string))
            .unwrap_or_default()
    }

    /// Devices bound to my own person: the roster entries (any class) that carry the memberId
    /// of my own device's roster entry (§10, §17).
    pub fn my_person_devices(&self) -> BTreeSet<String> {
        let all = self.policy.all();
        let mine: BTreeSet<String> = all
            .values()
            .flat_map(|p| p.roster.iter())
            .filter(|r| r.device_id == self.me)
            .map(|r| r.member_id.clone())
            .collect();
        all.values()
            .flat_map(|p| p.roster.iter())
            .filter(|r| mine.contains(&r.member_id))
            .map(|r| r.device_id.clone())
            .collect()
    }

    /// Adds `{"id": folder, "label": …, "time": now}` to a configured device's
    /// `ignoredFolders` (✔ PATCH shape, contract test `ignored_folders_patch_shape`).
    pub fn add_ignored_folder(&self, dev: &str, folder: &str, label: &str) -> AppResult<()> {
        self.writer.run(|| {
            let Some(d) = self.c.device(dev)? else {
                return Ok(());
            };
            let mut list = d["ignoredFolders"].as_array().cloned().unwrap_or_default();
            if list.iter().any(|e| e["id"] == folder) {
                return Ok(());
            }
            list.push(json!({ "id": folder, "label": label, "time": self.now.rfc3339() }));
            self.c
                .patch_device(dev, &json!({ "ignoredFolders": Value::Array(list) }))
        })
    }
}

#[cfg(test)]
pub mod testing {
    //! A context over the fake Syncthing, with a registry and stores in a temp dir.

    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::fake::{FakeSt, ME};
    use crate::types::ClassPolicy;

    pub struct World {
        pub dir: tempfile::TempDir,
        pub fake: Arc<FakeSt>,
        pub client: Client,
        pub registry: ClassRegistry,
        pub policy: PolicyStore,
        pub appdata: AppDataStore,
        pub writer: ConfigWriter,
        pub events: Arc<Mutex<Vec<SyncEvent>>>,
        pub sink: Box<dyn Fn(SyncEvent) + Send + Sync>,
        pub started: Instant,
    }

    impl Default for World {
        fn default() -> Self {
            Self::new()
        }
    }

    impl World {
        pub fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let fake = Arc::new(FakeSt::new());
            std::fs::create_dir_all(dir.path().join("config")).unwrap();
            let registry = ClassRegistry::load(&dir.path().join("config")).unwrap();
            let home = dir.path().join("st");
            let events: Arc<Mutex<Vec<SyncEvent>>> = Arc::default();
            let ev = events.clone();
            World {
                client: Client::new(fake.clone()),
                fake,
                registry,
                policy: PolicyStore::load(&home),
                appdata: AppDataStore::load(&home),
                writer: ConfigWriter::new(),
                events,
                sink: Box::new(move |e| ev.lock().unwrap().push(e)),
                started: Instant::now(),
                dir,
            }
        }

        pub fn ctx(&self, now: Now) -> Ctx<'_> {
            Ctx {
                c: &self.client,
                me: ME,
                registry: &self.registry,
                policy: &self.policy,
                appdata: &self.appdata,
                writer: &self.writer,
                emit: &*self.sink,
                now,
                started: self.started,
            }
        }

        /// A shared class whose folder exists in the fake with `[me] + devices`.
        pub fn shared_class(&self, id: &str, devices: &[&str]) {
            let root = self.dir.path().join(id);
            std::fs::create_dir_all(root.join(".tramado/members")).unwrap();
            let mut e = ClassEntry::new(id, root);
            e.shared = true;
            self.registry.insert(e).unwrap();
            let mut all = vec![ME];
            all.extend_from_slice(devices);
            self.fake.add_folder(id, &all);
            for d in devices {
                self.fake.add_device(d);
            }
        }

        pub fn push(&self, p: ClassPolicy) {
            self.policy.set(p).unwrap();
        }

        pub fn take_events(&self) -> Vec<SyncEvent> {
            std::mem::take(&mut self.events.lock().unwrap())
        }
    }
}
