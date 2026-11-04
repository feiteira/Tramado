// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
// Derived from Trama (desktop/src-tauri/src/service/hosts.rs), MPL-2.0, same author.

//! Hosts the AI pipe may reach (architecture §5.2 `hosts`): OpenRouter, built in, and custom
//! OpenAI-compatible hosts the person allowed through a native confirmation the shell showed
//! itself (`ai_host_allow`). The list lives in `config/service-hosts.json`, next to the
//! preferences and never in a class folder: `{"hosts":[{"id","base","label"}]}` (Trama kept
//! host names under the same `hosts` key; Tramado keeps the base URL too, because requests name
//! a host by its ID).

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tramado_base::error::{AppError, AppResult, Code};
use tramado_base::files;
use ureq::http::Uri;

pub const FILE_NAME: &str = "service-hosts.json";
/// Allowed without asking.
pub const BUILT_IN: &[&str] = &["openrouter.ai"];

/// A checked service address: the host (with its port, if any) and the base URL without a
/// trailing slash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub host: String,
    pub base: String,
}

fn bad_address(why: &str) -> AppError {
    AppError::new(Code::AiBadAddress, why.to_string())
}

impl Endpoint {
    /// `AI_BAD_ADDRESS` unless `base` is `https://…`, or `http://…` for this computer or the
    /// local network only; no user names, no query, no fragment.
    pub fn parse(base: &str) -> AppResult<Self> {
        let trimmed = base.trim();
        if trimmed.contains('#') {
            return Err(bad_address("no fragment in the address"));
        }
        let uri: Uri = trimmed.parse().map_err(|_| bad_address("not an address"))?;
        let https = match uri.scheme_str() {
            Some("https") => true,
            Some("http") => false,
            _ => return Err(bad_address("the address must start with https://")),
        };
        let authority = uri.authority().ok_or_else(|| bad_address("no host"))?;
        if authority.as_str().contains('@') {
            return Err(bad_address("no user names in the address"));
        }
        if uri.query().is_some() {
            return Err(bad_address("no query in the address"));
        }
        let name = authority
            .host()
            .trim_start_matches('[')
            .trim_end_matches(']');
        if name.is_empty() {
            return Err(bad_address("no host"));
        }
        // Plain http only where nothing crosses a network someone else runs.
        if !https && !is_local(name) {
            return Err(bad_address(
                "plain http only for this computer or the local network",
            ));
        }
        let host = match authority.port_u16() {
            Some(p) => format!("{}:{p}", authority.host().to_ascii_lowercase()),
            None => authority.host().to_ascii_lowercase(),
        };
        let path = uri.path().trim_end_matches('/');
        Ok(Endpoint {
            base: format!(
                "{}://{}{}",
                if https { "https" } else { "http" },
                host,
                path
            ),
            host,
        })
    }

    pub fn is_built_in(&self) -> bool {
        BUILT_IN.contains(&self.host.as_str())
    }

