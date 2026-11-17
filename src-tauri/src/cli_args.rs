//! Shared argv flag parsing helpers.
//!
//! The desktop binary and the `webui-server` feature both need to pluck
//! `--flag value` or `--flag=value` pairs out of `std::env::args()`. Prior to
//! unification there were two near-duplicate implementations: `cli.rs`'s
//! private helper (always compiled, used for `--session`) and `lib.rs::parse_cli_flag`
//! (feature-gated for webui-server, used for `--port`, `--host`, `--dist`,
//! `--token`). The feature-gated version had a latent bug where `--flag=`
//! (empty value) returned `Some("")` instead of `None`. This module is the
//! single canonical implementation.

/// True if the user passed the flag with an explicitly empty value — either
/// `--flag=` (empty equals) or a bare `--flag` with no value after it or
/// followed immediately by another `--flag`. Useful for distinguishing "flag
/// was intentionally misconfigured" from "flag was omitted" when both return
/// `None` from [`extract_flag_value`].
#[must_use]
pub fn has_explicit_empty_flag(args: &[String], flag: &str) -> bool {
    let prefix = format!("{flag}=");
    args.iter().enumerate().any(|(idx, arg)| {
        if arg == &prefix {
            return true;
        }
        if arg == flag {
            return match args.get(idx + 1) {
                None => true,
                Some(next) => next.starts_with("--"),
            };
        }
        false
    })
}

/// Extract the value of `--flag=value` or `--flag value` from argv.
///
/// A flag without a following value, followed by another flag starting with
/// `--`, or using the `--flag=` empty-equals form, yields `None`.
#[must_use]
pub fn extract_flag_value(args: &[String], flag: &str) -> Option<String> {
    let prefix = format!("{flag}=");
    for (idx, arg) in args.iter().enumerate() {
        if let Some(after) = arg.strip_prefix(&prefix) {
            if after.is_empty() {
                return None;
            }
            return Some(after.to_string());
        }
        if arg == flag {
            return args
                .get(idx + 1)
                .filter(|next| !next.starts_with("--"))
                .cloned();
        }
    }
    None
}

/// Hidden, test-only `--serve` flag that skips the live file watcher.
///
/// The UI capture harness (`scripts/ui-capture`) serves a frozen fixture home
/// and needs the data set to stay still for the whole run; a watcher event
/// mid-capture would reload a view and break same-commit reproducibility.
/// Deliberately left out of the README / help text: it is not a user option,
/// and the default (watcher on) is unchanged when the flag is absent.
pub const NO_WATCH_FLAG: &str = "--no-watch";

