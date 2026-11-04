// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Secrets: the OpenRouter key, custom host keys and the internal person-key seed (architecture
//! §5.2 `secrets`, critique R13). Keys never cross IPC outward: the webview can set a key, ask
//! whether one is set (with its last four characters) and clear it.
//!
//! Store: the OS keychain through `keyring` 4.2.0 (service `eu.thehumanloop.tramado`, user =
//! the secret name). When the keychain cannot be initialised or does not answer (Linux without
//! a Secret Service, a locked or missing collection), or with `file_only` (`TRAMADO_DATA_DIR`
//! set), secrets go to `config/secrets.json` (mode 0600 on Unix):
//! `{"format":"tramado.secrets","version":1,"secrets":{name:value}}`. The choice is made once,
//! on first use, by a harmless lookup; it never fails. A value found in the file while the
//! keychain works (an earlier fallback) is still read, and moves to the keychain when set again.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult};
use tramado_base::files;

pub const FILE_NAME: &str = "secrets.json";
pub const FORMAT: &str = "tramado.secrets";
/// Keychain service name.
pub const SERVICE: &str = "eu.thehumanloop.tramado";
/// The internal name of the person-key seed; refused over IPC.
pub const PERSON: &str = "person";
/// The entry the first-use lookup asks for (never written).
const PROBE: &str = "tramado-probe";

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

/// A credential store (the OS keychain; tests use doubles). Errors are messages for the log.
pub trait KeyStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    fn delete(&self, name: &str) -> Result<(), String>;
}

/// The platform keychain (`keyring` v1 mode: Keychain Services, Credential Manager, Secret
/// Service).
struct NativeStore;

impl NativeStore {
    fn entry(name: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
    }
}

impl KeyStore for NativeStore {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        match Self::entry(name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        Self::entry(name)?
            .set_password(value)
            .map_err(|e| e.to_string())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        match Self::entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
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
    /// The keychain to try (None: file only).
    native: Option<Arc<dyn KeyStore>>,
    /// The keychain when it answered the first-use lookup.
    chosen: OnceLock<Option<Arc<dyn KeyStore>>>,
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
    /// `file_only` (`TRAMADO_DATA_DIR`) never touches the keychain.
    pub fn new(config_dir: &Path, file_only: bool) -> Self {
        let native: Option<Arc<dyn KeyStore>> = if file_only {
            None
        } else {
            Some(Arc::new(NativeStore))
        };
        Self::build(config_dir, file_only, native)
    }

    /// With another credential store in place of the OS keychain (tests of this and other
    /// crates; never used by the app).
    #[doc(hidden)]
    pub fn with_store(config_dir: &Path, store: Arc<dyn KeyStore>) -> Self {
        Self::build(config_dir, false, Some(store))
    }

    fn build(config_dir: &Path, file_only: bool, native: Option<Arc<dyn KeyStore>>) -> Self {
        Secrets {
            file: config_dir.join(FILE_NAME),
            file_only,
            lock: Mutex::new(()),
            native,
            chosen: OnceLock::new(),
        }
    }

    /// True when the keychain must not be used (`TRAMADO_DATA_DIR`).
    pub fn file_only(&self) -> bool {
        self.file_only
    }

    /// The keychain if it works, decided once by a lookup that writes nothing.
    fn keychain(&self) -> Option<&Arc<dyn KeyStore>> {
        self.chosen
            .get_or_init(|| {
                let store = self.native.clone()?;
                match store.get(PROBE) {
                    Ok(_) => Some(store),
                    Err(e) => {
                        log::warn!(
                            "the OS keychain is not available ({e}); keys are kept in {FILE_NAME} (0600)"
                        );
                        None
                    }
                }
            })
            .as_ref()
    }

    /// Where new secrets are kept.
    pub fn store(&self) -> SecretStore {
        if self.keychain().is_some() {
            SecretStore::Keychain
        } else {
            SecretStore::File
        }
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

    fn file_get(&self, name: &str) -> AppResult<Option<String>> {
        Ok(self.load()?.secrets.get(name).cloned())
    }

    fn file_put(&self, name: &str, value: &str) -> AppResult<()> {
        let mut f = self.load()?;
        f.secrets.insert(name.to_string(), value.to_string());
        self.save(f)
    }

    fn file_remove(&self, name: &str) -> AppResult<()> {
        let mut f = match self.load() {
            Ok(f) => f,
            // An unreadable file has nothing to remove; it is replaced on the next write.
            Err(_) if !self.file.exists() => return Ok(()),
            Err(e) => return Err(e),
        };
        if f.secrets.remove(name).is_some() {
            self.save(f)?;
        }
        Ok(())
    }

    /// The value and where it was found.
    fn lookup(&self, name: &str) -> AppResult<Option<(String, SecretStore)>> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(k) = self.keychain() {
            match k.get(name) {
                Ok(Some(v)) => return Ok(Some((v, SecretStore::Keychain))),
                Ok(None) => {}
                Err(e) => log::warn!("keychain lookup failed ({e}); trying {FILE_NAME}"),
            }
        }
        Ok(self.file_get(name)?.map(|v| (v, SecretStore::File)))
    }

    /// IPC `secret_set`: refuses `person`.
    pub fn set(&self, name: &str, value: &str) -> AppResult<SecretStatus> {
        check_name(name, false)?;
        check_value(value)?;
        let store = self.put_in(name, value)?;
        Ok(SecretStatus {
            set: true,
            last4: Some(last4(value)),
            store,
        })
    }

    /// IPC `secret_status`: refuses `person`.
    pub fn status(&self, name: &str) -> AppResult<SecretStatus> {
        check_name(name, false)?;
        Ok(match self.lookup(name)? {
            Some((v, store)) => SecretStatus {
                set: true,
                last4: Some(last4(&v)),
                store,
            },
            None => SecretStatus {
                set: false,
                last4: None,
                store: self.store(),
            },
        })
    }

    /// IPC `secret_clear`: refuses `person`.
    pub fn clear(&self, name: &str) -> AppResult<()> {
        check_name(name, false)?;
        self.remove(name)
    }

    /// The value, for Rust callers only (`ai`, `person`, `speech::remote`); never exposed to
    /// IPC.
    pub fn get(&self, name: &str) -> AppResult<Option<String>> {
        check_name(name, true)?;
        Ok(self.lookup(name)?.map(|(v, _)| v))
    }

    fn put_in(&self, name: &str, value: &str) -> AppResult<SecretStore> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(k) = self.keychain() {
            match k.set(name, value) {
                Ok(()) => {
                    self.file_remove(name)?;
                    return Ok(SecretStore::Keychain);
                }
                Err(e) => log::warn!("keychain write failed ({e}); keeping the key in {FILE_NAME}"),
            }
        }
        self.file_put(name, value)?;
        Ok(SecretStore::File)
    }

