//! The Claude session files a history reader reads, found and opened without
//! following a symlink (src-tauri security rule; ADR 0003 §7).
//!
//! One walk for every Claude stats command (the old ones and
//! `get_usage_breakdown`, so both read the same file set) and history reader
//! (session list, project list, search, recent edits): every `*.jsonl` entry
//! under a project directory that is not a symlink. The walk root itself may
//! be reached through a symlink (a symlinked `~/.claude`, #355): the caller
//! authorizes the root, and the HTTP route judges it by its canonical path.
//! Nothing inside the root is followed. What a walk skipped or could not read
//! is returned, so a caller that reports coverage can say so.
//!
//! A check at walk time and the open after it are separate system calls, so
//! the check alone cannot decide what is read. Every history file is opened
//! through [`open_session_file`] (or [`open_history_file`], for a file a
//! reader was handed on its own), which decides at the open itself (#698): a
//! file swapped for a symlink or a FIFO after the walk is refused there, and
//! a FIFO never blocks the reader.

use std::fs::{self, File, Metadata};
use std::io;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

fn has_session_extension(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()) == Some("jsonl")
}

/// What a walk of one Claude project directory found.
#[derive(Debug, Default)]
pub(crate) struct SessionFileWalk {
    /// Every `*.jsonl` entry that is not a symlink, in walk order. As in the
    /// old scans, a directory named like a session is kept, so a scan can
    /// report it; a reader opens [`regular_session_files`] only.
    pub files: Vec<PathBuf>,
    /// `*.jsonl` entries that are symlinks: never followed, never read.
    pub links: Vec<PathBuf>,
    /// Entries the walk could not read (an unreadable directory, an I/O
    /// error).
    pub errors: Vec<String>,
}

/// Every `*.jsonl` entry under `project_dir`, symlinks never followed.
pub(crate) fn walk_session_files(project_dir: &Path) -> SessionFileWalk {
    let mut walk = SessionFileWalk::default();
    for entry in WalkDir::new(project_dir).follow_links(false) {
        match entry {
            Ok(entry) if !has_session_extension(entry.path()) => {}
            Ok(entry) if entry.path_is_symlink() => walk.links.push(entry.into_path()),
            Ok(entry) => walk.files.push(entry.into_path()),
            Err(error) => walk.errors.push(error.to_string()),
        }
    }
    walk
}

/// Whether `path` is a regular file, judged without following a symlink:
/// the only kind of entry a history reader opens. A symlink can lead out of
/// the root, a directory named like a session fails every read (which a
/// line reader used to retry forever), and a FIFO blocks the reader that
/// opens it.
pub(crate) fn is_regular_file(path: &Path) -> bool {
    let regular = fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file());
    #[cfg(all(test, unix))]
    if regular {
        swap_after_check::checked(path);
    }
    regular
}

/// The session files a history reader opens under `project_dir`: the walk's
/// files that are regular files. The walk keeps a directory named like a
/// session, so that a scan can report it; a reader never opens one.
pub(crate) fn regular_session_files(project_dir: &Path) -> Vec<PathBuf> {
    walk_session_files(project_dir)
        .files
        .into_iter()
        .filter(|path| is_regular_file(path))
        .collect()
}

/// The project directories directly under a Claude `projects/` folder.
#[derive(Debug, Default)]
pub(crate) struct ProjectDirs {
    /// Real directories, sorted.
    pub dirs: Vec<PathBuf>,
    /// Symlinks to directories: never walked.
    pub links: Vec<PathBuf>,
    /// Entries that could not be read.
    pub errors: Vec<String>,
}

/// List the project directories of `projects_dir` without following a
/// symlink. A symlink to a directory is returned in `links` (the old scans
/// walked it as a project); anything else that is not a directory is not a
/// project.
pub(crate) fn claude_project_dirs(projects_dir: &Path) -> io::Result<ProjectDirs> {
    let mut listing = ProjectDirs::default();
    for entry in fs::read_dir(projects_dir)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                listing
                    .errors
                    .push(format!("{}: {error}", projects_dir.display()));
                continue;
            }
        };
        let path = entry.path();
        // `DirEntry::file_type` does not follow a symlink.
        match entry.file_type() {
            Ok(file_type) if file_type.is_symlink() => {
                if path.is_dir() {
                    listing.links.push(path);
                }
            }
            Ok(file_type) if file_type.is_dir() => listing.dirs.push(path),
            Ok(_) => {}
            Err(error) => listing.errors.push(format!("{}: {error}", path.display())),
        }
    }
    listing.dirs.sort();
    listing.links.sort();
    Ok(listing)
}

/// Why a history file was not opened; the reader's error says it.
const A_SYMLINK: &str = "a symlink is never read";
const NOT_REGULAR: &str = "not a regular file";
const CHANGED: &str = "changed while it was opened";

