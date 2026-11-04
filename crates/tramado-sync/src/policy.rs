// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! `PolicyStore`: `data/syncthing/policy.json`
//! `{"format":"tramado.sync-policy","version":1,"global":…,"classes":{id: ClassPolicy}}`
//! (architecture §5.3, D-1). The app pushes a class's policy; Rust persists it and runs
//! admission and reconciliation from the last one even while the webview reloads. Which
//! classes received a policy **this session** is kept in memory only (the start-up rule of
//! sync spec §9.2).

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tramado_base::error::AppResult;
use tramado_base::files;

use crate::types::{ClassPolicy, GlobalPolicy};

pub const FILE_NAME: &str = "policy.json";
pub const FORMAT: &str = "tramado.sync-policy";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PolicyFile {
    #[serde(default)]
    pub global: GlobalPolicy,
    #[serde(default)]
    pub classes: BTreeMap<String, ClassPolicy>,
}

#[derive(Serialize, Deserialize)]
struct OnDisk {
    format: String,
    version: u32,
    #[serde(flatten)]
    file: PolicyFile,
}

pub struct PolicyStore {
    path: PathBuf,
    data: Mutex<PolicyFile>,
    received: Mutex<HashSet<String>>,
}

impl PolicyStore {
    pub fn load(home: &Path) -> Self {
        let path = home.join(FILE_NAME);
        let data = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<OnDisk>(&b).ok())
            .map(|d| d.file)
            .unwrap_or_default();
        PolicyStore {
            path,
            data: Mutex::new(data),
            received: Mutex::new(HashSet::new()),
        }
    }

    fn save(&self, f: &PolicyFile) -> AppResult<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let d = OnDisk {
            format: FORMAT.to_string(),
            version: 1,
            file: f.clone(),
        };
        files::write_atomic(&self.path, &serde_json::to_vec_pretty(&d)?)
    }

    /// Persists the policy and marks it as received this session.
    pub fn set(&self, p: ClassPolicy) -> AppResult<()> {
        let id = p.class_id.clone();
        {
            let mut g = self.data.lock().unwrap_or_else(|e| e.into_inner());
            if g.classes.get(&id) != Some(&p) {
                g.classes.insert(id.clone(), p);
                self.save(&g)?;
            }
        }
        self.received
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id);
        Ok(())
    }

    pub fn get(&self, class: &str) -> Option<ClassPolicy> {
        self.data
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .classes
            .get(class)
            .cloned()
    }

    pub fn all(&self) -> BTreeMap<String, ClassPolicy> {
        self.data
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .classes
            .clone()
    }

    pub fn global(&self) -> GlobalPolicy {
        self.data
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .global
            .clone()
    }

    /// Forgets a class (left, cancelled join, forgotten).
    pub fn remove(&self, class: &str) -> AppResult<()> {
        let mut g = self.data.lock().unwrap_or_else(|e| e.into_inner());
        if g.classes.remove(class).is_some() {
            self.save(&g)?;
        }
        self.received
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(class);
        Ok(())
    }

    /// Pushed by the app in this session (the start-up rule of sync spec §9.2).
    pub fn received(&self, class: &str) -> bool {
        self.received
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(class)
    }

    /// For tests and for a restart of the session.
    pub fn mark_received(&self, class: &str) {
        self.received
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(class.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn policy(id: &str) -> ClassPolicy {
        ClassPolicy {
            class_id: id.to_string(),
            label: "TGDC".into(),
            ask_before_admit: false,
            roster: vec![],
            known_devices: vec![],
            banned_devices: vec![],
            updated_at: "2026-11-04T10:00:00.000Z".into(),
        }
    }

    #[test]
    fn persisted_policy_is_not_received_after_reload() {
        let dir = tempfile::tempdir().unwrap();
        let s = PolicyStore::load(dir.path());
        let id = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";
        s.set(policy(id)).unwrap();
        assert!(s.received(id));
        let again = PolicyStore::load(dir.path());
        assert_eq!(again.get(id), Some(policy(id)));
        assert!(!again.received(id));
        again.remove(id).unwrap();
        assert!(PolicyStore::load(dir.path()).get(id).is_none());
        let text = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(text.contains("tramado.sync-policy"));
    }
}
