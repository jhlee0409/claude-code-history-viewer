use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistro {
    pub name: String,
    pub is_default: bool,
}

/// Convert Linux path to \\wsl.localhost\{distro}\{path}
pub fn build_unc_path(distro: &str, linux_path: &Path) -> PathBuf {
    let linux_str = linux_path.to_string_lossy().replace('/', "\\");
    let linux_str = linux_str.trim_start_matches('\\').to_string();
    PathBuf::from(format!(r"\\wsl.localhost\{distro}\{linux_str}"))
}

/// Fallback: \\wsl$\{distro}\{path}
pub fn build_unc_path_fallback(distro: &str, linux_path: &Path) -> PathBuf {
    let linux_str = linux_path.to_string_lossy().replace('/', "\\");
    let linux_str = linux_str.trim_start_matches('\\').to_string();
    PathBuf::from(format!(r"\\wsl$\{distro}\{linux_str}"))
}

#[cfg(target_os = "windows")]
pub fn is_wsl_available() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss")
        .is_ok()
}

#[cfg(not(target_os = "windows"))]
pub fn is_wsl_available() -> bool {
    false
}

#[cfg(target_os = "windows")]
pub fn detect_distros() -> Vec<WslDistro> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let lxss = match hkcu.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss") {
        Ok(key) => key,
        Err(_) => return Vec::new(),
    };

    let default_guid: String = lxss.get_value("DefaultDistribution").unwrap_or_default();
    let mut distros = Vec::new();

    for subkey_name in lxss.enum_keys().filter_map(Result::ok) {
        let subkey = match lxss.open_subkey(&subkey_name) {
            Ok(k) => k,
            Err(_) => continue,
        };
        let name: String = match subkey.get_value("DistributionName") {
            Ok(n) => n,
            Err(_) => continue,
        };
        distros.push(WslDistro {
            name,
            is_default: subkey_name == default_guid,
        });
    }
    distros.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.name.cmp(&b.name))
    });
    distros
}

#[cfg(not(target_os = "windows"))]
pub fn detect_distros() -> Vec<WslDistro> {
    Vec::new()
}

#[cfg(target_os = "windows")]
pub fn resolve_home_path(distro: &str) -> Result<PathBuf, String> {
    use std::process::Command;

    if !distro
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(format!("Invalid distro name: {distro}"));
    }

    let output = Command::new("wsl")
        .args(["-d", distro, "-e", "sh", "-c", "echo $HOME"])
        .output()
        .map_err(|e| format!("Failed to run wsl command: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "WSL command failed for distro '{distro}': {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let home_str = String::from_utf8(output.stdout.clone())
        .or_else(|_| decode_utf16le(&output.stdout))
        .map_err(|e| format!("Failed to decode WSL output: {e}"))?;

    let home_str = home_str.trim();
    if home_str.is_empty() {
        return Err(format!("Empty home path for distro '{distro}'"));
    }
    Ok(PathBuf::from(home_str))
}

#[cfg(not(target_os = "windows"))]
pub fn resolve_home_path(_distro: &str) -> Result<PathBuf, String> {
    Err("WSL is only available on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn decode_utf16le(bytes: &[u8]) -> Result<String, String> {
    let bytes = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        &bytes[2..]
    } else {
        bytes
    };
    if bytes.len() % 2 != 0 {
        return Err("Odd byte count for UTF-16LE".to_string());
    }
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    String::from_utf16(&u16s)
        .map(|s| s.replace('\0', ""))
        .map_err(|e| format!("UTF-16LE decode error: {e}"))
}

pub fn resolve_wsl_provider_path(distro: &str, linux_path: &Path) -> Option<PathBuf> {
    let primary = build_unc_path(distro, linux_path);
    if primary.exists() {
        return Some(primary);
    }
    let fallback = build_unc_path_fallback(distro, linux_path);
    if fallback.exists() {
        return Some(fallback);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_unc_path_converts_linux_path() {
        let result = build_unc_path("Ubuntu", Path::new("/home/user/.claude"));
        assert_eq!(
            result,
            PathBuf::from(r"\\wsl.localhost\Ubuntu\home\user\.claude")
        );
    }

    #[test]
    fn build_unc_path_fallback_uses_wsl_dollar() {
        let result = build_unc_path_fallback("Debian", Path::new("/home/dev/.codex"));
        assert_eq!(result, PathBuf::from(r"\\wsl$\Debian\home\dev\.codex"));
    }

    #[test]
    fn build_unc_path_handles_root_path() {
        let result = build_unc_path("Ubuntu", Path::new("/"));
        assert_eq!(result, PathBuf::from(r"\\wsl.localhost\Ubuntu\"));
    }

    #[test]
    fn build_unc_path_handles_nested_path() {
        let result = build_unc_path("Ubuntu", Path::new("/home/user/.local/share/opencode"));
        assert_eq!(
            result,
            PathBuf::from(r"\\wsl.localhost\Ubuntu\home\user\.local\share\opencode")
        );
    }

    #[test]
    fn is_wsl_available_returns_false_on_non_windows() {
        if !cfg!(target_os = "windows") {
            assert!(!is_wsl_available());
        }
    }

    #[test]
    fn detect_distros_returns_empty_on_non_windows() {
        if !cfg!(target_os = "windows") {
            assert!(detect_distros().is_empty());
        }
    }
}
