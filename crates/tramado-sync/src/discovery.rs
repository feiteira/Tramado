// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Connectivity (sync spec §11). Syncthing negative-caches "device unknown" answers from global
//! discovery for 35–40 minutes, so Tramado looks disconnected peers up itself and gives
//! Syncthing concrete addresses (§11.1); and it picks its own addresses for member files and
//! invites (§11.2).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::net::IpAddr;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::client::folder_devices;
use crate::ctx::Ctx;

pub const LOOKUP_URL: &str = "https://discovery-lookup.syncthing.net/v2/";
const GRACE: Duration = Duration::from_secs(30);
const AFTER_FOUND: Duration = Duration::from_secs(300);
const MIN_RETRY: Duration = Duration::from_secs(300);
const MAX_RETRY: Duration = Duration::from_secs(3600);

/// The answer of one lookup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Lookup {
    Found(Vec<String>),
    /// 404 with `retry-after` seconds (when given)
    Unknown(Option<u64>),
    Failed,
}

pub trait Lookuper: Send + Sync {
    fn lookup(&self, device: &str) -> Lookup;
}

/// The real lookup against Syncthing's public discovery server.
pub struct HttpLookup {
    agent: ureq::Agent,
    base: String,
}

impl HttpLookup {
    pub fn new(version: &str, base: &str) -> Self {
        HttpLookup {
            agent: tramado_net::http::lookup_agent(version),
            base: base.to_string(),
        }
    }
}

impl Lookuper for HttpLookup {
    fn lookup(&self, device: &str) -> Lookup {
        let url = format!("{}?device={}", self.base, crate::client::enc(device));
        let Ok(mut r) = self.agent.get(&url).call() else {
            return Lookup::Failed;
        };
        match r.status().as_u16() {
            200 => {
                let v: Value = r
                    .body_mut()
                    .with_config()
                    .limit(1 << 20)
                    .read_json()
                    .unwrap_or(Value::Null);
                Lookup::Found(
                    v["addresses"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|a| a.as_str().map(str::to_string))
                        .collect(),
                )
            }
            404 => Lookup::Unknown(
                r.headers()
                    .get("retry-after")
                    .and_then(|h| h.to_str().ok())
                    .and_then(|s| s.trim().parse().ok()),
            ),
            _ => Lookup::Failed,
        }
    }
}

#[derive(Default)]
pub struct Discovery {
    pub last_connected: HashMap<String, Instant>,
    pub next_lookup: HashMap<String, Instant>,
    /// device → addresses found by the last successful lookup (used by reconciliation too)
    pub discovered: BTreeMap<String, Vec<String>>,
}

fn dedupe(v: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    v.into_iter().filter(|a| seen.insert(a.clone())).collect()
}

impl Discovery {
    /// §11.1 phase 1 (under the lock, no network): notes connected peers and returns the
    /// disconnected ones whose lookup is due. Each returned device is not due again for 5 min
    /// unless [`record`](Self::record) says otherwise.
    pub fn due(&mut self, ctx: &Ctx, started: Instant, off: bool) -> Vec<String> {
        let now = ctx.now.mono;
        let Ok(folders) = ctx.c.folders() else {
            return Vec::new();
        };
        let peers: BTreeSet<String> = folders
            .iter()
            .filter(|f| f["id"].as_str().is_some_and(|i| i.starts_with("tramado-")))
            .flat_map(folder_devices)
            .filter(|d| d != ctx.me)
            .collect();
        let conns = ctx.c.connections().unwrap_or(Value::Null);
        let mut out = Vec::new();
        for d in peers {
            if conns[&d]["connected"].as_bool().unwrap_or(false) {
                self.last_connected.insert(d.clone(), now);
                continue;
            }
            let since = self
                .last_connected
                .get(&d)
                .copied()
                .map_or(started, |t| t.max(started));
            if now.saturating_duration_since(since) < GRACE || off {
                continue;
            }
            if self.next_lookup.get(&d).is_some_and(|t| now < *t) {
                continue;
            }
            self.next_lookup.insert(d.clone(), now + AFTER_FOUND);
            out.push(d);
        }
        out
    }