    /// Stores any secret, `person` included (crate-internal).
    pub(crate) fn put(&self, name: &str, value: &str) -> AppResult<()> {
        check_name(name, true)?;
        self.put_in(name, value).map(|_| ())
    }

    pub(crate) fn remove(&self, name: &str) -> AppResult<()> {
        check_name(name, true)?;
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(k) = self.keychain() {
            if let Err(e) = k.delete(name) {
                log::warn!("keychain delete failed ({e})");
            }
        }
        self.file_remove(name)
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
        let s = Secrets::new(dir.path(), true);
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

    #[derive(Default)]
    struct MemStore(Mutex<BTreeMap<String, String>>);
    impl KeyStore for MemStore {
        fn get(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().get(name).cloned())
        }
        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            self.0.lock().unwrap().insert(name.into(), value.into());
            Ok(())
        }
        fn delete(&self, name: &str) -> Result<(), String> {
            self.0.lock().unwrap().remove(name);
            Ok(())
        }
    }

    struct BrokenStore;
    impl KeyStore for BrokenStore {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            Err("org.freedesktop.DBus.Error.ServiceUnknown".into())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Err("no".into())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Err("no".into())
        }
    }

    #[test]
    fn keychain_when_it_answers() {
        let dir = tempfile::tempdir().unwrap();
        let mem = Arc::new(MemStore::default());
        // An older fallback copy in the file is still read…
        Secrets::new(dir.path(), true)
            .set("openrouter", "old-key-1111")
            .unwrap();
        let s = Secrets::with_store(dir.path(), mem.clone());
        assert_eq!(s.store(), SecretStore::Keychain);
        assert_eq!(
            s.status("openrouter").unwrap(),
            SecretStatus {
                set: true,
                last4: Some("1111".into()),
                store: SecretStore::File
            }
        );
        // …and moves to the keychain when set again.
        let st = s.set("openrouter", "new-key-2222").unwrap();
        assert_eq!(st.store, SecretStore::Keychain);
        assert_eq!(
            mem.0.lock().unwrap().get("openrouter").map(String::as_str),
            Some("new-key-2222")
        );
        let file: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(FILE_NAME)).unwrap()).unwrap();
        assert!(file["secrets"].get("openrouter").is_none(), "{file}");
        assert_eq!(
            s.get("openrouter").unwrap().as_deref(),
            Some("new-key-2222")
        );
        s.put(PERSON, "c2VlZA").unwrap();
        assert!(mem.0.lock().unwrap().contains_key(PERSON));
        s.clear("openrouter").unwrap();
        assert!(!s.status("openrouter").unwrap().set);
        assert!(
            !mem.0.lock().unwrap().contains_key(PROBE),
            "the probe writes nothing"
        );
    }

    #[test]
    fn falls_back_to_the_file_when_the_keychain_fails() {
        let dir = tempfile::tempdir().unwrap();
        let s = Secrets::with_store(dir.path(), Arc::new(BrokenStore));
        assert_eq!(s.store(), SecretStore::File);
        let st = s.set("host:localhost_11434", "k-9999").unwrap();
        assert_eq!(st.store, SecretStore::File);
        assert_eq!(
            s.get("host:localhost_11434").unwrap().as_deref(),
            Some("k-9999")
        );
        assert!(dir.path().join(FILE_NAME).is_file());
    }
}
