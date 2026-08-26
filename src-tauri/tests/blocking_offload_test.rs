//! #516. The heavy read commands were declared `async` while doing entirely
//! synchronous work — `WalkDir`, then mmap and a line scan of every JSONL file
//! — so the async runtime was held for the length of a scan. On a large project
//! that was a visible stall, and under `--serve` a remote caller chose when it
//! happened.
//!
//! These pin the offload rather than the timing. On a current-thread runtime a
//! future that never yields cannot let another task run: an `async fn` whose
//! body contains no `.await` is polled once, returns `Ready`, and awaiting it
//! never reaches the scheduler. Awaiting a `spawn_blocking` join handle is
//! `Pending` on the first poll, so it does.
//!
//! So "did an already-queued task get to run?" is a decisive, timing-free test
//! of whether the work left the runtime thread. It fails on every one of these
//! commands before the fix and passes after, and it needs no large fixture:
//! what is being observed is the yield, not the work.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use claude_code_history_viewer_lib::commands;

/// Queue a task, run `f`, and report whether the task got to run.
///
/// `tokio::spawn` only makes the task runnable; on a current-thread runtime it
/// cannot make progress until something yields.
async fn yielded_during<F, T>(f: F) -> bool
where
    F: Future<Output = T>,
{
    let ran = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&ran);
    tokio::spawn(async move {
        flag.store(true, Ordering::SeqCst);
    });

    let _ = f.await;
    ran.load(Ordering::SeqCst)
}

/// A path that exists but holds nothing. The commands still take their full
/// path through `spawn_blocking`; the assertion is about where the work runs,
/// not how much of it there is.
fn empty_root() -> tempfile::TempDir {
    tempfile::TempDir::new().expect("temp dir")
}

#[tokio::test]
async fn get_recent_edits_leaves_the_runtime_free() {
    let root = empty_root();
    let path = root.path().to_string_lossy().to_string();

    assert!(
        yielded_during(commands::session::get_recent_edits(
            path, None, None, None, None
        ))
        .await,
        "get_recent_edits held the runtime thread for the whole scan"
    );
}

#[tokio::test]
async fn scan_projects_leaves_the_runtime_free() {
    let root = empty_root();
    let path = root.path().to_string_lossy().to_string();

    assert!(
        yielded_during(commands::project::scan_projects(path)).await,
        "scan_projects held the runtime thread for the whole scan"
    );
}

#[tokio::test]
async fn load_project_sessions_page_leaves_the_runtime_free() {
    let root = empty_root();
    let path = root.path().to_string_lossy().to_string();

    assert!(
        yielded_during(commands::session::load_project_sessions_page(
            path, None, None, None
        ))
        .await,
        "load_project_sessions_page held the runtime thread for the whole load"
    );
}

#[tokio::test]
async fn load_project_sessions_leaves_the_runtime_free() {
    let root = empty_root();
    let path = root.path().to_string_lossy().to_string();

    assert!(
        yielded_during(commands::session::load_project_sessions(path, None)).await,
        "load_project_sessions held the runtime thread for the whole load"
    );
}

#[tokio::test]
async fn search_messages_leaves_the_runtime_free() {
    let root = empty_root();
    let path = root.path().to_string_lossy().to_string();

    assert!(
        yielded_during(commands::session::search_messages(
            path,
            "needle".to_string(),
            serde_json::json!({}),
            None,
        ))
        .await,
        "search_messages held the runtime thread for the whole search"
    );
}

/// The control. `get_claude_folder_path` is deliberately *not* offloaded — two
/// stat calls on the home directory, where a task spawn would cost more than it
/// saves. If someone later wraps it, this test says so rather than letting the
/// pattern spread by habit.
#[tokio::test]
async fn trivial_commands_are_deliberately_not_offloaded() {
    assert!(
        !yielded_during(commands::project::get_claude_folder_path()).await,
        "get_claude_folder_path is now offloading; either that is deliberate \
         (update this test and say why) or the pattern was applied by habit"
    );
}
