use tauri::AppHandle;

/// Force-quits the current app process and spawns a detached helper that
/// re-launches the app after the current process exits.
///
/// Used as a fallback for Tauri v2's `relaunch()` plugin which has known
/// upstream bugs on macOS (tauri-apps/tauri#13923, #11392, #8472) — after a
/// successful download and install, the relaunch step sometimes fails and the
/// user is stranded on the old binary even though the new bundle is on disk.
#[tauri::command]
pub fn force_quit_and_relaunch(app: AppHandle) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        let app_bundle = current_exe
            .ancestors()
            .find(|p| p.extension().and_then(|s| s.to_str()) == Some("app"))
            .ok_or_else(|| "no .app bundle in current_exe ancestors".to_string())?;

        let bundle_str = app_bundle.to_string_lossy();
        let cmd = format!("sleep 1 && open -n {}", shell_escape(&bundle_str));
        std::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .spawn()
            .map_err(|e| format!("failed to spawn relaunch helper: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        let exe = current_exe.to_string_lossy().into_owned();
        std::process::Command::new("cmd")
            .args([
                "/C",
                &format!("ping -n 2 127.0.0.1 > nul && start \"\" \"{exe}\""),
            ])
            .spawn()
            .map_err(|e| format!("failed to spawn relaunch helper: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        let exe = current_exe.to_string_lossy().into_owned();
        let cmd = format!("sleep 1 && {} &", shell_escape(&exe));
        std::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .spawn()
            .map_err(|e| format!("failed to spawn relaunch helper: {e}"))?;
    }

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        app.exit(0);
    });

    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    use super::shell_escape;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn shell_escape_wraps_in_single_quotes() {
        assert_eq!(
            shell_escape("/Applications/My App.app"),
            "'/Applications/My App.app'"
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn shell_escape_escapes_embedded_single_quotes() {
        assert_eq!(shell_escape("a'b"), "'a'\\''b'");
    }
}