    /// §11.1 phase 2: applies one lookup's answer (PATCH of the addresses on success).
    pub fn record(
        &mut self,
        ctx: &Ctx,
        d: &str,
        answer: Lookup,
        member_addrs: &dyn Fn(&str) -> Vec<String>,
    ) {
        let now = ctx.now.mono;
        match answer {
            Lookup::Found(addrs) => {
                let all = dedupe(
                    addrs
                        .iter()
                        .cloned()
                        .chain(member_addrs(d))
                        .chain(std::iter::once("dynamic".to_string())),
                );
                let _ = ctx
                    .writer
                    .run(|| ctx.c.patch_device(d, &json!({ "addresses": all })));
                self.discovered.insert(d.to_string(), addrs);
                self.next_lookup.insert(d.to_string(), now + AFTER_FOUND);
            }
            Lookup::Unknown(retry) => {
                let wait = Duration::from_secs(retry.unwrap_or(300)).clamp(MIN_RETRY, MAX_RETRY);
                self.next_lookup.insert(d.to_string(), now + wait);
            }
            Lookup::Failed => {
                self.next_lookup.insert(d.to_string(), now + AFTER_FOUND);
            }
        }
    }

    /// Both phases in one call (tests; the engine runs the lookups without holding its lock).
    pub fn tick(
        &mut self,
        ctx: &Ctx,
        started: Instant,
        off: bool,
        lookuper: &dyn Lookuper,
        member_addrs: &dyn Fn(&str) -> Vec<String>,
    ) {
        for d in self.due(ctx, started, off) {
            let answer = lookuper.lookup(&d);
            self.record(ctx, &d, answer, member_addrs);
        }
    }
}

fn host_of(addr: &str) -> Option<(String, String, u16)> {
    let (scheme, rest) = addr.split_once("://")?;
    let hp = rest.split(['/', '?']).next()?;
    let (host, port) = hp.rsplit_once(':')?;
    Some((
        scheme.to_string(),
        host.trim_matches(['[', ']']).to_string(),
        port.parse().ok()?,
    ))
}

fn is_lan(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private(),
        IpAddr::V6(v) => (v.segments()[0] & 0xfe00) == 0xfc00, // ULA fc00::/7
    }
}

