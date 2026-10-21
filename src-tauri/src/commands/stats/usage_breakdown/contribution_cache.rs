//! Per-file contribution cache (ADR 0002 §7).
//!
//! One [`FileContributions`] per (canonical path, stats mode), validated by
//! the file's `(size, mtime)` read **before** parsing — the rule of the
//! existing UTC-day cache (`stats/cache.rs`), which stays untouched: a
//! concurrent append can only make a stored entry look stale, never the
//! reverse. Memory is bounded by a byte budget (default 64 MiB) with
//! least-recently-used eviction. Claude files only; provider paths are
//! virtual and have no file identity.

use super::contribution::FileContributions;
use crate::commands::stats::StatsMode;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::SystemTime;

/// ADR 0002 §10 budget for the contribution cache.
pub(super) const DEFAULT_CAPACITY_BYTES: usize = 64 * 1024 * 1024;

type CacheKey = (PathBuf, u8);

struct CacheEntry {
    size: u64,
    mtime: Option<SystemTime>,
    data: Arc<FileContributions>,
    bytes: usize,
    last_used: u64,
}

#[derive(Default)]
struct CacheState {
    entries: HashMap<CacheKey, CacheEntry>,
    /// `last_used` tick → key, oldest first.
    lru: BTreeMap<u64, CacheKey>,
    tick: u64,
    bytes: usize,
}

impl CacheState {
    fn remove(&mut self, key: &CacheKey) {
        if let Some(entry) = self.entries.remove(key) {
            self.lru.remove(&entry.last_used);
            self.bytes -= entry.bytes;
        }
    }

    fn next_tick(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }
}

/// Snapshot of the cache's size, for the budget measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CacheUsage {
    pub entries: usize,
    pub bytes: usize,
}

pub(super) struct ContributionCache {
    capacity_bytes: usize,
    state: Mutex<CacheState>,
}

fn mode_slot(mode: StatsMode) -> u8 {
    match mode {
        StatsMode::BillingTotal => 0,
        StatsMode::ConversationOnly => 1,
    }
}

static CACHE: OnceLock<ContributionCache> = OnceLock::new();

/// The process-wide cache used by `get_usage_breakdown`.
pub(super) fn contribution_cache() -> &'static ContributionCache {
    CACHE.get_or_init(|| ContributionCache::new(DEFAULT_CAPACITY_BYTES))
}

impl ContributionCache {
    pub fn new(capacity_bytes: usize) -> Self {
        Self {
            capacity_bytes,
            state: Mutex::new(CacheState::default()),
        }
    }

    /// The cached contributions of `path`, rebuilt with `load` when missing or
    /// when the file's `(size, mtime)` changed. Load errors are not cached.
    pub fn get_or_load<F>(
        &self,
        path: &Path,
        mode: StatsMode,
        load: F,
    ) -> Result<Arc<FileContributions>, String>
    where
        F: FnOnce() -> Result<FileContributions, String>,
    {
        // Files that cannot be resolved or stat'ed are computed uncached; the
        // loader reports the failure. A symlink is never answered with its
        // target's entry: the loader refuses it.
        let Ok(metadata) = fs::symlink_metadata(path) else {
            return load().map(Arc::new);
        };
        if metadata.file_type().is_symlink() {
            return load().map(Arc::new);
        }
        let Ok(canonical) = fs::canonicalize(path) else {
            return load().map(Arc::new);
        };
        let size = metadata.len();
        let mtime = metadata.modified().ok();
        let key = (canonical, mode_slot(mode));

        {
            let mut state = self.lock();
            let tick = state.next_tick();
            if let Some(entry) = state.entries.get_mut(&key) {
                if entry.size == size && entry.mtime == mtime {
                    let previous = std::mem::replace(&mut entry.last_used, tick);
                    let data = Arc::clone(&entry.data);
                    state.lru.remove(&previous);
                    state.lru.insert(tick, key);
                    return Ok(data);
                }
            }
        }

        let data = Arc::new(load()?);
        let bytes = data.approx_bytes();
        let mut state = self.lock();
        state.remove(&key);
        if bytes <= self.capacity_bytes {
            let tick = state.next_tick();
            state.lru.insert(tick, key.clone());
            state.bytes += bytes;
            state.entries.insert(
                key,
                CacheEntry {
                    size,
                    mtime,
                    data: Arc::clone(&data),
                    bytes,
                    last_used: tick,
                },
            );
            while state.bytes > self.capacity_bytes {
                let Some((_, oldest)) = state.lru.pop_first() else {
                    break;
                };
                if let Some(evicted) = state.entries.remove(&oldest) {
                    state.bytes -= evicted.bytes;
                }
            }
        }
        Ok(data)
    }

    pub fn usage(&self) -> CacheUsage {
        let state = self.lock();
        CacheUsage {
            entries: state.entries.len(),
            bytes: state.bytes,
        }
    }

    /// Drop every entry (the perf measurement's cold start).
    #[cfg(test)]
    pub fn clear(&self) {
        *self.lock() = CacheState::default();
    }

    /// Recover from a poisoned lock: a panic in one parse must not disable
    /// the breakdown for the rest of the process.
    fn lock(&self) -> MutexGuard<'_, CacheState> {
        match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::time::Duration;
    use tempfile::TempDir;

    fn file_with(bytes: usize) -> FileContributions {
        FileContributions {
            title: Some("x".repeat(bytes)),
            ..FileContributions::default()
        }
    }

    fn entry_bytes(bytes: usize) -> usize {
        file_with(bytes).approx_bytes()
    }

