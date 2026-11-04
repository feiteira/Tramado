// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The mass-change guard (sync spec §22.2).
//!
//! **Local**: Tramado records every path it writes or deletes itself (the `WriteObserver`, kept
//! 30 s). More than 20 `LocalChangeDetected` deletions in 10 s that Tramado did not make (a file
//! manager emptied the folder, a backup tool rolled it back) pause the folder at once and emit
//! `massDelete`; `guardPaused` keeps it paused across restarts. Every folder also starts paused
//! (§2.4), so deletions made while the app was closed are caught the same way.
//! **Receiving**: more than 20 `RemoteChangeDetected` deletions with the same `modifiedBy` in
//! 10 s emit `massDeleteRemote`; the app decides whether a lecture or exam deletion it showed
//! explains them.
//!
//! Only deletions are counted: Syncthing's change events report a new file and a modified one
//! alike (`action: "modified"`), so "modifications of existing files" cannot be told apart from
//! new files without a second index (a known gap, reported).

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

pub const WINDOW: Duration = Duration::from_secs(10);
pub const THRESHOLD: usize = 20;
pub const OWN_LOG: Duration = Duration::from_secs(30);
pub const SAMPLE: usize = 10;

#[derive(Default)]
pub struct Guard {
    own: HashMap<String, VecDeque<(String, Instant)>>,
    local: HashMap<String, VecDeque<(Instant, String)>>,
    remote: HashMap<(String, String), VecDeque<(Instant, String)>>,
    tripped_local: HashSet<String>,
    tripped_remote: HashSet<(String, String)>,
}

/// What tripped: `(count, sample)`.
pub type Trip = (u64, Vec<String>);

fn prune<T>(q: &mut VecDeque<(Instant, T)>, now: Instant) {
    while q
        .front()
        .is_some_and(|(t, _)| now.saturating_duration_since(*t) > WINDOW)
    {
        q.pop_front();
    }
}

impl Guard {
    /// A write, append, move or removal Tramado made itself (from the `WriteObserver`).
    pub fn note_own(&mut self, class: &str, path: &str, now: Instant) {
        let q = self.own.entry(class.to_string()).or_default();
        while q
            .front()
            .is_some_and(|(_, t)| now.saturating_duration_since(*t) > OWN_LOG)
        {
            q.pop_front();
        }
        q.push_back((path.to_string(), now));
    }

    /// Tramado itself changed `path` (or a directory above it) within the last 30 s.
    pub fn is_own(&self, class: &str, path: &str, now: Instant) -> bool {
        self.own.get(class).is_some_and(|q| {
            q.iter().any(|(p, t)| {
                now.saturating_duration_since(*t) <= OWN_LOG
                    && (p == path
                        || path
                            .strip_prefix(p.as_str())
                            .is_some_and(|rest| rest.starts_with('/')))
            })
        })
    }

    /// A `LocalChangeDetected` (files only). Fires once when the threshold is crossed.
    pub fn local_change(
        &mut self,
        class: &str,
        path: &str,
        deleted: bool,
        now: Instant,
    ) -> Option<Trip> {
        if !deleted || self.is_own(class, path, now) {
            return None;
        }
        let q = self.local.entry(class.to_string()).or_default();
        prune(q, now);
        if q.is_empty() {
            self.tripped_local.remove(class);
        }
        q.push_back((now, path.to_string()));
        if q.len() > THRESHOLD && self.tripped_local.insert(class.to_string()) {
            let sample = q.iter().take(SAMPLE).map(|(_, p)| p.clone()).collect();
            return Some((q.len() as u64, sample));
        }
        None
    }

    /// A `RemoteChangeDetected` (files only) by `by`. Fires once when the threshold is crossed.
    pub fn remote_change(
        &mut self,
        class: &str,
        by: &str,
        path: &str,
        deleted: bool,
        now: Instant,
    ) -> Option<Trip> {
        if !deleted {
            return None;
        }
        let key = (class.to_string(), by.to_string());
        let q = self.remote.entry(key.clone()).or_default();
        prune(q, now);
        if q.is_empty() {
            self.tripped_remote.remove(&key);
        }
        q.push_back((now, path.to_string()));
        if q.len() > THRESHOLD && self.tripped_remote.insert(key) {
            let sample = q.iter().take(SAMPLE).map(|(_, p)| p.clone()).collect();
            return Some((q.len() as u64, sample));
        }
        None
    }

    /// After "Restore" or "Yes, delete for everyone".
    pub fn reset(&mut self, class: &str) {
        self.local.remove(class);
        self.tripped_local.remove(class);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const C: &str = "tramado-aaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn local_deletions_trip_once_above_twenty_in_ten_seconds() {
        let mut g = Guard::default();
        let t0 = Instant::now();
        for i in 0..THRESHOLD {
            assert!(g
                .local_change(C, &format!("Docs/{i}.pdf"), true, t0)
                .is_none());
        }
        let (n, sample) = g.local_change(C, "Docs/x.pdf", true, t0).unwrap();
        assert_eq!(n, 21);
        assert_eq!(sample.len(), SAMPLE);
        assert!(
            g.local_change(C, "Docs/y.pdf", true, t0).is_none(),
            "fires once"
        );
        // spread over more than 10 s: never trips
        let mut g = Guard::default();
        for i in 0..40 {
            let t = t0 + Duration::from_secs(i);
            assert!(g.local_change(C, &format!("{i}"), true, t).is_none());
        }
    }

    #[test]
    fn own_deletions_and_modifications_do_not_count() {
        let mut g = Guard::default();
        let t0 = Instant::now();
        g.note_own(C, "Aulas/Aula 3", t0);
        for i in 0..30 {
            assert!(g
                .local_change(C, &format!("Aulas/Aula 3/f{i}"), true, t0)
                .is_none());
            assert!(g.local_change(C, &format!("x{i}"), false, t0).is_none());
        }
        assert!(!g.is_own(C, "Aulas/Aula 30", t0));
        assert!(!g.is_own(C, "Aulas/Aula 3/f", t0 + OWN_LOG + Duration::from_secs(1)));
    }

    #[test]
    fn remote_deletions_are_counted_per_writer() {
        let mut g = Guard::default();
        let t0 = Instant::now();
        for i in 0..THRESHOLD {
            assert!(g
                .remote_change(C, "BBBBBBB", &format!("{i}"), true, t0)
                .is_none());
            assert!(g
                .remote_change(C, "CCCCCCC", &format!("{i}"), true, t0)
                .is_none());
        }
        assert!(g.remote_change(C, "BBBBBBB", "z", true, t0).is_some());
    }
}
