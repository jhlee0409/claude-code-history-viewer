use serde::{Deserialize, Serialize};

pub mod aider;
pub mod antigravity;
pub mod claude;
pub mod cline;
pub mod codebuddy;
pub mod codex;
pub mod copilot;
pub mod copilot_cli;
pub mod cursor;
pub mod cursor_agent;
pub mod forgecode;
pub mod gemini;
pub mod kimi;
pub mod kiro;
pub mod opencode;
pub mod vscode;

/// Provider identifier
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Aider,
    Claude,
    Cline,
    Codebuddy,
    Codex,
    /// Unified GitHub Copilot provider covering CLI, Desktop, and the VS Code
    /// Copilot Chat extension. Per-session disambiguation lives in the
    /// `entrypoint` field (`copilot-cli` / `copilot-desktop` / `copilot-vscode`).
    Copilot,
    Cursor,
    #[serde(rename = "cursor-agent")]
    CursorAgent,
    Gemini,
    Kimi,
    ForgeCode,
    Kiro,
    OpenCode,
    Antigravity,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Aider => "aider",
            Self::Claude => "claude",
            Self::Cline => "cline",
            Self::Codebuddy => "codebuddy",
            Self::Codex => "codex",
            Self::Copilot => "copilot",
            Self::Cursor => "cursor",
            Self::CursorAgent => "cursor-agent",
            Self::Gemini => "gemini",
            Self::Kimi => "kimi",
            Self::ForgeCode => "forgecode",
            Self::Kiro => "kiro",
            Self::OpenCode => "opencode",
            Self::Antigravity => "antigravity",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "aider" => Some(Self::Aider),
            "claude" => Some(Self::Claude),
            "cline" => Some(Self::Cline),
            "codebuddy" => Some(Self::Codebuddy),
            "codex" => Some(Self::Codex),
            "copilot" => Some(Self::Copilot),
            "cursor" => Some(Self::Cursor),
            "cursor-agent" => Some(Self::CursorAgent),
            "gemini" => Some(Self::Gemini),
            "kimi" => Some(Self::Kimi),
            "forgecode" => Some(Self::ForgeCode),
            "kiro" => Some(Self::Kiro),
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
            Self::Codebuddy => "CodeBuddy Code",
            Self::Codex => "Codex CLI",
            Self::Copilot => "Copilot",
            Self::Cursor => "Cursor",
            Self::CursorAgent => "Cursor Agent",
            Self::Gemini => "Gemini CLI",
            Self::Kimi => "Kimi CLI",
            Self::ForgeCode => "ForgeCode",
            Self::Kiro => "Kiro CLI",
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
    if let Some(info) = kimi::detect() {
        providers.push(info);
    }
    if let Some(info) = forgecode::detect() {
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
    if let Some(info) = cursor_agent::detect() {
        providers.push(info);
    }
    if let Some(info) = aider::detect() {
        providers.push(info);
    }
    if let Some(info) = antigravity::detect() {
        providers.push(info);
    }
    if let Some(info) = codebuddy::detect() {
        providers.push(info);
    }
    if let Some(info) = kiro::detect() {
        providers.push(info);
    }
    if let Some(info) = copilot::detect() {
        providers.push(info);
    }

    providers
}