    pub fn is_openrouter(&self) -> bool {
        self.host == "openrouter.ai"
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    /// The host ID used in `AiBase::Host` and the secret name `host:<id>`: the host with `:`
    /// and `[]` replaced (`[A-Za-z0-9._-]`, ≤ 64).
    pub fn host_id(&self) -> String {
        let mut id: String = self
            .host
            .chars()
            .filter(|c| *c != '[' && *c != ']')
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        id.truncate(64);
        id
    }
}

/// This computer or a private network: loopback, private and link-local addresses, `.local`.
fn is_local(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    if name == "localhost" || name.ends_with(".localhost") || name.ends_with(".local") {
        return true;
    }
    match name.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => {
            ip.is_loopback()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
        Err(_) => false,
    }
}

/// TS `AiHost`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHost {
    pub id: String,
    pub base: String,
    pub label: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HostsFile {
    #[serde(default)]
    hosts: Vec<serde_json::Value>,
}

pub struct HostList {
    file: PathBuf,
    hosts: Mutex<Vec<AiHost>>,
}

/// A refusal before anything is sent: a host nobody allowed.
pub fn not_allowed(what: &str) -> AppError {
    AppError::new(
        Code::AiHostNotAllowed,
        format!("{what} is not an allowed AI host"),
    )
}

impl HostList {
    /// A missing or unreadable file allows nothing beyond the built-in hosts. Entries that do
    /// not parse as an allowed address (hand edits, Trama's bare host names) are dropped.
    pub fn load(config_dir: &Path) -> Self {
        let file = config_dir.join(FILE_NAME);
        let raw = std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice::<HostsFile>(&b).ok())
            .unwrap_or_default();
        let mut hosts: Vec<AiHost> = Vec::new();
        for v in raw.hosts {
            let Ok(h) = serde_json::from_value::<AiHost>(v) else {
                continue;
            };
            let Ok(e) = Endpoint::parse(&h.base) else {
                continue;
            };
            if e.is_built_in() || hosts.iter().any(|x| x.id == e.host_id()) {
                continue;
            }
            hosts.push(AiHost {
                id: e.host_id(),
                base: e.base,
                label: h.label,
            });
        }
        HostList {
            file,
            hosts: Mutex::new(hosts),
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<AiHost>> {
        self.hosts.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The custom hosts (the built-in OpenRouter is not listed).
    pub fn list(&self) -> Vec<AiHost> {
        self.lock().clone()
    }

    pub fn get(&self, host_id: &str) -> Option<AiHost> {
        self.lock().iter().find(|h| h.id == host_id).cloned()
    }

    /// The custom host for an endpoint, if allowed.
    pub fn find(&self, e: &Endpoint) -> Option<AiHost> {
        self.get(&e.host_id())
    }

    /// Allows `endpoint` (one entry per host: allowing it again updates its base).
    pub fn add(&self, endpoint: &Endpoint, label: &str) -> AppResult<AiHost> {
        if endpoint.is_built_in() {
            return Err(AppError::invalid("OpenRouter is built in"));
        }
        let host = AiHost {
            id: endpoint.host_id(),
            base: endpoint.base.clone(),
            label: if label.trim().is_empty() {
                endpoint.host.clone()
            } else {
                label.trim().chars().take(80).collect()
            },
        };
        let mut hosts = self.lock();
        let mut next = hosts.clone();
        match next.iter_mut().find(|h| h.id == host.id) {
            Some(h) => *h = host.clone(),
            None => next.push(host.clone()),
        }
        self.save(&next)?;
        *hosts = next;
        Ok(host)
    }

    /// Stops allowing a host (no error when it was not allowed).
    pub fn remove(&self, host_id: &str) -> AppResult<()> {
        let mut hosts = self.lock();
        if !hosts.iter().any(|h| h.id == host_id) {
            return Ok(());
        }
        let next: Vec<AiHost> = hosts.iter().filter(|h| h.id != host_id).cloned().collect();
        self.save(&next)?;
        *hosts = next;
        Ok(())
    }

    fn save(&self, hosts: &[AiHost]) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(&serde_json::json!({ "hosts": hosts }))?;
        files::write_atomic(&self.file, &json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_service_addresses() {
        let e = Endpoint::parse("https://openrouter.ai/api/v1/").unwrap();
        assert_eq!(e.host, "openrouter.ai");
        assert_eq!(e.base, "https://openrouter.ai/api/v1");
        assert_eq!(
            e.url("/chat/completions"),
            "https://openrouter.ai/api/v1/chat/completions"
        );
        assert!(e.is_built_in() && e.is_openrouter());

        let local = Endpoint::parse("http://localhost:11434/v1").unwrap();
        assert_eq!(local.host, "localhost:11434");
        assert_eq!(local.host_id(), "localhost_11434");
        assert!(!local.is_built_in());
        assert!(Endpoint::parse("http://192.168.1.20:8000/v1").is_ok());
        assert_eq!(
            Endpoint::parse("http://[::1]:8000/v1").unwrap().host_id(),
            "__1_8000"
        );
        assert!(
            Endpoint::parse("https://Models.Example.org/v1")
                .unwrap()
                .host
                == "models.example.org"
        );
    }

    #[test]
    fn refuses_what_could_leak() {
        for bad in [
            "http://example.org/v1",
            "ftp://example.org",
            "https://user:pw@example.org/v1",
            "https://example.org/v1?key=1",
            "https://example.org/v1#x",
            "openrouter.ai",
            "",
        ] {
            let e = Endpoint::parse(bad).unwrap_err();
            assert_eq!(e.code(), Code::AiBadAddress, "{bad}");
        }
        // A look-alike is not the built-in host.
        assert!(!Endpoint::parse("https://openrouter.ai.example.org/v1")
            .unwrap()
            .is_built_in());
    }

    #[test]
    fn keeps_the_hosts_allowed_here() {
        let dir = tempfile::tempdir().unwrap();
        let hosts = HostList::load(dir.path());
        let mine = Endpoint::parse("https://models.example.org/v1").unwrap();
        assert!(hosts.find(&mine).is_none());
        let added = hosts.add(&mine, "").unwrap();
        assert_eq!(
            added,
            AiHost {
                id: "models.example.org".into(),
                base: "https://models.example.org/v1".into(),
                label: "models.example.org".into()
            }
        );
        // Allowing the same host again updates its base, keeps one entry.
        let moved = Endpoint::parse("https://models.example.org/v2").unwrap();
        hosts.add(&moved, "Lab server").unwrap();
        let again = HostList::load(dir.path());
        assert_eq!(again.list().len(), 1);
        assert_eq!(
            again.get("models.example.org").unwrap().base,
            "https://models.example.org/v2"
        );
        assert_eq!(again.get("models.example.org").unwrap().label, "Lab server");
        assert_eq!(
            hosts
                .add(
                    &Endpoint::parse("https://openrouter.ai/api/v1").unwrap(),
                    ""
                )
                .unwrap_err()
                .code(),
            Code::Invalid
        );
        hosts.remove("models.example.org").unwrap();
        hosts.remove("models.example.org").unwrap();
        assert!(HostList::load(dir.path()).list().is_empty());
        // Trama's bare host names and junk are dropped, not fatal.
        std::fs::write(
            dir.path().join(FILE_NAME),
            r#"{"hosts":["models.example.org",{"id":"x","base":"http://example.org/v1","label":"no"},{"id":"y","base":"http://localhost:8080/v1/","label":"Ollama"}]}"#,
        )
        .unwrap();
        let loaded = HostList::load(dir.path());
        assert_eq!(
            loaded.list(),
            vec![AiHost {
                id: "localhost_8080".into(),
                base: "http://localhost:8080/v1".into(),
                label: "Ollama".into()
            }]
        );
        std::fs::write(dir.path().join(FILE_NAME), "not json").unwrap();
        assert!(HostList::load(dir.path()).list().is_empty());
    }
}