    fn write(dir: &TempDir, name: &str, body: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, body).unwrap();
        path
    }

    fn load_counting(
        loads: &Cell<u32>,
        bytes: usize,
    ) -> impl FnOnce() -> Result<FileContributions, String> + '_ {
        move || {
            loads.set(loads.get() + 1);
            Ok(file_with(bytes))
        }
    }

    #[test]
    fn unchanged_file_is_served_from_cache() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "a.jsonl", "{}\n");
        let cache = ContributionCache::new(1 << 20);
        let loads = Cell::new(0);
        cache
            .get_or_load(&path, StatsMode::BillingTotal, load_counting(&loads, 1))
            .unwrap();
        cache
            .get_or_load(&path, StatsMode::BillingTotal, load_counting(&loads, 1))
            .unwrap();
        assert_eq!(loads.get(), 1);
        // The other stats mode is its own entry.
        cache
            .get_or_load(&path, StatsMode::ConversationOnly, load_counting(&loads, 1))
            .unwrap();
        assert_eq!(loads.get(), 2);
        assert_eq!(cache.usage().entries, 2);
    }

    #[test]
    fn a_size_change_invalidates_the_entry() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "a.jsonl", "{}\n");
        let cache = ContributionCache::new(1 << 20);
        let loads = Cell::new(0);
        cache
            .get_or_load(&path, StatsMode::BillingTotal, load_counting(&loads, 1))
            .unwrap();
        fs::write(&path, "{}\n{}\n").unwrap();
        cache
            .get_or_load(&path, StatsMode::BillingTotal, load_counting(&loads, 1))
            .unwrap();
        assert_eq!(loads.get(), 2);
        assert_eq!(cache.usage().entries, 1, "the stale entry is replaced");
    }

    #[test]
    fn an_mtime_change_with_the_same_size_invalidates_the_entry() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "a.jsonl", "{\"a\":1}\n");
        let cache = ContributionCache::new(1 << 20);
        let loads = Cell::new(0);
        cache
            .get_or_load(&path, StatsMode::BillingTotal, load_counting(&loads, 1))
            .unwrap();
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(SystemTime::now() + Duration::from_secs(60))
            .unwrap();
        drop(file);
        cache
            .get_or_load(&path, StatsMode::BillingTotal, load_counting(&loads, 1))
            .unwrap();
        assert_eq!(loads.get(), 2);
    }

    #[test]
    fn least_recently_used_entry_is_evicted_past_the_byte_cap() {
        let dir = TempDir::new().unwrap();
        let a = write(&dir, "a.jsonl", "a");
        let b = write(&dir, "b.jsonl", "b");
        let c = write(&dir, "c.jsonl", "c");
        let one = entry_bytes(1_000);
        let cache = ContributionCache::new(2 * one);
        let loads = Cell::new(0);
        let mode = StatsMode::BillingTotal;
        cache
            .get_or_load(&a, mode, load_counting(&loads, 1_000))
            .unwrap();
        cache
            .get_or_load(&b, mode, load_counting(&loads, 1_000))
            .unwrap();
        // Touch `a`, so `b` is the least recently used when `c` arrives.
        cache
            .get_or_load(&a, mode, load_counting(&loads, 1_000))
            .unwrap();
        cache
            .get_or_load(&c, mode, load_counting(&loads, 1_000))
            .unwrap();
        assert_eq!(loads.get(), 3);
        assert_eq!(
            cache.usage(),
            CacheUsage {
                entries: 2,
                bytes: 2 * one
            }
        );
        cache
            .get_or_load(&a, mode, load_counting(&loads, 1_000))
            .unwrap();
        assert_eq!(loads.get(), 3, "a stayed");
        cache
            .get_or_load(&b, mode, load_counting(&loads, 1_000))
            .unwrap();
        assert_eq!(loads.get(), 4, "b was evicted");
    }

    #[test]
    fn an_entry_larger_than_the_cap_is_returned_but_not_stored() {
        let dir = TempDir::new().unwrap();
        let a = write(&dir, "a.jsonl", "a");
        let cache = ContributionCache::new(entry_bytes(10));
        let loads = Cell::new(0);
        let data = cache
            .get_or_load(&a, StatsMode::BillingTotal, load_counting(&loads, 10_000))
            .unwrap();
        assert_eq!(data.title.as_ref().map(String::len), Some(10_000));
        assert_eq!(cache.usage().entries, 0);
    }

    /// A symlink is never answered with its target's entry: the loader
    /// decides (and refuses it), so an alias cannot count a file twice.
    #[cfg(unix)]
    #[test]
    fn a_symlink_is_never_served_from_the_cache() {
        let dir = TempDir::new().unwrap();
        let target = write(&dir, "a.jsonl", "{}\n");
        let link = dir.path().join("link.jsonl");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let cache = ContributionCache::new(1 << 20);
        let loads = Cell::new(0);
        cache
            .get_or_load(&target, StatsMode::BillingTotal, load_counting(&loads, 1))
            .unwrap();
        let through_link =
            cache.get_or_load(
                &link,
                StatsMode::BillingTotal,
                || Err("refused".to_string()),
            );
        assert_eq!(through_link.unwrap_err(), "refused");
    }

    #[test]
    fn load_errors_are_not_cached() {
        let dir = TempDir::new().unwrap();
        let a = write(&dir, "a.jsonl", "a");
        let cache = ContributionCache::new(1 << 20);
        let err = cache.get_or_load(&a, StatsMode::BillingTotal, || Err("boom".to_string()));
        assert_eq!(err.unwrap_err(), "boom");
        assert_eq!(cache.usage().entries, 0);
    }
}