fn dropped(ip: &IpAddr, keep_loopback: bool) -> bool {
    match ip {
        IpAddr::V4(v) => {
            v.is_unspecified() || (v.is_loopback() && !keep_loopback) || v.is_link_local()
        }
        IpAddr::V6(v) => {
            v.is_unspecified()
                || (v.is_loopback() && !keep_loopback)
                || (v.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// §11.2 from `GET /rest/system/status`: listener addresses without errors, filtered and
/// ordered LAN tcp, relay, public tcp, LAN quic, public quic; at most 8.
pub fn own_addresses(status: &Value, keep_loopback: bool) -> Vec<String> {
    let mut buckets: [Vec<String>; 5] = Default::default();
    if let Some(m) = status["connectionServiceStatus"].as_object() {
        for st in m.values() {
            if !st["error"].is_null() {
                continue;
            }
            let addrs = st["lanAddresses"]
                .as_array()
                .into_iter()
                .flatten()
                .chain(st["wanAddresses"].as_array().into_iter().flatten())
                .filter_map(Value::as_str);
            for a in addrs {
                let Some((scheme, host, port)) = host_of(a) else {
                    continue;
                };
                if port == 0 {
                    continue;
                }
                let ip: Option<IpAddr> = host.parse().ok();
                if let Some(ip) = ip {
                    if dropped(&ip, keep_loopback) {
                        continue;
                    }
                }
                let lan = ip.as_ref().is_some_and(|i| is_lan(i) || i.is_loopback());
                let b = match (scheme.as_str(), lan) {
                    ("tcp", true) => 0,
                    ("relay", _) => 1,
                    ("tcp", false) => 2,
                    ("quic", true) => 3,
                    ("quic", false) => 4,
                    _ => continue,
                };
                buckets[b].push(a.to_string());
            }
        }
    }
    let mut out = dedupe(buckets.into_iter().flatten());
    out.truncate(8);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::testing::World;
    use crate::ctx::Now;
    use crate::invite::tests::D1;
    use std::sync::Mutex;

    struct Fixed(Mutex<Vec<String>>, Lookup);
    impl Lookuper for Fixed {
        fn lookup(&self, d: &str) -> Lookup {
            self.0.lock().unwrap().push(d.to_string());
            self.1.clone()
        }
    }

    #[test]
    fn own_addresses_are_filtered_and_ordered() {
        let st = json!({"connectionServiceStatus": {
            "tcp://0.0.0.0:22117": {"error": null, "lanAddresses": ["tcp://0.0.0.0:22117", "tcp://192.168.1.20:22117", "tcp://127.0.0.1:22117", "tcp://169.254.1.1:22117"],
                                     "wanAddresses": ["tcp://85.243.10.7:22117", "tcp://85.243.10.7:0"]},
            "quic://0.0.0.0:22117": {"error": null, "lanAddresses": ["quic://192.168.1.20:22117", "quic://[fe80::1]:22117"], "wanAddresses": ["quic://85.243.10.7:22117"]},
            "dynamic+https://relays.syncthing.net/endpoint": {"error": null, "lanAddresses": ["relay://95.216.157.10:22067/?id=NZRTFEN"], "wanAddresses": ["relay://95.216.157.10:22067/?id=NZRTFEN"]},
            "tcp://0.0.0.0:22999": {"error": "listen tcp: address already in use", "lanAddresses": ["tcp://192.168.1.20:22999"], "wanAddresses": []}
        }});
        assert_eq!(
            own_addresses(&st, false),
            vec![
                "tcp://192.168.1.20:22117",
                "relay://95.216.157.10:22067/?id=NZRTFEN",
                "tcp://85.243.10.7:22117",
                "quic://192.168.1.20:22117",
                "quic://85.243.10.7:22117"
            ]
        );
        assert!(own_addresses(&st, true).contains(&"tcp://127.0.0.1:22117".to_string()));
    }

    #[test]
    fn lookups_wait_30_s_then_inject_and_honour_retry_after() {
        let w = World::new();
        w.shared_class("tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa", &[D1]);
        let now = Now::current();
        let found = Fixed(
            Mutex::default(),
            Lookup::Found(vec!["relay://1.2.3.4:22067/?id=X".into()]),
        );
        let mut d = Discovery::default();
        let addrs = |_: &str| vec!["tcp://10.0.0.9:22100".to_string()];
        d.tick(&w.ctx(now), now.mono, false, &found, &addrs);
        assert!(found.0.lock().unwrap().is_empty(), "not before 30 s");
        let t1 = now.plus(GRACE);
        d.tick(&w.ctx(t1), now.mono, true, &found, &addrs);
        assert!(
            found.0.lock().unwrap().is_empty(),
            "never when local-only or paused"
        );
        d.tick(&w.ctx(t1), now.mono, false, &found, &addrs);
        assert_eq!(found.0.lock().unwrap().len(), 1);
        assert_eq!(
            w.fake.device(D1).unwrap()["addresses"],
            json!([
                "relay://1.2.3.4:22067/?id=X",
                "tcp://10.0.0.9:22100",
                "dynamic"
            ])
        );
        d.tick(
            &w.ctx(t1.plus(Duration::from_secs(10))),
            now.mono,
            false,
            &found,
            &addrs,
        );
        assert_eq!(found.0.lock().unwrap().len(), 1, "next lookup after 5 min");
        let unknown = Fixed(Mutex::default(), Lookup::Unknown(Some(2016)));
        let mut d = Discovery::default();
        d.tick(&w.ctx(t1), now.mono, false, &unknown, &addrs);
        assert_eq!(d.next_lookup[D1], t1.mono + Duration::from_secs(2016));
        // a connected device is never looked up
        w.fake.connect(D1);
        let mut d = Discovery::default();
        d.tick(&w.ctx(t1), now.mono, false, &unknown, &addrs);
        assert_eq!(unknown.0.lock().unwrap().len(), 1);
    }
}
