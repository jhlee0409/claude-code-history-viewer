use serde::{Deserialize, Serialize};

pub mod aider;
pub mod amazon_q;
pub mod antigravity;
pub mod claude;
pub mod cline;
pub mod codebuddy;
pub mod codex;
pub mod continue_dev;
pub mod copilot;
pub mod copilot_cli;
pub mod crush;
pub mod cursor;
pub mod cursor_agent;
pub mod forgecode;
pub mod gemini;
pub mod goose;
pub mod kimi;
pub mod kiro;
pub mod llm;
pub mod opencode;
pub mod pearai;
/// Shared `ConversationState` parsing for the Amazon Q CLI lineage (amazon_q + kiro).
pub mod q_conversation;
pub mod vscode;

/// Provider identifier
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Aider,
    /// Amazon Q Developer CLI (`amazon-q/data.sqlite3`).
    AmazonQ,
    Claude,
    Cline,
    Codebuddy,
    Codex,
    /// Continue.dev (VS Code / `JetBrains` extension + CLI). Reads
    /// `~/.continue/sessions/*.json`.
    Continue,
    /// `PearAI` — a Continue fork that rebrands the store to `~/.pearai`.
    PearAI,
    /// Unified GitHub Copilot provider covering CLI, Desktop, and the VS Code
    /// Copilot Chat extension. Per-session disambiguation lives in the
    /// `entrypoint` field (`copilot-cli` / `copilot-desktop` / `copilot-vscode`).
    Copilot,
    /// Charmbracelet Crush (per-project `.crush/crush.db`).
    Crush,
    Cursor,
    #[serde(rename = "cursor-agent")]
    CursorAgent,
    Gemini,
    Goose,
    Kimi,
    ForgeCode,
    Kiro,
    /// Simon Willison's `llm` CLI (`~/.../io.datasette.llm/logs.db`).
    Llm,
    OpenCode,
    Antigravity,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Aider => "aider",
            Self::AmazonQ => "amazonq",
            Self::Claude => "claude",
            Self::Cline => "cline",
            Self::Codebuddy => "codebuddy",
            Self::Codex => "codex",
            Self::Continue => "continue",
            Self::PearAI => "pearai",
            Self::Copilot => "copilot",
            Self::Crush => "crush",
            Self::Cursor => "cursor",
            Self::CursorAgent => "cursor-agent",
            Self::Gemini => "gemini",
            Self::Goose => "goose",
            Self::Kimi => "kimi",
            Self::ForgeCode => "forgecode",
            Self::Kiro => "kiro",
            Self::Llm => "llm",
            Self::OpenCode => "opencode",
            Self::Antigravity => "antigravity",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "aider" => Some(Self::Aider),
            "amazonq" => Some(Self::AmazonQ),
            "claude" => Some(Self::Claude),
            "cline" => Some(Self::Cline),
            "codebuddy" => Some(Self::Codebuddy),
            "codex" => Some(Self::Codex),
            "continue" => Some(Self::Continue),
            "pearai" => Some(Self::PearAI),
            "copilot" => Some(Self::Copilot),
            "crush" => Some(Self::Crush),
            "cursor" => Some(Self::Cursor),
            "cursor-agent" => Some(Self::CursorAgent),
            "gemini" => Some(Self::Gemini),
            "goose" => Some(Self::Goose),
            "kimi" => Some(Self::Kimi),
            "forgecode" => Some(Self::ForgeCode),
            "kiro" => Some(Self::Kiro),
            "llm" => Some(Self::Llm),
            "opencode" => Some(Self::OpenCode),
            "antigravity" => Some(Self::Antigravity),
            _ => None,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Aider => "Aider",
            Self::AmazonQ => "Amazon Q CLI",
            Self::Claude => "Claude Code",
            Self::Cline => "Cline",
            Self::Codebuddy => "CodeBuddy Code",
            Self::Codex => "Codex CLI",
            Self::Continue => "Continue",
            Self::PearAI => "PearAI",
            Self::Copilot => "Copilot",
            Self::Crush => "Crush",
            Self::Cursor => "Cursor",
            Self::CursorAgent => "Cursor Agent",
            Self::Gemini => "Gemini CLI",
            Self::Goose => "Goose",
            Self::Kimi => "Kimi CLI",
            Self::ForgeCode => "ForgeCode",
            Self::Kiro => "Kiro CLI",
            Self::Llm => "llm",
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
    if let Some(info) = continue_dev::detect() {
        providers.push(info);
    }
    if let Some(info) = pearai::detect() {
        providers.push(info);
    }
    if let Some(info) = gemini::detect() {
        providers.push(info);
    }
    if let Some(info) = goose::detect() {
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
    if let Some(info) = crush::detect() {
        providers.push(info);
    }
    if let Some(info) = aider::detect() {
        providers.push(info);
    }
    if let Some(info) = amazon_q::detect() {
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
    if let Some(info) = llm::detect() {
        providers.push(info);
    }
    if let Some(info) = copilot::detect() {
        providers.push(info);
    }

    providers
}
