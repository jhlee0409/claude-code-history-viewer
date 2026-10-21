//! What a provider scan could not read (ADR 0003 §7).
//!
//! The provider scanners keep going past a part of their store they cannot
//! read — a directory they may not list, a session file or database they
//! cannot open — so the project tree still shows everything else. A caller
//! that reports coverage (`get_usage_breakdown`) calls a provider's
//! `*_reporting` scanner with a
//! [`ScanReport`](crate::providers::scan_report::ScanReport) and counts what
//! it collected as sources that were not read. Every other caller uses the
//! plain scanner: a reporting one may answer a store it cannot read with
//! nothing where the plain one fails (llm, Z Code: a database that cannot be
//! opened), which is only right when the report is counted.
//!
//! Only failures to read are collected. A path that is not there is nothing
//! to read (also when it vanished between a listing and the read), and
//! content a scanner does not recognise is not a failure to read it.

use std::collections::BTreeSet;
use std::fmt::Display;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::Path;
use std::sync::{Mutex, PoisonError};
use walkdir::WalkDir;

/// The parts of a store a scan could not read. Shared by reference, also
/// across rayon workers.
#[derive(Debug, Default)]
pub struct ScanReport {
    unread: Mutex<BTreeSet<String>>,
}

impl ScanReport {
    /// Record a part of the store that could not be read.
    pub fn unread(&self, what: impl Display) {
        self.unread
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(what.to_string());
    }

    /// Nothing recorded so far.
    pub fn is_empty(&self) -> bool {
        self.unread
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_empty()
    }

    /// Everything recorded, each failure once, sorted.
    pub fn into_unread(self) -> Vec<String> {
        self.unread
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner)
            .into_iter()
            .collect()
    }

    /// The result of reading `path`. An error is recorded unless `path` is
    /// gone: removed since it was listed, there is nothing left to read.
    pub fn read<T, E: Display>(&self, path: &Path, result: Result<T, E>) -> Option<T> {
        match result {
            Ok(value) => Some(value),
            Err(error) => {
                if !is_gone(path) {
                    self.unread(format!("{}: {error}", path.display()));
                }
                None
            }
        }
    }

    /// `fs::read_to_string`, recording a failure to read.
    pub fn read_to_string(&self, path: &Path) -> Option<String> {
        self.read(path, fs::read_to_string(path))
    }

    /// The entries of `dir` that could be listed. A `dir` that is not there
    /// has none; a listing or an entry that fails is recorded.
    pub fn read_dir(&self, dir: &Path) -> Vec<fs::DirEntry> {
        let Some(entries) = self.read(dir, fs::read_dir(dir)) else {
            return Vec::new();
        };
        entries.filter_map(|entry| self.read(dir, entry)).collect()
    }

    /// The entries of a walk that could be read; what it could not read
    /// (a directory it may not list, an entry it cannot stat) is recorded.
    pub fn walk(&self, walk: WalkDir) -> impl Iterator<Item = walkdir::DirEntry> + '_ {
        walk.into_iter().filter_map(move |entry| match entry {
            Ok(entry) => Some(entry),
            Err(error) => {
                let vanished = error
                    .io_error()
                    .is_some_and(|io| io.kind() == ErrorKind::NotFound);
                if !vanished {
                    self.unread(&error);
                }
                None
            }
        })
    }

    /// `fs::metadata` (follows symlinks): `None` when `path` is not there
    /// or its metadata cannot be read, which is recorded.
    pub fn metadata(&self, path: &Path) -> Option<fs::Metadata> {
        self.stat(path, fs::metadata(path))
    }

    /// `fs::symlink_metadata`, recorded like [`Self::metadata`].
    pub fn symlink_metadata(&self, path: &Path) -> Option<fs::Metadata> {
        self.stat(path, fs::symlink_metadata(path))
    }

    /// `Path::is_dir`, except that a path whose metadata cannot be read is
    /// recorded instead of passing for a missing one.
    pub fn is_dir(&self, path: &Path) -> bool {
        self.metadata(path).is_some_and(|m| m.is_dir())
    }

    /// `Path::is_file`, recorded like [`Self::is_dir`].
    pub fn is_file(&self, path: &Path) -> bool {
        self.metadata(path).is_some_and(|m| m.is_file())
    }

    /// The result of opening, querying or stepping through the database at
    /// `db`. A database that cannot be read — not opened, locked, corrupt,
    /// not a database, an I/O error — is recorded unless it is gone. Any
    /// other error (a table or column this store does not have, a value
    /// that does not convert) is about content: the scanner's to skip.
    pub fn db<T>(&self, db: &Path, result: rusqlite::Result<T>) -> Option<T> {
        match result {
            Ok(value) => Some(value),
            Err(error) => {
                if is_unreadable_db(&error) && !is_gone(db) {
                    self.unread(format!("{}: {error}", db.display()));
                }
                None
            }
        }
    }

    fn stat(&self, path: &Path, result: io::Result<fs::Metadata>) -> Option<fs::Metadata> {
        match result {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                self.unread(format!("{}: {error}", path.display()));
                None
            }
        }
    }
}

