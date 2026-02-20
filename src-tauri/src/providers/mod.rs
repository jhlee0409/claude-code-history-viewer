use serde::{Deserialize, Serialize};

pub mod claude;
pub mod codex;
pub mod opencode;

/// Provider identifier
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Claude,
    Codex,
    OpenCode,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "opencode" => Some(Self::OpenCode),
            _ => None,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex CLI",
            Self::OpenCode => "OpenCode",
        }
    }
}

/// Information about a detected provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub display_name: String,
    pub base_path: String,
    pub is_available: bool,
}

/// Detect all available providers on the system
pub fn detect_providers() -> Vec<ProviderInfo> {
    let mut providers = Vec::new();

    if let Some(info) = claude::detect() {
        providers.push(info);
    }
    if let Some(info) = codex::detect() {
        providers.push(info);
    }
    if let Some(info) = opencode::detect() {
        providers.push(info);
    }

    providers
}