fn refused(reason: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, reason)
}

fn outside(root: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("outside the scanned root {}", root.display()),
    )
}

/// Open a history file found under `root`, a canonical directory, for
/// reading (#698).
///
/// What is read is decided at the open, not by a check made before it, so a
/// file swapped after the walk is refused as well:
///
/// - a symlink is never read: `path` is opened without following one
///   (`O_NOFOLLOW`), so a file swapped for a link after the check is
///   refused by the open itself;
/// - only a regular file is read, and the open never blocks: a FIFO opens
///   at once (`O_NONBLOCK`, cleared again once the handle is a regular
///   file) and is refused by the handle's metadata, as a directory is;
/// - the file lies inside `root`: its canonical path before the open, and
///   the opened handle's own path where the system reports it (`F_GETPATH`
///   on macOS, `/proc/self/fd` on Linux), so a folder on the way swapped for
///   a link out of the root is refused too;
/// - the handle is the file that was checked (same device and inode).
///
/// The root itself may be reached through a symlink (a symlinked
/// `~/.claude`, #355); callers pass its canonical path. A hardlink is a
/// regular file inside the root by another name and is read (ADR 0003 §7):
/// for a file with more than one link the handle's path is any of its names,
/// so the canonical path and the identity decide.
///
/// Windows has no `O_NOFOLLOW`, and std reports neither a file id nor a
/// handle's path there. The file is opened with
/// `FILE_FLAG_OPEN_REPARSE_POINT`, so a symlink or junction swapped in is
/// opened as the link itself and refused by the opened handle's metadata; a
/// folder on the way swapped for a junction between the containment check
/// and the open is not detected.
pub(crate) fn open_session_file(path: &Path, root: &Path) -> Result<(File, Metadata), String> {
    open_inside(path, root).map_err(|error| format!("{}: {error}", path.display()))
}

/// Open a history file a reader was handed on its own, with no walk to
/// name its root (one session's messages and its export, its continuation
/// chain, an archived session): [`open_session_file`] with the file's own
/// folder as the root.
pub(crate) fn open_history_file(path: &Path) -> io::Result<File> {
    open_inside(path, &own_folder(path)?).map(|(file, _)| file)
}

/// The canonical folder of a history file: the root of a file a reader was
/// handed on its own, and of the files kept beside it (its continuation
/// chain, its subagent transcripts).
pub(crate) fn own_folder(path: &Path) -> io::Result<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::canonicalize(parent)
}

fn open_inside(path: &Path, root: &Path) -> io::Result<(File, Metadata)> {
    let checked = fs::symlink_metadata(path)?;
    if checked.file_type().is_symlink() {
        return Err(refused(A_SYMLINK));
    }
    if !checked.is_file() {
        return Err(refused(NOT_REGULAR));
    }
    #[cfg(all(test, unix))]
    swap_after_check::checked(path);
    let canonical = fs::canonicalize(path)?;
    if !canonical.starts_with(root) {
        return Err(outside(root));
    }
    let file = open_without_following(&canonical)?;
    let opened = file.metadata()?;
    // On Windows a link swapped in is opened as the link itself.
    if opened.file_type().is_symlink() {
        return Err(refused(A_SYMLINK));
    }
    if !opened.is_file() {
        return Err(refused(NOT_REGULAR));
    }
    if !same_file(&checked, &opened) {
        return Err(refused(CHANGED));
    }
    blocking_reads(&file)?;
    if !opened_inside(&file, &opened, root) {
        return Err(outside(root));
    }
    Ok((file, opened))
}

/// Open `path` for reading without following a symlink at its last
/// component and without blocking: a FIFO opens at once and is refused by
/// the caller.
#[cfg(unix)]
fn open_without_following(path: &Path) -> io::Result<File> {
    use rustix::fs::{Mode, OFlags};
    let flags =
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::NOCTTY | OFlags::CLOEXEC;
    match rustix::fs::open(path, flags, Mode::empty()) {
        Ok(fd) => Ok(File::from(fd)),
        Err(errno) if errno == rustix::io::Errno::LOOP => Err(refused(A_SYMLINK)),
        Err(errno) => Err(errno.into()),
    }
}

