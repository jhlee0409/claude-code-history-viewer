use serde::{Deserialize, Serialize};

pub mod aider;
pub mod antigravity;
pub mod claude;
pub mod cline;
pub mod codebuddy;
pub mod codex;
pub mod copilot_cli;
pub mod copilot_desktop;
pub mod cursor;
pub mod forgecode;
pub mod gemini;
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
    #[serde(rename = "copilot-cli")]
    CopilotCli,
    #[serde(rename = "copilot-desktop")]
    CopilotDesktop,
    Cursor,
    Gemini,
    ForgeCode,
    OpenCode,
    Antigravity,
    VsCode,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Aider => "aider",
            Self::Claude => "claude",
            Self::Cline => "cline",
            Self::Codebuddy => "codebuddy",
            Self::Codex => "codex",
            Self::CopilotCli => "copilot-cli",
            Self::CopilotDesktop => "copilot-desktop",
            Self::Cursor => "cursor",
            Self::Gemini => "gemini",
            Self::ForgeCode => "forgecode",
            Self::OpenCode => "opencode",
            Self::Antigravity => "antigravity",
            Self::VsCode => "vscode",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "aider" => Some(Self::Aider),
            "claude" => Some(Self::Claude),
            "cline" => Some(Self::Cline),
            "codebuddy" => Some(Self::Codebuddy),
            "codex" => Some(Self::Codex),
            "copilot-cli" => Some(Self::CopilotCli),
            "copilot-desktop" => Some(Self::CopilotDesktop),
            "cursor" => Some(Self::Cursor),
            "gemini" => Some(Self::Gemini),
            "forgecode" => Some(Self::ForgeCode),
            "opencode" => Some(Self::OpenCode),
            "antigravity" => Some(Self::Antigravity),
            "vscode" => Some(Self::VsCode),
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
            Self::CopilotCli => "Copilot CLI",
            Self::CopilotDesktop => "Copilot Desktop",
            Self::Cursor => "Cursor",
            Self::Gemini => "Gemini CLI",
            Self::ForgeCode => "ForgeCode",
            Self::OpenCode => "OpenCode",
            Self::Antigravity => "Antigravity",
            Self::VsCode => "VS Code",
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
    if let Some(info) = aider::detect() {
        providers.push(info);
    }
    if let Some(info) = antigravity::detect() {
        providers.push(info);
    }
    if let Some(info) = codebuddy::detect() {
        providers.push(info);
    }
    if let Some(info) = copilot_cli::detect() {
        providers.push(info);
    }
    if let Some(info) = copilot_desktop::detect() {
        providers.push(info);
    }
    if let Some(info) = vscode::detect() {
        providers.push(info);
    }

    providers
}
