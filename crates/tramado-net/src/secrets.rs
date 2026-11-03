// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Secrets: the OpenRouter key, custom host keys and the internal person-key seed (architecture
//! §5.2 `secrets`). Keys never cross IPC outward: the webview can set a key, ask whether one is
//! set (with its last four characters) and clear it.
//!
//! **M0 implements the file backend** (`config/secrets.json`, mode 0600 on Unix):
//! `{"format":"tramado.secrets","version":1,"secrets":{name:value}}`. R-SHELL adds the OS keychain
//! (`keyring` 4.2.0, service `eu.thehumanloop.tramado`, user = name) and falls back to this file
//! when the keychain cannot be initialised, or when `file_only` (`TRAMADO_DATA_DIR` set).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult};
use tramado_base::files;

pub const FILE_NAME: &str = "secrets.json";
pub const FORMAT: &str = "tramado.secrets";
/// Keychain service name (R-SHELL).
pub const SERVICE: &str = "eu.thehumanloop.tramado";
/// The internal name of the person-key seed; refused over IPC.
pub const PERSON: &str = "person";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SecretStore {
    Keychain,
    File,
}

/// TS `SecretStatus` (`store: 'memory'` exists only in the demo).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub set: bool,
    pub last4: Option<String>,
    pub store: SecretStore,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    format: String,
    #[serde(default)]
    version: u32,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
}

pub struct Secrets {
    file: PathBuf,
    file_only: bool,
    lock: Mutex<()>,
}

/// `openrouter` or `host:<hostId>` (`[A-Za-z0-9._-]{1,64}`); `person` only when `internal`.
fn check_name(name: &str, internal: bool) -> AppResult<()> {
    if name == PERSON {
        return if internal {
            Ok(())
        } else {
            Err(AppError::invalid("this secret is not settable"))
        };
    }
    if name == "openrouter" {
        return Ok(());
    }
    let ok = name.strip_prefix("host:").is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 64
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    });
    if ok {
        Ok(())
    } else {
        Err(AppError::invalid("unknown secret name"))
    }
}

/// 1–400 characters, no whitespace.
fn check_value(value: &str) -> AppResult<()> {
    let n = value.chars().count();
    if n == 0 || n > 400 || value.chars().any(char::is_whitespace) {
        return Err(AppError::invalid(
            "a key is 1–400 characters without spaces",
        ));
    }
    Ok(())
}