/// Whether the `--serve` file watcher should start for this argv.
///
/// Only the exact bare [`NO_WATCH_FLAG`] disables it — a value form such as
/// `--no-watch=1` or a longer flag sharing the prefix leaves it on, so a typo
/// can never silently turn live updates off.
#[must_use]
pub fn server_file_watcher_enabled(args: &[String]) -> bool {
    !args.iter().any(|arg| arg == NO_WATCH_FLAG)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn space_form_returns_value() {
        let args = argv(&["app", "--port", "3001"]);
        assert_eq!(extract_flag_value(&args, "--port"), Some("3001".into()));
    }

    #[test]
    fn equals_form_returns_value() {
        let args = argv(&["app", "--host=127.0.0.1"]);
        assert_eq!(
            extract_flag_value(&args, "--host"),
            Some("127.0.0.1".into())
        );
    }

    #[test]
    fn absent_flag_returns_none() {
        let args = argv(&["app", "--other"]);
        assert_eq!(extract_flag_value(&args, "--port"), None);
    }

    #[test]
    fn flag_without_value_returns_none() {
        let args = argv(&["app", "--port"]);
        assert_eq!(extract_flag_value(&args, "--port"), None);
    }

    #[test]
    fn flag_followed_by_other_flag_returns_none() {
        let args = argv(&["app", "--port", "--host"]);
        assert_eq!(extract_flag_value(&args, "--port"), None);
    }

    #[test]
    fn empty_equals_form_returns_none() {
        // Regression: the previous `lib.rs::parse_cli_flag` returned `Some("")` here.
        let args = argv(&["app", "--port="]);
        assert_eq!(extract_flag_value(&args, "--port"), None);
    }

    #[test]
    fn round_trip_port() {
        assert_eq!(
            extract_flag_value(&argv(&["--port=8080"]), "--port"),
            Some("8080".into())
        );
        assert_eq!(
            extract_flag_value(&argv(&["--port", "8080"]), "--port"),
            Some("8080".into())
        );
    }

    #[test]
    fn round_trip_host() {
        assert_eq!(
            extract_flag_value(&argv(&["--host=0.0.0.0"]), "--host"),
            Some("0.0.0.0".into())
        );
    }

    #[test]
    fn round_trip_dist() {
        assert_eq!(
            extract_flag_value(&argv(&["--dist", "/tmp/dist"]), "--dist"),
            Some("/tmp/dist".into())
        );
    }

    #[test]
    fn round_trip_token() {
        assert_eq!(
            extract_flag_value(&argv(&["--token=abc123"]), "--token"),
            Some("abc123".into())
        );
    }

    #[test]
    fn has_explicit_empty_flag_detects_equals_form() {
        assert!(has_explicit_empty_flag(
            &argv(&["app", "--token="]),
            "--token"
        ));
    }

    #[test]
    fn has_explicit_empty_flag_detects_bare_flag_at_end() {
        assert!(has_explicit_empty_flag(
            &argv(&["app", "--token"]),
            "--token"
        ));
    }

    #[test]
    fn has_explicit_empty_flag_detects_flag_followed_by_other_flag() {
        assert!(has_explicit_empty_flag(
            &argv(&["app", "--token", "--no-auth"]),
            "--token"
        ));
    }

    #[test]
    fn has_explicit_empty_flag_false_when_flag_absent() {
        assert!(!has_explicit_empty_flag(
            &argv(&["app", "--serve"]),
            "--token"
        ));
    }

    #[test]
    fn file_watcher_runs_by_default() {
        assert!(server_file_watcher_enabled(&argv(&["app", "--serve"])));
        assert!(server_file_watcher_enabled(&argv(&["app"])));
    }

    #[test]
    fn no_watch_flag_disables_file_watcher() {
        assert!(!server_file_watcher_enabled(&argv(&[
            "app",
            "--serve",
            "--no-watch"
        ])));
    }

    #[test]
    fn no_watch_flag_matches_only_the_bare_flag() {
        // A value form or a longer flag sharing the prefix must not silently
        // disable live updates; only the exact test-only flag does.
        for arg in ["--no-watch=1", "--no-watcher", "--no-watch-dir", "no-watch"] {
            assert!(
                server_file_watcher_enabled(&argv(&["app", "--serve", arg])),
                "{arg} must not disable the watcher"
            );
        }
    }

    #[test]
    fn no_watch_flag_does_not_disturb_other_server_flags() {
        // The capture harness passes `--no-watch` right after `--dist <dir>`;
        // the bare flag must neither be taken as a value nor swallow one.
        let args = argv(&[
            "app",
            "--serve",
            "--no-auth",
            "--host",
            "127.0.0.1",
            "--port",
            "4100",
            "--dist",
            "/tmp/dist",
            NO_WATCH_FLAG,
        ]);
        assert!(!server_file_watcher_enabled(&args));
        assert_eq!(
            extract_flag_value(&args, "--dist"),
            Some("/tmp/dist".into())
        );
        assert_eq!(extract_flag_value(&args, "--port"), Some("4100".into()));
        assert_eq!(
            extract_flag_value(&args, "--host"),
            Some("127.0.0.1".into())
        );
        assert_eq!(extract_flag_value(&args, NO_WATCH_FLAG), None);
    }

    #[test]
    fn has_explicit_empty_flag_false_when_flag_has_value() {
        assert!(!has_explicit_empty_flag(
            &argv(&["app", "--token", "abc"]),
            "--token"
        ));
        assert!(!has_explicit_empty_flag(
            &argv(&["app", "--token=abc"]),
            "--token"
        ));
    }
}
