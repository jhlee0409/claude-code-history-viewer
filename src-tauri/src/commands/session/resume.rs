use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalInvocation {
    pub program: String,
    pub args: Vec<String>,
    pub current_dir: Option<String>,
}

/// The exact set of resume-command shapes emitted by the frontend
/// `getResumeCommand` (bare form, without the `cd <cwd> &&` prefix). We accept
/// only these so the command cannot be used to launch an arbitrary program: a
/// pure character filter would still allow `sh`, `bash -c id`, `sleep 999`, etc.,
/// and the `WebUI` HTTP route forwards this value straight to a terminal shell.
/// Each prefix is followed by a session id (`[A-Za-z0-9_-]+`).
const RESUME_COMMAND_PREFIXES: &[&str] = &[
    "claude --resume ",
    "codex resume ",
    "copilot --resume=",
    "forge conversation resume ",
    "kimi -r ",
    "vibe --resume ",
];

fn is_session_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Accept only a recognized `<cli> <resume-args> <session-id>` invocation.
fn validate_resume_command(command: &str) -> Result<(), String> {
    if command.len() > 512 {
        return Err("Resume command is too long".to_string());
    }
    for prefix in RESUME_COMMAND_PREFIXES {
        if let Some(session_id) = command.strip_prefix(prefix) {
            if is_session_id(session_id) {
                return Ok(());
            }
            return Err("Resume command has an invalid session id".to_string());
        }
    }
    Err("Not a recognized resume command".to_string())
}

/// Validate a caller-supplied working directory. `None` (no directory supplied)
/// is allowed; a supplied value must be an existing absolute directory. We
/// reject relative/missing paths rather than silently dropping them — dropping
/// would run the command in the app's own directory instead of the project.
fn validate_cwd(cwd: Option<String>) -> Result<Option<String>, String> {
    match cwd {
        None => Ok(None),
        Some(dir) => {
            let path = Path::new(&dir);
            if path.is_absolute() && path.is_dir() {
                Ok(Some(dir))
            } else {
                Err("Working directory must be an existing absolute path".to_string())
            }
        }
    }
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn windows_invocation(command: &str, cwd: Option<&str>) -> TerminalInvocation {
    TerminalInvocation {
        program: "cmd".to_string(),
        args: vec![
            "/C".to_string(),
            "start".to_string(),
            String::new(),
            "cmd".to_string(),
            "/K".to_string(),
            command.to_string(),
        ],
        current_dir: cwd.map(str::to_string),
    }
}

pub fn macos_invocation(command: &str, cwd: Option<&str>) -> TerminalInvocation {
    let inner = cwd
        .map(|dir| format!("cd {} && {command}", shell_single_quote(dir)))
        .unwrap_or_else(|| command.to_string());
    let script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        applescript_string(&inner)
    );

    TerminalInvocation {
        program: "osascript".to_string(),
        args: vec!["-e".to_string(), script],
        current_dir: None,
    }
}

/// Ordered Linux terminal candidates. `x-terminal-emulator` only exists on
/// Debian-family systems (via `update-alternatives`), so we fall back to the
/// common emulators — each with its own "run this command" flag — and let the
/// caller try them in order until one launches.
pub fn linux_invocations(command: &str, cwd: Option<&str>) -> Vec<TerminalInvocation> {
    let current_dir = cwd.map(str::to_string);
    let candidates: &[(&str, &[&str])] = &[
        ("x-terminal-emulator", &["-e", "sh", "-c"]),
        ("gnome-terminal", &["--", "sh", "-c"]),
        ("konsole", &["-e", "sh", "-c"]),
        ("xfce4-terminal", &["-x", "sh", "-c"]),
        ("alacritty", &["-e", "sh", "-c"]),
        ("kitty", &["sh", "-c"]),
        ("xterm", &["-e", "sh", "-c"]),
    ];

    candidates
        .iter()
        .map(|(program, flags)| {
            let mut args: Vec<String> = flags.iter().map(|s| (*s).to_string()).collect();
            args.push(command.to_string());
            TerminalInvocation {
                program: (*program).to_string(),
                args,
                current_dir: current_dir.clone(),
            }
        })
        .collect()
}

/// Platform terminal invocations to try in order: one for Windows/macOS, several
/// fallbacks for Linux.
pub fn terminal_invocations(command: &str, cwd: Option<&str>) -> Vec<TerminalInvocation> {
    if cfg!(target_os = "windows") {
        vec![windows_invocation(command, cwd)]
    } else if cfg!(target_os = "macos") {
        vec![macos_invocation(command, cwd)]
    } else {
        linux_invocations(command, cwd)
    }
}