/// `FILE_FLAG_OPEN_REPARSE_POINT`: a symlink or junction is opened itself,
/// not what it points to.
#[cfg(windows)]
fn open_without_following(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

#[cfg(not(any(unix, windows)))]
fn open_without_following(path: &Path) -> io::Result<File> {
    File::open(path)
}

/// Reads of the regular file block as usual again: it was opened
/// non-blocking only so that a FIFO in its place could not block the open.
#[cfg(unix)]
fn blocking_reads(file: &File) -> io::Result<()> {
    use rustix::fs::{fcntl_getfl, fcntl_setfl, OFlags};
    let flags = fcntl_getfl(file)?;
    fcntl_setfl(file, flags - OFlags::NONBLOCK)?;
    Ok(())
}

#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)] // Result matches the Unix version, which can fail.
fn blocking_reads(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn same_file(checked: &Metadata, opened: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    (checked.dev(), checked.ino()) == (opened.dev(), opened.ino())
}

/// std has no stable file id off Unix; the symlink and containment checks
/// above still apply.
#[cfg(not(unix))]
fn same_file(_checked: &Metadata, _opened: &Metadata) -> bool {
    true
}

/// Whether the opened file lies inside `root`, judged by the path the system
/// reports for the handle. A file with more than one link is any of its
/// names there, so it is judged by the checks before the open alone, and so
/// is a file on a system that reports no path.
fn opened_inside(file: &File, opened: &Metadata, root: &Path) -> bool {
    if link_count(opened) > 1 {
        return true;
    }
    opened_path(file).map_or(true, |path| path.starts_with(root))
}

#[cfg(unix)]
fn link_count(opened: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    opened.nlink()
}

#[cfg(not(unix))]
fn link_count(_opened: &Metadata) -> u64 {
    1
}

/// The path of the opened file, as the kernel reports it.
#[cfg(target_vendor = "apple")]
fn opened_path(file: &File) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let path = rustix::fs::getpath(file).ok()?;
    Some(PathBuf::from(std::ffi::OsStr::from_bytes(path.as_bytes())))
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn opened_path(file: &File) -> Option<PathBuf> {
    use std::os::fd::AsRawFd;
    fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).ok()
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux", target_os = "android")))]
fn opened_path(_file: &File) -> Option<PathBuf> {
    None
}

/// The subagent transcripts folded into `session` (#577), as
/// `utils::find_subagent_files` finds them, keeping only those reached
/// without a symlink below the session's folder. That lookup refuses a
/// symlinked `subagents` folder and a symlinked transcript, but resolves a
/// symlinked folder on the way to them (`<session>/` in the native layout,
/// `subagents/` in the archive layout), which can lead out of the root just
/// as a symlinked session file does.
pub(crate) fn subagent_files(session: &Path) -> Vec<PathBuf> {
    let Some(dir) = session.parent() else {
        return Vec::new();
    };
    crate::utils::find_subagent_files(session)
        .into_iter()
        .filter(|file| reached_without_a_symlink(dir, file))
        .collect()
}

/// The subagent transcripts of `session` a reader opens: the
/// [`subagent_files`] that are regular files. The lookup keeps a directory
/// named like a transcript (an archive refuses one); a reader skips it, and
/// a FIFO, which would block it.
pub(crate) fn regular_subagent_files(session: &Path) -> Vec<PathBuf> {
    subagent_files(session)
        .into_iter()
        .filter(|file| is_regular_file(file))
        .collect()
}

/// Whether `path` lies below `dir` through real entries only: every component
/// after `dir` is a plain name and none of them is a symlink. `dir` itself may
/// be reached through one, as the walk root may.
fn reached_without_a_symlink(dir: &Path, path: &Path) -> bool {
    let Ok(below) = path.strip_prefix(dir) else {
        return false;
    };
    let mut current = dir.to_path_buf();
    below.components().all(|component| match component {
        Component::Normal(name) => {
            current.push(name);
            fs::symlink_metadata(&current).is_ok_and(|meta| !meta.file_type().is_symlink())
        }
        _ => false,
    })
}

/// Test hook: swaps a history file for something else right after a check
/// has found it to be a regular file, before a reader opens it (#698). A
/// walk-time check and the open that follows are separate system calls;
/// this puts a swap between them deterministically. Every check of this
/// module calls [`checked`](swap_after_check::checked): the walk's
/// [`is_regular_file`] and the check each open helper makes before it opens.
/// Built for Unix only, as the tests that arm it are: they swap in a symlink
/// or a FIFO.
#[cfg(all(test, unix))]
pub(crate) mod swap_after_check {
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, PoisonError};

    type Swap = Box<dyn FnOnce() + Send>;

    static ARMED: Mutex<Option<(PathBuf, Swap)>> = Mutex::new(None);
    static FIRED: Mutex<bool> = Mutex::new(false);

    /// Run `swap` once, right after the next check that finds `path` to be a
    /// regular file.
    pub(crate) fn arm(path: &Path, swap: impl FnOnce() + Send + 'static) {
        *FIRED.lock().unwrap_or_else(PoisonError::into_inner) = false;
        *ARMED.lock().unwrap_or_else(PoisonError::into_inner) =
            Some((path.to_path_buf(), Box::new(swap)));
    }

    /// Disarm the hook. Whether the swap ran since [`arm`].
    pub(crate) fn disarm() -> bool {
        ARMED.lock().unwrap_or_else(PoisonError::into_inner).take();
        std::mem::take(&mut *FIRED.lock().unwrap_or_else(PoisonError::into_inner))
    }

    /// A check found `path` to be a regular file.
    pub(super) fn checked(path: &Path) {
        let swap = {
            let mut armed = ARMED.lock().unwrap_or_else(PoisonError::into_inner);
            match armed.as_ref() {
                Some((armed_path, _)) if armed_path == path => armed.take(),
                _ => None,
            }
        };
        if let Some((_, swap)) = swap {
            swap();
            *FIRED.lock().unwrap_or_else(PoisonError::into_inner) = true;
        }
    }
}

/// Every history read goes through this module (#698): the history readers'
/// production code calls no open that follows a symlink or blocks on a FIFO.
/// A read of something that is not a history file (the app's own caches and
/// manifests, a restore target in the user's project, another provider's
/// store) says so on the line before it, with [`MARKER`](raw_open_guard::MARKER)
/// and what it reads.
#[cfg(test)]
mod raw_open_guard {
    use std::path::Path;

    /// The history readers: the stats commands and the usage breakdown, the
    /// session and subagent loaders and their chains, search, recent edits,
    /// archives and the project list. Settings metadata reuses the same safe
    /// regular-file opener and is held to the raw-open guard as well.
    const READERS: &[&str] = &[
        "src/commands/claude_settings/metadata.rs",
        "src/commands/stats.rs",
        "src/commands/stats/cache.rs",
        "src/commands/stats/usage_breakdown.rs",
        "src/commands/stats/usage_breakdown/aggregate.rs",
        "src/commands/stats/usage_breakdown/availability.rs",
        "src/commands/stats/usage_breakdown/contribution.rs",
        "src/commands/stats/usage_breakdown/contribution_cache.rs",
        "src/commands/stats/usage_breakdown/ranking.rs",
        "src/commands/stats/usage_breakdown/sources.rs",
        "src/commands/session/chain.rs",
        "src/commands/session/edits.rs",
        "src/commands/session/load.rs",
        "src/commands/session/search.rs",
        "src/commands/archive.rs",
        "src/commands/project.rs",
    ];

    /// Opens by path that follow a symlink and block on a FIFO.
    const RAW_OPENS: &[&str] = &[
        "File::open(",
        "fs::read(",
        "fs::read_to_string(",
        "fs::copy(",
    ];

    /// Marks a read that is not of a history file: the next raw open, on one
    /// of the next three lines of code.
    pub(super) const MARKER: &str = "// Not a history file:";

    /// A `#[cfg(test)]` or `#[cfg(all(test, …))]` attribute on a top-level
    /// item.
    fn is_test_attribute(line: &str) -> bool {
        line.starts_with("#[cfg(test") || line.starts_with("#[cfg(all(test")
    }

    /// `line: code` for every raw open in the production code of `source`
    /// that is not marked. Test code is skipped: a top-level item under a
    /// test attribute, up to the `;` or the `}` that ends it, found by
    /// counting its brackets ([`Brackets`]). Test code that never ends is
    /// reported as well: it would hide the rest of the file.
    fn raw_opens(source: &str) -> Vec<String> {
        let mut found = Vec::new();
        let mut brackets = Brackets::default();
        let mut test_item: Option<usize> = None;
        let mut marked_lines: usize = 0;
        for (index, line) in source.lines().enumerate() {
            if test_item.is_none() && brackets.within == Within::Code && is_test_attribute(line) {
                test_item = Some(index + 1);
                brackets.depth = 0;
            }
            let item_ends = brackets.read(line);
            if test_item.is_some() {
                if item_ends {
                    test_item = None;
                }
                continue;
            }
            let code = line.trim();
            if code.starts_with(MARKER) {
                marked_lines = 3;
                continue;
            }
            if code.starts_with("//") {
                continue;
            }
            if RAW_OPENS.iter().any(|open| code.contains(open)) {
                if marked_lines == 0 {
                    found.push(format!("{}: {code}", index + 1));
                }
                marked_lines = 0;
            }
            marked_lines = marked_lines.saturating_sub(1);
        }
        if let Some(start) = test_item {
            found.push(format!("{start}: test code that never ends"));
        }
        found
    }

    /// Where a line of source leaves off: in code, or in a string literal or
    /// a block comment that goes on to the next line.
    #[derive(Clone, Copy, Default, PartialEq)]
    enum Within {
        #[default]
        Code,
        Str,
        /// A raw string, closed by `"` and this many `#`.
        RawStr(usize),
        /// A block comment, nested this deep.
        Comment(usize),
    }

    /// Source read line by line as far as its brackets go. A bracket in a
    /// string or char literal (`"{"`, `r#"{"#`, `'{'`) or in a comment is
    /// not counted, and a lifetime's quote (`'a`) opens no char literal.
    #[derive(Default)]
    struct Brackets {
        /// How many `(`, `[` and `{` are open.
        depth: usize,
        within: Within,
    }

    impl Brackets {
        /// Read `line`. Whether an item ends on it: a `;` outside every
        /// bracket, or the `}` that closes the last one open.
        fn read(&mut self, line: &str) -> bool {
            let chars: Vec<char> = line.chars().collect();
            let mut ends = false;
            let mut i = 0;
            while i < chars.len() {
                let next = chars.get(i + 1).copied();
                match self.within {
                    Within::Str => match chars[i] {
                        '\\' => i += 1,
                        '"' => self.within = Within::Code,
                        _ => {}
                    },
                    Within::RawStr(hashes) => {
                        let closing = chars.get(i + 1..i + 1 + hashes);
                        if chars[i] == '"'
                            && closing.is_some_and(|tail| tail.iter().all(|&c| c == '#'))
                        {
                            self.within = Within::Code;
                            i += hashes;
                        }
                    }
                    Within::Comment(nested) => match (chars[i], next) {
                        ('*', Some('/')) => {
                            self.within = if nested > 1 {
                                Within::Comment(nested - 1)
                            } else {
                                Within::Code
                            };
                            i += 1;
                        }
                        ('/', Some('*')) => {
                            self.within = Within::Comment(nested + 1);
                            i += 1;
                        }
                        _ => {}
                    },
                    Within::Code => match (chars[i], next) {
                        ('/', Some('/')) => break,
                        ('/', Some('*')) => {
                            self.within = Within::Comment(1);
                            i += 1;
                        }
                        ('"', _) => self.within = Within::Str,
                        ('\'', _) => i += char_literal_len(&chars[i..]) - 1,
                        ('(' | '[' | '{', _) => self.depth += 1,
                        (')' | ']', _) => self.depth = self.depth.saturating_sub(1),
                        ('}', _) => {
                            self.depth = self.depth.saturating_sub(1);
                            ends |= self.depth == 0;
                        }
                        (';', _) => ends |= self.depth == 0,
                        (c, _) if is_word(c) => {
                            let end = chars[i..]
                                .iter()
                                .position(|&c| !is_word(c))
                                .map_or(chars.len(), |len| i + len);
                            let hashes = chars[end..].iter().take_while(|&&c| c == '#').count();
                            let prefix = matches!(&chars[i..end], ['r'] | ['b' | 'c', 'r']);
                            if prefix && chars.get(end + hashes) == Some(&'"') {
                                // A raw string: no escapes, closed by `"` and
                                // as many `#`.
                                self.within = Within::RawStr(hashes);
                                i = end + hashes;
                            } else {
                                i = end - 1;
                            }
                        }
                        _ => {}
                    },
                }
                i += 1;
            }
            ends
        }
    }

    /// A char of a word: an identifier, a keyword, a number, or the prefix
    /// of a literal (`r#"…"#`, `b'…'`).
    fn is_word(c: char) -> bool {
        c.is_alphanumeric() || c == '_'
    }

    /// How many chars the char literal at the start of `rest` takes (`'{'`,
    /// `'\''`, `'\u{7b}'`): one, the quote alone, for a lifetime or a label
    /// (`'a`).
    fn char_literal_len(rest: &[char]) -> usize {
        match rest {
            ['\'', '\\', _, tail @ ..] => tail
                .iter()
                .position(|&c| c == '\'')
                .map_or(1, |end| end + 4),
            ['\'', _, '\'', ..] => 3,
            _ => 1,
        }
    }

    fn crate_file(relative: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// A test-only file: its parent declares it under `#[cfg(test)]`.
    fn is_test_file(path: &Path) -> bool {
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        stem.ends_with("tests") || stem == "fixture" || stem == "test_utils"
    }

    #[test]
    fn history_readers_open_history_files_through_session_files_only() {
        let found: Vec<(&str, Vec<String>)> = READERS
            .iter()
            .map(|&reader| (reader, raw_opens(&crate_file(reader))))
            .filter(|(_, opens)| !opens.is_empty())
            .collect();
        assert_eq!(found, Vec::<(&str, Vec<String>)>::new());
    }

    /// A module that uses `session_files` reads history: it is on the list,
    /// so a new reader is checked as well.
    #[test]
    fn every_module_using_session_files_is_checked() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut unlisted: Vec<String> = walkdir::WalkDir::new(&src)
            .into_iter()
            .filter_map(Result::ok)
            .map(walkdir::DirEntry::into_path)
            .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
            .filter(|path| !is_test_file(path) && !path.ends_with("stats/session_files.rs"))
            .filter(|path| {
                std::fs::read_to_string(path).is_ok_and(|text| text.contains("session_files::"))
            })
            .map(|path| {
                let relative = path.strip_prefix(env!("CARGO_MANIFEST_DIR")).unwrap();
                relative.to_string_lossy().replace('\\', "/")
            })
            .filter(|relative| !READERS.contains(&relative.as_str()))
            .collect();
        unlisted.sort();
        assert_eq!(unlisted, Vec::<String>::new());
    }

    /// The guard itself: a raw open planted in a reader is reported; a marked
    /// read, a comment and test code are not, and a marker covers only the
    /// open right below it. Test code ends where its brackets close, whatever
    /// brackets its literals and comments hold, and test code that never
    /// ends is reported.
    #[test]
    fn the_guard_reports_a_raw_open_planted_in_a_reader() {
        let planted = "\
use std::fs::{self, File};

fn read(path: &Path) -> Option<Vec<u8>> {
    fs::read(path).ok()
}

fn reader(path: &Path) -> BufReader<File> {
    BufReader::new(File::open(path).unwrap())
}

fn manifest(path: &Path) -> String {
    // Not a history file: the archive manifest.
    let content =
        fs::read_to_string(path).unwrap_or_default();
    content
}

/// `File::open(path)` in a comment is not a call.
fn copy(from: &Path, to: &Path) {
    // Not a history file: covers the next open only.
    let _ = fs::read(to);
    let _ = std::fs::copy(from, to);
}

#[cfg(test)]
fn test_only(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

#[cfg(all(test, unix))]
mod tests {
    #[test]
    fn fixture() {
        let _ = std::fs::read(\"x.jsonl\");
    }
}

#[cfg(test)]
fn one_line() {}

fn after_one_line(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap()
}

#[cfg(test)]
static FIXTURE: Lazy<String> =
    Lazy::new(|| String::from(\"{\"));

fn after_static(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

#[cfg(test)]
mod quoted {
    // A `{` in a comment.
    /* A `{` in a /* nested */ block comment { */
    const RAW: &str = r#\"a \"{\" in a raw string
}\"#;
    const ESCAPED: &str = \"\\\"{\";
    const BRACE: char = '{';
    fn first<'a>(lines: &'a [&'a str]) -> &'a str {
        lines.first().copied().unwrap_or(ESCAPED)
    }
    fn in_test(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }
}

fn after_quoted(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

/*
#[cfg(test)]
*/
fn after_comment(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap()
}
";
        assert_eq!(
            raw_opens(planted),
            [
                "4: fs::read(path).ok()",
                "8: BufReader::new(File::open(path).unwrap())",
                "22: let _ = std::fs::copy(from, to);",
                "42: fs::read(path).unwrap()",
                "50: fs::read_to_string(path).unwrap()",
                "70: fs::read_to_string(path).unwrap()",
                "77: fs::read(path).unwrap()",
            ]
        );
        assert_eq!(
            raw_opens("#[cfg(test)]\nmod tests {\n    fn f() {}\n"),
            ["1: test code that never ends"]
        );
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "{}\n").unwrap();
    }

    #[test]
    fn the_walk_lists_session_files_and_never_follows_a_link() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let project = dir.path().join("p");
        touch(&project.join("a.jsonl"));
        touch(&project.join("a/subagents/agent-1.jsonl"));
        touch(&project.join("notes.txt"));
        touch(&outside.path().join("x.jsonl"));
        symlink(outside.path().join("x.jsonl"), project.join("link.jsonl")).unwrap();
        symlink(outside.path(), project.join("linked-dir")).unwrap();

        let walk = walk_session_files(&project);
        let mut files = walk.files.clone();
        files.sort();
        assert_eq!(
            files,
            [
                project.join("a/subagents/agent-1.jsonl"),
                project.join("a.jsonl")
            ]
        );
        assert_eq!(walk.links, [project.join("link.jsonl")]);
        assert_eq!(walk.errors, Vec::<String>::new());
    }

    /// A reader opens regular files only: not a link, not a directory named
    /// like a session (the walk keeps it), not a FIFO.
    #[test]
    fn readers_open_the_regular_session_files_only() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().join("p");
        touch(&project.join("a.jsonl"));
        touch(&project.join("a/subagents/agent-1.jsonl"));
        fs::create_dir_all(project.join("folder.jsonl")).unwrap();
        symlink(project.join("a.jsonl"), project.join("link.jsonl")).unwrap();
        let fifo = project.join("fifo.jsonl");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(made.success());

        let mut walked = walk_session_files(&project).files;
        walked.sort();
        let mut read = regular_session_files(&project);
        read.sort();
        assert_eq!(
            walked,
            [
                project.join("a/subagents/agent-1.jsonl"),
                project.join("a.jsonl"),
                fifo,
                project.join("folder.jsonl"),
            ]
        );
        assert_eq!(
            read,
            [
                project.join("a/subagents/agent-1.jsonl"),
                project.join("a.jsonl")
            ]
        );
    }

    #[test]
    fn project_listing_separates_directories_from_links() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let projects = dir.path().join("projects");
        fs::create_dir_all(projects.join("b")).unwrap();
        fs::create_dir_all(projects.join("a")).unwrap();
        touch(&projects.join("stray.jsonl"));
        symlink(outside.path(), projects.join("evil")).unwrap();
        symlink(outside.path().join("missing"), projects.join("dangling")).unwrap();

        let listing = claude_project_dirs(&projects).unwrap();
        assert_eq!(listing.dirs, [projects.join("a"), projects.join("b")]);
        assert_eq!(listing.links, [projects.join("evil")]);
        assert_eq!(listing.errors, Vec::<String>::new());
    }

    #[test]
    fn subagent_files_keep_real_folders_and_refuse_a_symlinked_one() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let project = dir.path().join("p");
        // s1: both layouts, real folders.
        touch(&project.join("s1.jsonl"));
        touch(&project.join("s1/subagents/agent-1.jsonl"));
        touch(&project.join("subagents/s1/agent-2.jsonl"));
        // s2: the native `<session>/` folder is a link out of the root.
        touch(&project.join("s2.jsonl"));
        touch(&outside.path().join("native/subagents/agent-3.jsonl"));
        symlink(outside.path().join("native"), project.join("s2")).unwrap();
        // s3 in q: the archive `subagents/` folder is a link out of the root.
        let other = dir.path().join("q");
        touch(&other.join("s3.jsonl"));
        touch(&outside.path().join("archive/s3/agent-4.jsonl"));
        symlink(outside.path().join("archive"), other.join("subagents")).unwrap();

        assert_eq!(
            subagent_files(&project.join("s1.jsonl")),
            [
                project.join("s1/subagents/agent-1.jsonl"),
                project.join("subagents/s1/agent-2.jsonl")
            ]
        );
        for (session, found_by_lookup) in
            [(project.join("s2.jsonl"), 1), (other.join("s3.jsonl"), 1)]
        {
            // The lookup alone resolves the folder link; the stats never do.
            assert_eq!(
                crate::utils::find_subagent_files(&session).len(),
                found_by_lookup,
                "{}",
                session.display()
            );
            assert_eq!(
                subagent_files(&session),
                Vec::<PathBuf>::new(),
                "{}",
                session.display()
            );
        }
    }

    /// The project directory itself may be reached through a symlink (the walk
    /// root): its subagent folders are still read.
    #[test]
    fn subagent_files_of_a_project_reached_through_a_symlink() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().join("p");
        touch(&project.join("s1.jsonl"));
        touch(&project.join("s1/subagents/agent-1.jsonl"));
        let linked = dir.path().join("linked");
        symlink(&project, &linked).unwrap();

        assert_eq!(
            subagent_files(&linked.join("s1.jsonl")),
            [linked.join("s1/subagents/agent-1.jsonl")]
        );
    }

    /// A directory or a FIFO named like a transcript is not one: the lookup
    /// keeps both, a reader gets neither.
    #[test]
    fn readers_open_the_regular_subagent_files_only() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().join("p");
        touch(&project.join("s1.jsonl"));
        touch(&project.join("s1/subagents/agent-1.jsonl"));
        fs::create_dir_all(project.join("s1/subagents/agent-folder.jsonl")).unwrap();
        let made = std::process::Command::new("mkfifo")
            .arg(project.join("s1/subagents/agent-fifo.jsonl"))
            .status()
            .unwrap();
        assert!(made.success());

        let session = project.join("s1.jsonl");
        assert_eq!(subagent_files(&session).len(), 3);
        assert_eq!(
            regular_subagent_files(&session),
            [project.join("s1/subagents/agent-1.jsonl")]
        );
    }

    /// A session file named `...jsonl` has the stem `..`: the lookup then
    /// names folders beside the project, which are not the session's.
    #[test]
    fn subagent_files_never_leave_the_session_folder_by_name() {
        let dir = TempDir::new().unwrap();
        let project = dir.path().join("projects/p");
        touch(&project.join("...jsonl"));
        touch(&dir.path().join("projects/subagents/agent-1.jsonl"));

        assert_eq!(
            crate::utils::find_subagent_files(&project.join("...jsonl")).len(),
            1
        );
        assert_eq!(
            subagent_files(&project.join("...jsonl")),
            Vec::<PathBuf>::new()
        );
    }

    /// A direct reader opens a regular file, and refuses a directory, a link
    /// and a FIFO named like a session without blocking. The folder may be
    /// reached through a link (#355).
    #[test]
    fn open_history_file_refuses_what_is_not_a_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        let session = dir.path().join("s1.jsonl");
        fs::write(&session, "{}\n").unwrap();
        let folder = dir.path().join("folder.jsonl");
        fs::create_dir(&folder).unwrap();

        assert!(open_history_file(&session).is_ok());
        let refused = open_history_file(&folder).unwrap_err();
        assert_eq!(refused.to_string(), "not a regular file");
        assert!(open_history_file(&dir.path().join("gone.jsonl")).is_err());

        let link = dir.path().join("link.jsonl");
        symlink(&session, &link).unwrap();
        let refused = open_history_file(&link).unwrap_err();
        assert_eq!(refused.to_string(), "a symlink is never read");
        let fifo = dir.path().join("fifo.jsonl");
        mkfifo(&fifo);
        let refused = open_history_file(&fifo).unwrap_err();
        assert_eq!(refused.to_string(), "not a regular file");

        let linked_folder = dir.path().join("linked");
        symlink(dir.path(), &linked_folder).unwrap();
        assert!(open_history_file(&linked_folder.join("s1.jsonl")).is_ok());
    }

    /// `open_session_file` keeps the file inside the root it was found
    /// under, which may itself be reached through a link, and reads a
    /// hardlink there (ADR 0003 §7).
    #[test]
    fn open_session_file_keeps_the_file_inside_its_root() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        touch(&root.join("p/s1.jsonl"));
        touch(&outside.path().join("o.jsonl"));
        fs::hard_link(outside.path().join("o.jsonl"), root.join("p/hard.jsonl")).unwrap();
        let linked = outside.path().join("linked-root");
        symlink(&root, &linked).unwrap();

        let opened = |path: &Path, within: &Path| open_session_file(path, within).is_ok();
        assert_eq!(
            [
                opened(&root.join("p/s1.jsonl"), &root),
                opened(&linked.join("p/s1.jsonl"), &root),
                opened(&root.join("p/hard.jsonl"), &root),
                opened(&root.join("p/s1.jsonl"), &root.join("q")),
                opened(&outside.path().join("o.jsonl"), &root),
            ],
            [true, true, true, false, false]
        );
    }

    /// The opened handle is judged by its own path: a file opened outside the
    /// root is refused even when the path checked before the open was inside
    /// it (a folder swapped for a link in between).
    #[test]
    fn the_opened_handle_is_judged_by_its_own_path() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        touch(&root.join("s1.jsonl"));
        touch(&outside.path().join("o.jsonl"));
        let inside = File::open(root.join("s1.jsonl")).unwrap();
        let elsewhere = File::open(outside.path().join("o.jsonl")).unwrap();

        let judged = |file: &File| opened_inside(file, &file.metadata().unwrap(), &root);
        assert_eq!((judged(&inside), judged(&elsewhere)), (true, false));
    }

    fn mkfifo(path: &Path) {
        let made = std::process::Command::new("mkfifo")
            .arg(path)
            .status()
            .unwrap();
        assert!(made.success(), "mkfifo {}", path.display());
    }

    /// `open_session_file` decides at the open, not by the check it makes
    /// first: a file swapped right after that check for a link out of the
    /// root, or for a FIFO, is refused, and the FIFO does not block the open
    /// (#698).
    #[test]
    #[serial_test::serial]
    fn open_session_file_refuses_a_file_swapped_after_its_check() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let session = root.join("p").join("s1.jsonl");
        let secret = outside.path().join("secret.jsonl");
        fs::write(&secret, "{\"secret\":true}\n").unwrap();

        let mut opened = Vec::new();
        for swap in ["link", "fifo"] {
            touch(&session);
            let (at, target) = (session.clone(), secret.clone());
            swap_after_check::arm(&session, move || {
                fs::remove_file(&at).unwrap();
                if swap == "link" {
                    symlink(&target, &at).unwrap();
                } else {
                    mkfifo(&at);
                }
            });
            let (sent, received) = std::sync::mpsc::channel();
            let (path, within) = (session.clone(), root.clone());
            std::thread::spawn(move || sent.send(open_session_file(&path, &within).is_ok()));
            let result = match received.recv_timeout(std::time::Duration::from_secs(10)) {
                Ok(true) => "read",
                Ok(false) => "refused",
                Err(_) => {
                    // Release the open blocked on the FIFO.
                    let fifo = session.clone();
                    std::thread::spawn(move || fs::OpenOptions::new().write(true).open(fifo));
                    "stalled"
                }
            };
            opened.push((swap, swap_after_check::disarm(), result));
            fs::remove_file(&session).unwrap();
        }
        assert_eq!(
            opened,
            [("link", true, "refused"), ("fifo", true, "refused")]
        );
    }
}
