use std::process::Stdio;
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags
#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// Force-quits the current app process and spawns a detached helper that
/// re-launches the app after the current process exits.
///
/// Used as a fallback for Tauri v2's `relaunch()` plugin which has known
/// upstream bugs on macOS (tauri-apps/tauri#13923, #11392, #8472) — after a
/// successful download and install, the relaunch step sometimes fails and the
/// user is stranded on the old binary even though the new bundle is on disk.
///
/// The helper polls the parent PID and only relaunches once the parent has
/// fully exited. This is required because `tauri-plugin-single-instance` would
/// otherwise see the parent still running, refocus its window, and let the new
/// process exit without applying the update.
#[tauri::command]
pub fn force_quit_and_relaunch(app: AppHandle) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
    let ppid = std::process::id();

    log::info!(
        "[updater] force_quit_and_relaunch ppid={ppid} exe={}",
        current_exe.display()
    );

    #[cfg(target_os = "macos")]
    {
        let app_bundle = current_exe
            .ancestors()
            .find(|p| p.extension().and_then(|s| s.to_str()) == Some("app"))
            .ok_or_else(|| "no .app bundle in current_exe ancestors".to_string())?;

        let bundle_str = app_bundle.to_string_lossy();
        let cmd = format!(
            "i=0; while kill -0 {ppid} 2>/dev/null && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done; sleep 0.3; open -n {app}",
            ppid = ppid,
            app = shell_escape(&bundle_str)
        );
        log::info!("[updater] spawning macOS relaunch helper for {bundle_str}");
        spawn_detached_sh(&cmd)?;
    }

    #[cfg(target_os = "windows")]
    {
        // Spawn via PowerShell so we can `Wait-Process` on the parent PID and
        // then `Start-Process` the exe directly. Avoiding `cmd /C "start"` is
        // deliberate: cmd performs `%VAR%` expansion even inside double quotes,
        // which corrupts exe paths containing a literal `%`.
        let exe_str = current_exe.to_string_lossy().into_owned();
        // PowerShell single-quoted strings: escape `'` as `''`.
        let exe_ps = exe_str.replace('\'', "''");
        let ps_cmd = format!(
            "Wait-Process -Id {ppid} -ErrorAction SilentlyContinue -Timeout 30; \
             Start-Sleep -Milliseconds 300; \
             Start-Process -FilePath '{exe}'",
            ppid = ppid,
            exe = exe_ps
        );
        log::info!("[updater] spawning Windows relaunch helper");
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_cmd])
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                let msg = format!("failed to spawn relaunch helper: {e}");
                log::error!("[updater] {msg}");
                msg
            })?;
    }

    #[cfg(target_os = "linux")]
    {
        let exe_str = current_exe.to_string_lossy().into_owned();
        let cmd = format!(
            "i=0; while kill -0 {ppid} 2>/dev/null && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done; sleep 0.3; setsid {exe} >/dev/null 2>&1 < /dev/null &",
            ppid = ppid,
            exe = shell_escape(&exe_str)
        );
        log::info!("[updater] spawning Linux relaunch helper");
        spawn_detached_sh(&cmd)?;
    }

    log::info!("[updater] scheduling app.exit(0) in 200ms");
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        app.exit(0);
    });

    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn spawn_detached_sh(cmd: &str) -> Result<(), String> {
    std::process::Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            let msg = format!("failed to spawn relaunch helper: {e}");
            log::error!("[updater] {msg}");
            msg
        })
        .map(|_| ())
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
