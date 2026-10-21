use super::ProviderInfo;
use std::path::PathBuf;

/// Detect Claude Code installation
pub fn detect() -> Option<ProviderInfo> {
    let home = crate::utils::home_dir()?;
    let claude_path = home.join(".claude");
    let projects_path = claude_path.join("projects");

    Some(ProviderInfo {
        id: "claude".to_string(),
        display_name: "Claude Code".to_string(),
        base_path: claude_path.to_string_lossy().to_string(),
        is_available: projects_path.exists() && projects_path.is_dir(),
    })
}

/// Get the Claude base path (~/.claude)
pub fn get_base_path() -> Option<String> {
    let home = crate::utils::home_dir()?;
    let claude_path = home.join(".claude");
    if claude_path.exists() {
        Some(claude_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// The Claude base directory (`~/.claude`-shaped) a request names. Empty
/// means the default root, `~/.claude`, as the HTTP root guard reads it
/// (`require_claude_base`: "empty means use the default"), never a
/// `projects/` folder relative to the working directory; `None` when this
/// machine has no default root (#693). Any other value is used as given.
pub fn base_path_or_default(claude_path: &str) -> Option<PathBuf> {
    if claude_path.is_empty() {
        get_base_path().map(PathBuf::from)
    } else {
        Some(PathBuf::from(claude_path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::SandboxHome;
    use serial_test::serial;

    /// #693: the HTTP root guard lets an empty `claude_path` through as "use
    /// the default", so it must resolve to `~/.claude`, never to a path
    /// relative to the working directory.
    #[test]
    #[serial]
    fn an_empty_claude_path_is_the_default_root() {
        let home = SandboxHome::new();
        let default_root = home.path().join(".claude");
        std::fs::create_dir_all(&default_root).unwrap();

        assert_eq!(base_path_or_default(""), Some(default_root.clone()));
        let named = home.path().join("elsewhere").join(".claude");
        assert_eq!(
            base_path_or_default(&named.to_string_lossy()),
            Some(named.clone())
        );

        // No default root on this machine: nothing to read, not `./projects`.
        std::fs::remove_dir_all(&default_root).unwrap();
        assert_eq!(base_path_or_default(""), None);
        assert_eq!(base_path_or_default(&named.to_string_lossy()), Some(named));
    }
}
