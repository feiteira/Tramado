// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! Scan after every write (sync spec §3.4) and the other background work of the engine.
//!
//! The `WriteObserver` registered on `ClassFs` records each own change for the mass-change guard
//! and queues `POST /rest/db/scan?folder=&sub=` for shared classes. One worker thread
//! (`tramado-sync-work`) runs the queue; a task already waiting is not queued twice, so per
//! sub-path at most one scan is in flight and one follow-up is queued.

use std::collections::{HashSet, VecDeque};
use std::sync::{Condvar, Mutex, Weak};
use std::time::{Duration, Instant};

use tramado_base::classfs::{WriteKind, WriteObserver};

use crate::engine::Inner;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Task {
    Scan {
        class: String,
        sub: Option<String>,
    },
    /// Re-POST a class's ignores (its registry inputs changed).
    Ignores(String),
    /// Re-apply this device's name (a class started or stopped joining).
    DeviceName,
    /// Try `finish_leaving` now.
    Leave(String),
    /// Reconcile a class (and apply bans).
    Reconcile(String),
}

#[derive(Default)]
pub struct WorkQueue {
    q: Mutex<(VecDeque<Task>, HashSet<Task>)>,
    cv: Condvar,
}

impl WorkQueue {
    pub fn push(&self, t: Task) {
        let mut g = self.q.lock().unwrap_or_else(|e| e.into_inner());
        if g.1.insert(t.clone()) {
            g.0.push_back(t);
            self.cv.notify_one();
        }
    }

    /// The next task, waiting at most `wait`.
    pub fn pop(&self, wait: Duration) -> Option<Task> {
        let deadline = Instant::now() + wait;
        let mut g = self.q.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(t) = g.0.pop_front() {
                g.1.remove(&t);
                return Some(t);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            g = self
                .cv
                .wait_timeout(g, left)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    pub fn len(&self) -> usize {
        self.q.lock().unwrap_or_else(|e| e.into_inner()).0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// The `WriteObserver` of `ClassFs` (architecture §5.1): scans and the own-change log.
pub struct ScanObserver {
    pub(crate) inner: Weak<Inner>,
}

impl WriteObserver for ScanObserver {
    fn wrote(&self, class_id: &str, path: &str, kind: &WriteKind) {
        let Some(inner) = self.inner.upgrade() else {
            return;
        };
        let now = Instant::now();
        {
            let mut g = inner.guard.lock().unwrap_or_else(|e| e.into_inner());
            g.note_own(class_id, path, matches!(kind, WriteKind::Remove), now);
            if let WriteKind::Move { from } = kind {
                g.note_own(class_id, from, true, now);
            }
        }
        let shared = inner
            .cfg
            .registry
            .get(class_id)
            .is_some_and(|e| e.shared && e.class_id == class_id);
        if !shared {
            return;
        }
        inner.work.push(Task::Scan {
            class: class_id.to_string(),
            sub: Some(path.to_string()),
        });
        if let WriteKind::Move { from } = kind {
            inner.work.push(Task::Scan {
                class: class_id.to_string(),
                sub: Some(from.clone()),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesces_waiting_tasks() {
        let q = WorkQueue::default();
        let t = Task::Scan {
            class: "c".into(),
            sub: Some("a".into()),
        };
        q.push(t.clone());
        q.push(t.clone());
        q.push(Task::DeviceName);
        assert_eq!(q.len(), 2);
        assert_eq!(q.pop(Duration::ZERO), Some(t.clone()));
        // in flight: one follow-up may queue
        q.push(t.clone());
        q.push(t.clone());
        assert_eq!(q.len(), 2);
        assert_eq!(q.pop(Duration::ZERO), Some(Task::DeviceName));
        assert_eq!(q.pop(Duration::ZERO), Some(t));
        assert_eq!(q.pop(Duration::from_millis(10)), None);
    }
}
