use serde::{Deserialize, Serialize};

pub mod aider;
pub mod amazon_q;
pub mod antigravity;
/// Antigravity CLI (`~/.gemini/antigravity-cli`) layout — surfaced through the
/// `antigravity` provider, not a separate provider id.
pub mod antigravity_cli;
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
pub mod ompi;
pub mod opencode;
pub mod openhands;
pub mod openinterpreter;
pub mod pearai;
pub mod pi;
/// Shared `ConversationState` parsing for the Amazon Q CLI lineage (amazon_q + kiro).
pub mod q_conversation;
pub mod qwen;
pub mod trae;
pub mod vibe;
pub mod vscode;
pub mod zed;

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
    /// Open Interpreter (Rust v1.0) — Codex-format rollouts under `~/.openinterpreter`.
    OpenInterpreter,
    /// `OpenHands` (classic 0.x) — `~/.openhands/sessions/<id>/events/*.json`.
    OpenHands,
    /// Pi coding agent (badlogic's `pi`) — JSONL sessions under `~/.pi/agent/sessions`.
    Pi,
    /// oh-my-pi (`omp`) — a `pi` fork with the same session format under `~/.omp`.
    Ompi,
    /// Qwen Code (Gemini-CLI fork) — JSONL transcripts under `~/.qwen/projects`.
    Qwen,
    Antigravity,
    /// Zed Agent Panel threads (`SQLite` + Zstd JSON at `…/Zed/threads/threads.db`).
    Zed,
    /// Trae IDE chat (reverse-engineered icube JSON in per-workspace `state.vscdb`).
    Trae,
    /// Mistral Vibe CLI (`~/.vibe/logs/session/<session>/`).
    Vibe,
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
            Self::OpenInterpreter => "openinterpreter",
            Self::OpenHands => "openhands",
            Self::Pi => "pi",
            Self::Ompi => "ompi",
            Self::Qwen => "qwen",
            Self::Antigravity => "antigravity",
            Self::Zed => "zed",
            Self::Trae => "trae",
            Self::Vibe => "vibe",
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
            "openinterpreter" => Some(Self::OpenInterpreter),
            "openhands" => Some(Self::OpenHands),
            "pi" => Some(Self::Pi),
            "ompi" => Some(Self::Ompi),
            "qwen" => Some(Self::Qwen),
            "antigravity" => Some(Self::Antigravity),
            "zed" => Some(Self::Zed),
            "trae" => Some(Self::Trae),
            "vibe" => Some(Self::Vibe),
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
            Self::OpenInterpreter => "Open Interpreter",
            Self::OpenHands => "OpenHands",
            Self::Pi => "Pi",
            Self::Ompi => "oh-my-pi",
            Self::Qwen => "Qwen Code",
            Self::Antigravity => "Antigravity",
            Self::Zed => "Zed",
            Self::Trae => "Trae",
            Self::Vibe => "Mistral Vibe",
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
    if let Some(info) = openinterpreter::detect() {
        providers.push(info);
    }
    if let Some(info) = pi::detect() {
        providers.push(info);
    }
    if let Some(info) = ompi::detect() {
        providers.push(info);
    }
    if let Some(info) = openhands::detect() {
        providers.push(info);
    }
    if let Some(info) = qwen::detect() {
        providers.push(info);
    }
    if let Some(info) = zed::detect() {
        providers.push(info);
    }
    if let Some(info) = trae::detect() {
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
    if let Some(info) = vibe::detect() {
        providers.push(info);
    }

    providers
}
