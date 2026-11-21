//! Backend logging (#821). Without a logger every `log::` call was a no-op,
//! so a user hitting a hang or missing data had nothing to attach.
//!
//! - Desktop: [`desktop_plugin`] writes to the OS app log directory
//!   (`app_log_dir()`, e.g. `~/Library/Logs/com.claude.history-viewer` on
//!   macOS, `%LOCALAPPDATA%\com.claude.history-viewer\logs` on Windows), plus
//!   stderr in debug builds. Each record is flushed as it is written, so a
//!   hard freeze keeps the lines before it.
//! - `cchv-server`: [`init_stderr`] logs to stderr, level from `RUST_LOG`.
//! - Both write `[date][time][target][LEVEL] message`, time in UTC.
//!
//! This crate logs at `info` and above; other crates at `warn`. Log paths and
//! errors only, never conversation content or credentials.

use log::{LevelFilter, Log, Metadata, Record};

/// This crate's log target prefix (`claude_code_history_viewer_lib::…`).
const CRATE_TARGET: &str = env!("CARGO_CRATE_NAME");

/// Level for this crate's records unless `RUST_LOG` says otherwise.
const DEFAULT_LEVEL: LevelFilter = LevelFilter::Info;

/// Level for other crates' records (webview, HTTP stack, …).
const DEPENDENCY_LEVEL: LevelFilter = LevelFilter::Warn;

/// A log file is rotated at this size; [`KEPT_LOG_FILES`] are kept.
const MAX_LOG_FILE_BYTES: u128 = 2 * 1024 * 1024;
const KEPT_LOG_FILES: usize = 3;

/// The desktop log plugin: rotating file in the app log directory, and
/// stderr in debug builds.
pub fn desktop_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

    let mut targets = vec![Target::new(TargetKind::LogDir { file_name: None })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stderr));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(DEPENDENCY_LEVEL)
        .level_for(CRATE_TARGET, DEFAULT_LEVEL)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_LOG_FILES))
        .build()
}

/// Log a panic before the default hook reports it, so it reaches the log
/// file of a release build that has no console.
pub fn log_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        log::logger().flush();
        previous(info);
    }));
}

/// Open the app log directory in the file manager (Help → Open Log Folder).
#[tauri::command]
pub fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_opener::OpenerExt;

    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Log to stderr (`cchv-server`). `RUST_LOG` sets this crate's level
/// (`error`, `warn`, `info`, `debug`, `trace`, `off`); default `info`.
pub fn init_stderr() {
    let level = std::env::var("RUST_LOG")
        .ok()
        .and_then(|value| parse_level(&value))
        .unwrap_or(DEFAULT_LEVEL);
    if log::set_boxed_logger(Box::new(StderrLogger { level })).is_ok() {
        log::set_max_level(level.max(DEPENDENCY_LEVEL));
    }
}

/// A bare level name; anything else (such as `env_logger` directives) is
/// ignored and the default applies.
fn parse_level(value: &str) -> Option<LevelFilter> {
    value.trim().parse().ok()
}

struct StderrLogger {
    level: LevelFilter,
}

impl StderrLogger {
    fn level_for(&self, target: &str) -> LevelFilter {
        let ours = target
            .strip_prefix(CRATE_TARGET)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with("::"));
        if ours {
            self.level
        } else {
            DEPENDENCY_LEVEL
        }
    }
}

impl Log for StderrLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= self.level_for(metadata.target())
    }

    fn log(&self, record: &Record<'_>) {
        if self.enabled(record.metadata()) {
            eprintln!(
                "{}[{}][{}] {}",
                chrono::Utc::now().format("[%Y-%m-%d][%H:%M:%S]"),
                record.target(),
                record.level(),
                record.args()
            );
        }
    }

    fn flush(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_crate_logs_at_its_level_and_dependencies_at_warn() {
        let logger = StderrLogger {
            level: LevelFilter::Debug,
        };
        let ours = format!("{CRATE_TARGET}::commands::watcher");
        assert_eq!(logger.level_for(&ours), LevelFilter::Debug);
        assert_eq!(logger.level_for(CRATE_TARGET), LevelFilter::Debug);
        assert_eq!(logger.level_for("tower_http::trace"), LevelFilter::Warn);
        // A crate whose name only starts with ours is not ours.
        assert_eq!(
            logger.level_for(&format!("{CRATE_TARGET}_extra")),
            LevelFilter::Warn
        );
    }
}