/// `path` is not there (any longer). A path that cannot even be looked at
/// is not gone: it is unreadable.
fn is_gone(path: &Path) -> bool {
    matches!(fs::symlink_metadata(path), Err(error) if error.kind() == ErrorKind::NotFound)
}

/// A database error that means the database could not be read.
fn is_unreadable_db(error: &rusqlite::Error) -> bool {
    use rusqlite::ErrorCode::{
        CannotOpen, DatabaseBusy, DatabaseCorrupt, DatabaseLocked, FileLockingProtocolFailed,
        NotADatabase, PermissionDenied, SystemIoFailure,
    };
    matches!(
        error.sqlite_error_code(),
        Some(
            CannotOpen
                | DatabaseBusy
                | DatabaseCorrupt
                | DatabaseLocked
                | FileLockingProtocolFailed
                | NotADatabase
                | PermissionDenied
                | SystemIoFailure
        )
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    /// Mode 000 for the guard's lifetime; `None` when it stays readable
    /// (running as root).
    struct Locked<'a>(&'a Path, u32);

    impl<'a> Locked<'a> {
        fn new(path: &'a Path) -> Option<Self> {
            let mode = fs::metadata(path).unwrap().permissions().mode();
            fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
            let guard = Self(path, mode);
            let readable = if path.is_dir() {
                fs::read_dir(path).is_ok()
            } else {
                fs::File::open(path).is_ok()
            };
            (!readable).then_some(guard)
        }
    }

    impl Drop for Locked<'_> {
        fn drop(&mut self) {
            let _ = fs::set_permissions(self.0, fs::Permissions::from_mode(self.1));
        }
    }

    #[test]
    fn what_is_not_there_is_not_a_failure() {
        let dir = TempDir::new().unwrap();
        let report = ScanReport::default();
        let missing = dir.path().join("missing");
        assert!(report.read_dir(&missing).is_empty());
        assert!(report.read_to_string(&missing).is_none());
        assert!(!report.is_dir(&missing) && !report.is_file(&missing));
        assert_eq!(report.walk(WalkDir::new(&missing)).count(), 0);
        assert_eq!(report.into_unread(), Vec::<String>::new());
    }

    #[test]
    fn what_cannot_be_read_is_recorded_once_and_the_rest_is_read() {
        let dir = TempDir::new().unwrap();
        let open = dir.path().join("open");
        let locked = dir.path().join("locked");
        fs::create_dir_all(&open).unwrap();
        fs::create_dir_all(&locked).unwrap();
        fs::write(open.join("a.jsonl"), "{}").unwrap();
        fs::write(locked.join("b.jsonl"), "{}").unwrap();
        let file = open.join("a.jsonl");
        let Some(_locked_dir) = Locked::new(&locked) else {
            return;
        };

        let report = ScanReport::default();
        let names: Vec<String> = report
            .walk(WalkDir::new(dir.path()).min_depth(1))
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"a.jsonl".to_string()), "{names:?}");
        assert!(report.read_dir(&locked).is_empty());
        // Below an unlistable directory nothing can even be looked at.
        assert!(!report.is_file(&locked.join("b.jsonl")));
        assert_eq!(report.read_to_string(&file).as_deref(), Some("{}"));
        let unread = report.into_unread();
        assert_ne!(unread, Vec::<String>::new());
        assert!(
            unread.iter().all(|what| what.contains("locked")),
            "{unread:?}"
        );

        let Some(_locked_file) = Locked::new(&file) else {
            return;
        };
        let report = ScanReport::default();
        assert!(report.read_to_string(&file).is_none());
        assert_eq!(report.into_unread().len(), 1);
    }

    #[test]
    fn a_database_that_cannot_be_read_is_recorded_but_unknown_content_is_not() {
        use rusqlite::{Connection, OpenFlags};
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("store.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE session (id TEXT)")
            .unwrap();
        let open = || Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY);

        // A table this store does not have is content, not a failure.
        let report = ScanReport::default();
        let conn = report.db(&path, open()).unwrap();
        assert!(report
            .db(&path, conn.prepare("SELECT id FROM project"))
            .is_none());
        assert!(report.is_empty());

        // Not a database.
        fs::write(&path, "not a database, just text that is long enough").unwrap();
        let report = ScanReport::default();
        let conn = report.db(&path, open()).unwrap();
        assert!(report
            .db(&path, conn.prepare("SELECT id FROM session"))
            .is_none());
        assert_eq!(report.into_unread().len(), 1);

        // Gone, and locked.
        let missing = dir.path().join("missing.db");
        let report = ScanReport::default();
        let opened = Connection::open_with_flags(&missing, OpenFlags::SQLITE_OPEN_READ_ONLY);
        assert!(report.db(&missing, opened).is_none());
        assert!(report.is_empty());
        let Some(_locked) = Locked::new(&path) else {
            return;
        };
        let report = ScanReport::default();
        assert!(report.db(&path, open()).is_none());
        assert_eq!(report.into_unread().len(), 1);
    }
}
