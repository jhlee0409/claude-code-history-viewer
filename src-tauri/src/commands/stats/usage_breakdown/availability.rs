//! Whether a provider's history store is there to be read (ADR 0003 §7),
//! decided before its scanner runs.
//!
//! The existing provider scanners answer `Ok([])` both for an empty store
//! and for a store that does not exist (Gemini without `~/.gemini/tmp`, Pi
//! without `~/.pi/agent/sessions`, …), and some answer an error for the
//! latter (Codex). Coverage needs the difference: a missing store is
//! `not_found`, an existing store that cannot be listed is `unreadable`, and
//! only a readable store is scanned. Presence is the provider's own
//! detection (`detect()`, the one the provider list uses), so this module
//! keeps no copy of any provider's store layout.

use crate::commands::stats::{stats_provider_store, StatsProvider};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum StoreAvailability {
    /// No store of this provider on this machine: nothing to read.
    Missing,
    /// The store's root exists but cannot be read.
    Unreadable(String),
    /// The store exists and its root can be read: scan it.
    Present,
}

/// The availability of `provider`'s store. Its detection says whether the
/// store holds history; its root (`ProviderInfo::base_path`) must also be
/// readable — an unreadable root is reported even when detection, which
/// only looks at paths, says the store is there.
pub(super) fn store_availability(provider: StatsProvider) -> StoreAvailability {
    let Some(info) = stats_provider_store(provider) else {
        return StoreAvailability::Missing;
    };
    match (info.is_available, root_state(Path::new(&info.base_path))) {
        (_, RootState::Unreadable(error)) => StoreAvailability::Unreadable(error),
        (true, _) => StoreAvailability::Present,
        (false, _) => StoreAvailability::Missing,
    }
}

enum RootState {
    Missing,
    Readable,
    Unreadable(String),
}

/// A store root (a directory or a database file) that exists and opens.
fn root_state(root: &Path) -> RootState {
    if root.as_os_str().is_empty() {
        return RootState::Missing;
    }
    let unreadable =
        |error: std::io::Error| RootState::Unreadable(format!("{}: {error}", root.display()));
    let metadata = match fs::metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return RootState::Missing,
        Err(error) => return unreadable(error),
    };
    let opened = if metadata.is_dir() {
        fs::read_dir(root).map(drop)
    } else {
        // Not a history file: a provider's store database, opened to see
        // that it can be read; nothing is read from it here.
        fs::File::open(root).map(drop)
    };
    match opened {
        Ok(()) => RootState::Readable,
        Err(error) => unreadable(error),
    }
}