#[tauri::command]
pub async fn open_resume_in_terminal(command: String, cwd: Option<String>) -> Result<(), String> {
    validate_resume_command(&command)?;
    let cwd = validate_cwd(cwd)?;

    let invocations = terminal_invocations(&command, cwd.as_deref());
    let mut last_error: Option<String> = None;

    for invocation in invocations {
        let mut child = Command::new(&invocation.program);
        child.args(&invocation.args);
        if let Some(dir) = &invocation.current_dir {
            child.current_dir(dir);
        }
        match child.spawn() {
            Ok(_) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Terminal emulator not installed; try the next candidate.
                last_error = Some(format!("{}: {e}", invocation.program));
            }
            Err(e) => return Err(format!("Failed to open terminal: {e}")),
        }
    }

    Err(format!(
        "No supported terminal emulator found ({})",
        last_error.unwrap_or_else(|| "no candidates".to_string())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validator_accepts_supported_resume_shapes() {
        for command in [
            "claude --resume abc_123",
            "codex resume abc-123",
            "copilot --resume=abc_123",
            "forge conversation resume abc123",
            "kimi -r abc123",
            "vibe --resume abc123",
        ] {
            assert!(validate_resume_command(command).is_ok(), "{command}");
        }
    }

    #[test]
    fn validator_rejects_arbitrary_executables() {
        for command in [
            "sh",
            "bash -c id",
            "sleep 999",
            "copilot",           // no session id
            "copilot --resume=", // empty id
            "claude --resume ",  // empty id
            "echo hello",
            "cmd",
        ] {
            assert!(validate_resume_command(command).is_err(), "{command:?}");
        }
    }

    #[test]
    fn validator_rejects_shell_metacharacters() {
        for command in [
            "copilot --resume=x; rm -rf ~",
            "claude --resume `whoami`",
            "kimi -r x && y",
            "vibe --resume x | y",
            "codex resume $(x)",
            "copilot --resume=x\"y",
            "kimi -r x\ny",
        ] {
            assert!(validate_resume_command(command).is_err(), "{command:?}");
        }
    }

    #[test]
    fn validator_rejects_overlong_commands() {
        let long = format!("copilot --resume={}", "a".repeat(600));
        assert!(validate_resume_command(&long).is_err());
    }

    #[test]
    fn cwd_validation_rejects_relative_and_missing() {
        assert_eq!(validate_cwd(None), Ok(None));
        assert!(validate_cwd(Some("relative/path".to_string())).is_err());
        assert!(validate_cwd(Some("/no/such/dir/hopefully/98765".to_string())).is_err());

        let tmp = std::env::temp_dir().to_string_lossy().to_string();
        assert_eq!(validate_cwd(Some(tmp.clone())), Ok(Some(tmp)));
    }

    #[test]
    fn windows_builder_returns_expected_invocation() {
        let command = "copilot --resume=abc123";
        assert_eq!(
            windows_invocation(command, Some("C:\\work")),
            TerminalInvocation {
                program: "cmd".to_string(),
                args: vec![
                    "/C".to_string(),
                    "start".to_string(),
                    String::new(),
                    "cmd".to_string(),
                    "/K".to_string(),
                    command.to_string(),
                ],
                current_dir: Some("C:\\work".to_string()),
            }
        );
        assert_eq!(windows_invocation(command, None).current_dir, None);
    }

    #[test]
    fn macos_builder_escapes_cwd_for_shell_and_applescript() {
        let invocation = macos_invocation("claude --resume abc123", Some("/Users/test/a'b\\c"));
        assert_eq!(
            invocation.args[1],
            "tell application \"Terminal\" to do script \"cd '/Users/test/a'\\\\''b\\\\c' && claude --resume abc123\""
        );
    }

    #[test]
    fn macos_builder_without_cwd() {
        assert_eq!(
            macos_invocation("claude --resume abc123", None).args[1],
            "tell application \"Terminal\" to do script \"claude --resume abc123\""
        );
    }

    #[test]
    fn linux_invocations_list_common_terminals_in_order() {
        let invs = linux_invocations("vibe --resume abc123", Some("/home/test/work"));
        let programs: Vec<&str> = invs.iter().map(|i| i.program.as_str()).collect();
        assert_eq!(
            programs,
            vec![
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "alacritty",
                "kitty",
                "xterm",
            ]
        );
        for inv in &invs {
            assert_eq!(inv.args.last().unwrap(), "vibe --resume abc123");
            assert_eq!(inv.current_dir.as_deref(), Some("/home/test/work"));
        }
        let gnome = invs.iter().find(|i| i.program == "gnome-terminal").unwrap();
        assert_eq!(gnome.args, vec!["--", "sh", "-c", "vibe --resume abc123"]);
    }

    #[test]
    fn terminal_invocations_is_nonempty() {
        assert!(!terminal_invocations("kimi -r abc", None).is_empty());
    }
}
