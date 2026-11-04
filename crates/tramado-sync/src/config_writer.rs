// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

//! The one config writer (sync spec §3.3). Syncthing replaces whole arrays (`PATCH` of a
//! folder's `devices`, `POST` of an existing folder or device), so every mutation is a
//! read-modify-write that must not interleave with another. All of them run inside
//! [`ConfigWriter::run`], one at a time; a mutation may call another (the lock is re-entrant
//! for the thread that holds it), so composite operations (a join, a reconciliation followed
//! by `apply_bans`) stay atomic with respect to the others.
//!
//! This is the queue of the spec in the form of a lock: callers block until their turn and get
//! their result directly, which is what the commands need.

use std::sync::{Condvar, Mutex};
use std::thread::ThreadId;

#[derive(Default)]
struct Owner {
    thread: Option<ThreadId>,
    depth: usize,
}

#[derive(Default)]
pub struct ConfigWriter {
    owner: Mutex<Owner>,
    free: Condvar,
}

struct Release<'a>(&'a ConfigWriter);

impl Drop for Release<'_> {
    fn drop(&mut self) {
        let mut o = self.0.owner.lock().unwrap_or_else(|e| e.into_inner());
        o.depth = o.depth.saturating_sub(1);
        if o.depth == 0 {
            o.thread = None;
            self.0.free.notify_one();
        }
    }
}

impl ConfigWriter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Runs `f` as the only config mutation in progress.
    pub fn run<T>(&self, f: impl FnOnce() -> T) -> T {
        let me = std::thread::current().id();
        {
            let mut o = self.owner.lock().unwrap_or_else(|e| e.into_inner());
            while o.thread.is_some_and(|t| t != me) {
                o = self.free.wait(o).unwrap_or_else(|e| e.into_inner());
            }
            o.thread = Some(me);
            o.depth += 1;
        }
        let _release = Release(self);
        f()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn serialises_and_allows_nesting() {
        let w = Arc::new(ConfigWriter::new());
        assert_eq!(w.run(|| w.run(|| 7)), 7);
        let inside = Arc::new(AtomicUsize::new(0));
        let max = Arc::new(AtomicUsize::new(0));
        let hs: Vec<_> = (0..4)
            .map(|_| {
                let (w, inside, max) = (w.clone(), inside.clone(), max.clone());
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        w.run(|| {
                            let n = inside.fetch_add(1, Ordering::SeqCst) + 1;
                            max.fetch_max(n, Ordering::SeqCst);
                            std::thread::yield_now();
                            inside.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        assert_eq!(max.load(Ordering::SeqCst), 1);
    }
}
