use super::ProviderInfo;

/// Detect Claude Code installation
pub fn detect() -> Option<ProviderInfo> {
    let home = dirs::home_dir()?;
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
    let home = dirs::home_dir()?;
    let claude_path = home.join(".claude");
    if claude_path.exists() {
        Some(claude_path.to_string_lossy().to_string())
    } else {
        None
    }
}
