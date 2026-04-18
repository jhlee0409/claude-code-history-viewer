use serde::{Deserialize, Serialize};

pub mod aider;
pub mod antigravity;
pub mod claude;
pub mod cline;
pub mod codex;
pub mod cursor;
pub mod gemini;
pub mod opencode;

/// Provider identifier
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Aider,
    Claude,
    Cline,
    Codex,
    Cursor,
    Gemini,
    OpenCode,
    Antigravity,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Aider => "aider",
            Self::Claude => "claude",
            Self::Cline => "cline",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::Gemini => "gemini",
            Self::OpenCode => "opencode",
            Self::Antigravity => "antigravity",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "aider" => Some(Self::Aider),
            "claude" => Some(Self::Claude),
            "cline" => Some(Self::Cline),
            "codex" => Some(Self::Codex),
            "cursor" => Some(Self::Cursor),
            "gemini" => Some(Self::Gemini),
            "opencode" => Some(Self::OpenCode),
            "antigravity" => Some(Self::Antigravity),
            _ => None,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Aider => "Aider",
            Self::Claude => "Claude Code",
            Self::Cline => "Cline",
            Self::Codex => "Codex CLI",
            Self::Cursor => "Cursor",
            Self::Gemini => "Gemini CLI",
            Self::OpenCode => "OpenCode",
            Self::Antigravity => "Antigravity",
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
    if let Some(info) = gemini::detect() {
        providers.push(info);
    }
    if let Some(info) = opencode::detect() {
        providers.push(info);
    }
    if let Some(info) = cline::detect() {
        providers.push(info);
    }
    if let Some(info) = cursor::detect() {
        providers.push(info);
    }
    if let Some(info) = aider::detect() {
        providers.push(info);
    }
    if let Some(info) = antigravity::detect() {
        providers.push(info);
    }

    providers
}