fn last4(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

impl Secrets {
    pub fn new(config_dir: &Path, file_only: bool) -> Self {
        Secrets {
            file: config_dir.join(FILE_NAME),
            file_only,
            lock: Mutex::new(()),
        }
    }

    /// True when the keychain must not be used (`TRAMADO_DATA_DIR`).
    pub fn file_only(&self) -> bool {
        self.file_only
    }

    /// Where secrets are kept (M0: always the file).
    pub fn store(&self) -> SecretStore {
        SecretStore::File
    }

    fn load(&self) -> AppResult<SecretsFile> {
        match files::read_optional(&self.file)? {
            None => Ok(SecretsFile::default()),
            Some(b) => Ok(serde_json::from_slice(&b)?),
        }
    }

    fn save(&self, mut f: SecretsFile) -> AppResult<()> {
        f.format = FORMAT.to_string();
        f.version = 1;
        files::write_atomic_mode(&self.file, &serde_json::to_vec_pretty(&f)?, 0o600)
    }

    fn status_of(&self, value: Option<&String>) -> SecretStatus {
        SecretStatus {
            set: value.is_some(),
            last4: value.map(|v| last4(v.as_str())),
            store: self.store(),
        }
    }

    /// IPC `secret_set`: refuses `person`.
    pub fn set(&self, name: &str, value: &str) -> AppResult<SecretStatus> {
        check_name(name, false)?;
        check_value(value)?;
        self.put(name, value)?;
        Ok(self.status_of(Some(&value.to_string())))
    }

    /// IPC `secret_status`: refuses `person`.
    pub fn status(&self, name: &str) -> AppResult<SecretStatus> {
        check_name(name, false)?;
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let f = self.load()?;
        Ok(self.status_of(f.secrets.get(name)))
    }

    /// IPC `secret_clear`: refuses `person`.
    pub fn clear(&self, name: &str) -> AppResult<()> {
        check_name(name, false)?;
        self.remove(name)
    }

    /// The value, for this crate only (`ai`, `person`); never exposed to IPC.
    #[allow(dead_code)] // used by ai.rs and person.rs (R-SHELL)
    pub(crate) fn get(&self, name: &str) -> AppResult<Option<String>> {
        check_name(name, true)?;
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        Ok(self.load()?.secrets.get(name).cloned())
    }

    /// Stores any secret, `person` included (crate-internal).
    pub(crate) fn put(&self, name: &str, value: &str) -> AppResult<()> {
        check_name(name, true)?;
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut f = self.load()?;
        f.secrets.insert(name.to_string(), value.to_string());
        self.save(f)
    }

    pub(crate) fn remove(&self, name: &str) -> AppResult<()> {
        check_name(name, true)?;
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut f = self.load()?;
        if f.secrets.remove(name).is_some() {
            self.save(f)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tramado_base::error::Code;

    #[test]
    fn file_fallback_0600() {
        let dir = tempfile::tempdir().unwrap();
        let s = Secrets::new(dir.path(), true);
        assert!(s.file_only());
        let st = s.set("openrouter", "fake-key-for-tests-abcd").unwrap();
        assert_eq!(
            st,
            SecretStatus {
                set: true,
                last4: Some("abcd".into()),
                store: SecretStore::File
            }
        );
        let v: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(FILE_NAME)).unwrap()).unwrap();
        assert_eq!(v["format"], FORMAT);
        assert_eq!(v["version"], 1);
        assert_eq!(v["secrets"]["openrouter"], "fake-key-for-tests-abcd");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(FILE_NAME))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert_eq!(
            s.get("openrouter").unwrap().as_deref(),
            Some("fake-key-for-tests-abcd")
        );
    }

    #[test]
    fn status_last4() {
        let dir = tempfile::tempdir().unwrap();
        let s = Secrets::new(dir.path(), false);
        assert_eq!(
            s.status("openrouter").unwrap(),
            SecretStatus {
                set: false,
                last4: None,
                store: SecretStore::File
            }
        );
        s.set("host:h-1", "key-1234").unwrap();
        assert_eq!(s.status("host:h-1").unwrap().last4.as_deref(), Some("1234"));
        s.clear("host:h-1").unwrap();
        s.clear("host:h-1").unwrap();
        assert!(!s.status("host:h-1").unwrap().set);
        for bad in ["", "x y", &"k".repeat(401)] {
            assert_eq!(s.set("openrouter", bad).unwrap_err().code(), Code::Invalid);
        }
        for bad in ["OpenRouter", "host:", "host:a/b", "other"] {
            assert_eq!(s.status(bad).unwrap_err().code(), Code::Invalid, "{bad}");
        }
        let json = serde_json::to_value(s.status("openrouter").unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"set": false, "last4": null, "store": "file"})
        );
    }

    #[test]
    fn person_not_settable_over_ipc() {
        let dir = tempfile::tempdir().unwrap();
        let s = Secrets::new(dir.path(), true);
        assert_eq!(s.set(PERSON, "seed").unwrap_err().code(), Code::Invalid);
        assert_eq!(s.status(PERSON).unwrap_err().code(), Code::Invalid);
        assert_eq!(s.clear(PERSON).unwrap_err().code(), Code::Invalid);
        s.put(PERSON, "c2VlZA").unwrap();
        assert_eq!(s.get(PERSON).unwrap().as_deref(), Some("c2VlZA"));
        s.remove(PERSON).unwrap();
        assert_eq!(s.get(PERSON).unwrap(), None);
    }
}
