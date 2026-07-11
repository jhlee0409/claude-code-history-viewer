<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**AI 程式設計助手的統一歷史檢視器。**

瀏覽、搜尋和分析 **Claude Code**、**Gemini CLI**、**Antigravity**、**Codex CLI**、**Cline**、**Cursor**、**Aider**、**OpenCode**、**ForgeCode** 和 **CodeBuddy Code** 的對話記錄 — 桌面應用程式或無頭伺服器。100% 離線。

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Stars](https://img.shields.io/github/stars/jhlee0409/claude-code-history-viewer?style=flat&color=yellow)](https://github.com/jhlee0409/claude-code-history-viewer/stargazers)
[![License](https://img.shields.io/github/license/jhlee0409/claude-code-history-viewer)](LICENSE)
[![Rust Tests](https://img.shields.io/github/actions/workflow/status/jhlee0409/claude-code-history-viewer/rust-tests.yml?label=Rust%20Tests)](https://github.com/jhlee0409/claude-code-history-viewer/actions/workflows/rust-tests.yml)
[![Last Commit](https://img.shields.io/github/last-commit/jhlee0409/claude-code-history-viewer)](https://github.com/jhlee0409/claude-code-history-viewer/commits/main)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[網站](https://jhlee0409.github.io/claude-code-history-viewer/) · [下載](https://github.com/jhlee0409/claude-code-history-viewer/releases) · [回報問題](https://github.com/jhlee0409/claude-code-history-viewer/issues)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

</div>

---

<p align="center">
  <img width="49%" alt="Conversation History" src="https://github.com/user-attachments/assets/9a18304d-3f08-4563-a0e6-dd6e6dfd227e" />
  <img width="49%" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/0f869344-4a7c-4f1f-9de3-701af10fc255" />
</p>
<p align="center">
  <img width="49%" alt="Token Statistics" src="https://github.com/user-attachments/assets/d30f3709-1afb-4f76-8f06-1033a3cb7f4a" />
  <img width="49%" alt="Recent Edits" src="https://github.com/user-attachments/assets/8c9fbff3-55dd-4cfc-a135-ddeb719f3057" />
</p>

## 快速開始

**桌面應用程式** — 下載並執行：

| 平台 | 下載 |
|----------|----------|
| macOS (通用版) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) / [`.zip` (可攜版)](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

**Homebrew** (macOS)：

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

**無頭伺服器** — 從任何瀏覽器存取：

```bash
brew install jhlee0409/tap/cchv-server   # or: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

Docker、VPS、systemd 設定請參閱[伺服器模式](#伺服器模式-webui)。

---

## 為什麼做這個

AI 程式設計助手產生了數千條對話訊息，但它們都沒有提供跨工具回顧歷史的方式。CCHV 解決了這個問題。

**二十五個助手。一個檢視器。** 在 Claude Code、GitHub Copilot、Gemini CLI、Antigravity、Codex CLI、Cline（含 Roo Code 和 Kilo Code）、Cursor、Cursor Agent、Aider、OpenCode、ForgeCode、CodeBuddy Code、Kimi、Kiro、Amazon Q CLI、Continue.dev、PearAI、Goose、Crush、llm、Open Interpreter、Qwen Code、Zed、OpenHands 和 Trae 工作階段之間無縫切換 — 比較 Token 用量、跨提供者搜尋、在一個介面中分析您的工作流程。

| 提供者 | 資料位置 | 取得內容 |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | 完整對話記錄、工具使用、思考過程、成本 |
| **GitHub Copilot** | `~/.copilot/session-state/`（CLI 與 Desktop）、VS Code `workspaceStorage/.../chatSessions/` | Copilot CLI、Copilot Desktop 和 VS Code Copilot Chat 歷史記錄（唯讀，支援 WSL） |
| **Gemini CLI** | `~/.gemini/history/` | 包含工具呼叫的對話記錄 |
| **Antigravity** | `~/.gemini/antigravity/` | `brain/` 下的對話狀態，以及 `.token-monitor/rpc-cache/v1/` 下的 Token 監控資料 |
| **Codex CLI** | `~/.codex/sessions/` | 包含代理回應的工作階段記錄 |
| **Cline**（含 Roo Code、Kilo Code） | VS Code `globalStorage/<ext>/tasks/` | Cline 家族的任務式對話記錄 |
| **Cursor** | `~/.cursor/` | Composer 和聊天對話 |
| **Cursor Agent** | `~/.cursor/projects/.../agent-transcripts/` | 代理逐字稿，與 Cursor IDE 來源相互獨立 |
| **Aider** | 專案目錄 | 聊天記錄和編輯日誌 |
| **OpenCode** | `~/.local/share/opencode/` | 對話工作階段和工具結果 |
| **ForgeCode** | `~/.forge/.forge.db` | SQLite 資料庫中的對話記錄 |
| **CodeBuddy Code** | `~/.codebuddy/projects/` | 包含工具呼叫的對話記錄（Claude Code fork 格式） |
| **Kimi** | `~/.kimi/` | 工作階段記錄，支援 `kimi -r` 恢復 |
| **Kiro** | `kiro-cli/data.sqlite3` | 以 SQLite 為後端的對話記錄 |
| **Amazon Q CLI** | `…/amazon-q/data.sqlite3` | SQLite `conversations` 儲存（與 Kiro CLI 提供者共用格式） |
| **Continue.dev** | `~/.continue/sessions/*.json` | 逐工作階段 JSON，依工作區分組（支援 `CONTINUE_GLOBAL_DIR`） |
| **PearAI** | `~/.pearai/sessions/` | Continue fork — 相同的工作階段格式 |
| **Goose** | `…/goose/sessions/sessions.db` | Block 的代理 — SQLite 工作階段 + 訊息 |
| **Crush** | 逐專案 `./.crush/crush.db` | Charm 的 TUI — SQLite，於常見程式碼根目錄中自動探索 |
| **llm** | `…/io.datasette.llm/logs.db` | Simon Willison 的 CLI — SQLite conversations/responses，含 Token 計數 |
| **Open Interpreter** | `~/.openinterpreter/sessions/` | Codex 格式 rollouts（重用 Codex 解析器；支援 `INTERPRETER_HOME` 覆寫） |
| **Qwen Code** | `~/.qwen/projects/.../chats/` | 逐工作階段 JSONL 逐字稿（工具呼叫、思考過程、Token 用量） |
| **Zed** | `…/Zed/threads/threads.db` | Agent Panel 執行緒 — SQLite + Zstd 壓縮 JSON |
| **OpenHands** | `~/.openhands/sessions/` | 傳統 event-store 對話 |
| **Trae** | `…/Trae/User/workspaceStorage/.../state.vscdb` | 逐工作區聊天（icube 儲存；實驗性，逆向工程） |

無供應商鎖定。無雲端依賴。本機對話檔案，精美呈現。

Antigravity 說明：檢視器將 Antigravity 根目錄解析為 `~/.gemini/antigravity`，再從 `brain/` 讀取工作階段狀態、從 `.token-monitor/rpc-cache/v1/` 讀取 usage/快取產物；此行為與 `src-tauri/src/commands/antigravity.rs` 中目前的執行期佈局與根目錄解析器一致。

## 目錄

- [功能特色](#功能特色)
- [安裝](#安裝)
- [從原始碼建置](#從原始碼建置)
- [伺服器模式 (WebUI)](#伺服器模式-webui)
- [使用方式](#使用方式)
- [無障礙](#無障礙)
- [技術架構](#技術架構)
- [資料隱私](#資料隱私)
- [疑難排解](#疑難排解)
- [貢獻](#貢獻)
- [授權條款](#授權條款)

## 功能特色

### 核心

| 功能 | 說明 |
|---------|-------------|
| **多提供者支援** | 統一檢視 **25 個 AI 程式設計助手** — Claude Code、GitHub Copilot、Gemini CLI、Codex CLI、Cursor / Cursor Agent、Cline（含 Roo Code 和 Kilo Code）、Aider、OpenCode、ForgeCode、CodeBuddy Code、Kimi、Kiro、Antigravity、Amazon Q CLI、Continue.dev、PearAI、Goose、Crush、llm、Open Interpreter、Qwen Code、Zed、OpenHands 和 Trae — 依提供者篩選、跨工具比較 |
| **對話瀏覽器** | 依專案/工作階段瀏覽對話記錄，支援工作樹分組 |
| **全域搜尋** | 即時搜尋所有提供者的對話記錄 |
| **分析儀表板** | 雙模式 Token 統計（帳單 vs 對話）、成本明細、提供者分佈圖表 |
| **工作階段面板** | 多工作階段視覺化分析，包含像素視圖、屬性篩選和活動時間軸 |
| **設定管理器** | 具作用域感知的 Claude Code 設定編輯器，支援 MCP 伺服器管理 |
| **訊息導航器** | 右側可摺疊目錄，快速瀏覽對話內容 |
| **即時監控** | 即時監控工作階段檔案變更 |

### Provider 說明

| 提供者 | 說明 |
|---------|-------|
| **Antigravity** | 透過標準 provider 資料流載入。工作階段來自 token monitor 快取，可直接參與專案/工作階段瀏覽、Token 統計、分析儀表板與全域搜尋，無需另外建立專用 UI 模式。 |

### v1.18.0 新增

| 功能 | 說明 |
|---------|-------------|
| **更快的啟動速度** | 提供者掃描器現以並行方式執行而非依序執行，因此與檢視器同時執行的工具鎖住 SQLite 資料庫時，不再拖慢整個掃描 — 消除長達數秒的「Initializing app…」卡頓 |
| **搜尋結果脈絡** | 全域搜尋結果現會顯示每個符合項目所屬的對話，讓跨工作階段共用相同文字的符合項目易於區分 |
| **可摺疊的提供者篩選器** | 側邊欄的提供者篩選面板可摺疊，為工作階段清單釋出垂直空間；摺疊後的標頭仍會顯示目前篩選摘要與計數 |
| **可驗證的專案名稱** | 專案識別優先採用磁碟上的資料夾名稱，而非舊逐字稿中記錄的過期 `cwd`，讓已移動或由 subagent 記錄的專案能正確分組（一次性透明重新掃描） |
| **修正** | 匯出 subagent 工作階段時現會包含其訊息，而非產生空檔案；OpenCode 全域工作階段依目錄拆分（且空目錄工作階段可正確載入）；OpenCode 工作階段快取設有上限，避免記憶體無限增長 |

### v1.17.0 新增

| 功能 | 說明 |
|---------|-------------|
| **十一個新提供者** | 瀏覽 **Continue.dev** 和 **PearAI**（`~/.continue` / `~/.pearai` 工作階段 JSON）、**Goose**（SQLite）、**Crush**（逐專案 SQLite）、**llm**（Simon Willison 的 CLI）、**Amazon Q CLI**、**Open Interpreter**（Codex 格式 rollouts）、**Qwen Code**、**Zed**（Agent Panel 執行緒 — SQLite + Zstd）、**OpenHands** 和 **Trae** 的歷史記錄 — 另透過 Cline 家族讀取器支援 **Kilo Code**。涵蓋範圍從 14 個助手擴增至 25 個。 |
| **Kiro Windows 路徑修正** | Kiro CLI 資料庫在 Windows 上現透過 `data_local_dir()`（`%LOCALAPPDATA%`）解析，而非錯誤的 `AppData\Roaming` |

### v1.16.0 新增

| 功能 | 說明 |
|---------|-------------|
| **GitHub Copilot 提供者** | 唯讀檢視 **Copilot CLI**（`~/.copilot/session-state`）、**Copilot Desktop** 和 **VS Code Copilot Chat**（`workspaceStorage/.../chatSessions`）的歷史記錄 — 支援 WSL 及全域搜尋 |
| **無頭工作階段匯出** | 新增 `--export <session-id\|/abs/path.jsonl> [--format html\|json] [--output <file>]` 旗標，不啟動 GUI 即產出 HTML 或 JSON 報告後結束 — 適用於 SSH/CI |
| **一鍵完整備份** | Archive Manager 的「Full Backup」卡片可一次將所有 Claude Code 專案的每個工作階段複製到封存中，讓歷史記錄不受 Claude Code 自動清理影響 |
| **Skill 與 Subagent 分析** | 新增「Most Used Skills」/「Most Used Subagents」區段，依名稱拆解 Claude 的 `Skill` 和 `Agent` 呼叫，支援專案與全域範圍 |
| **修正** | 字型大小設定現套用至整個應用程式（訊息檢視器、分析、工作階段面板、設定），不再僅限左側面板；系統垃圾桶不可用時（例如 Windows 資源回收筒被停用），工作階段刪除會回退為永久刪除 |

### v1.15.0 新增

| 功能 | 說明 |
|---------|-------------|
| **三個新提供者** | 瀏覽 **Cursor Agent**（agent-transcripts，與 Cursor IDE 來源相互獨立）、**Kimi**（`~/.kimi`，支援 `kimi -r` 恢復）和 **Kiro**（以 SQLite 為後端的 `kiro-cli`）的歷史記錄 |
| **Codex 原生重新命名與刪除** | 重新命名 Codex 工作階段 — 標題寫入 `state_5.sqlite` 並顯示於 `codex` resume 選單，rollout 逐字稿保持不可變 — 並透過新的應用程式內確認對話框刪除工作階段；支援 `CODEX_HOME`（sessions + archived） |
| **更快的掃描與搜尋** | Codex 專案清單僅掃描 session-meta 行（mmap + memchr），且各提供者獨立掃描，緩慢的提供者不再阻塞快速的提供者；工作階段內搜尋索引移至 Web Worker，大型工作階段不再凍結 UI |
| **精確的 Claude 專案路徑** | 專案名稱與 `claude --resume` 工作目錄現從工作階段中繼資料解析，而非有損的資料夾編碼（首次啟動時進行一次性透明重新掃描） |
| **修正** | 移除虛擬化訊息歷史中的空白間隙；修正 macOS 上 Kimi 自動重新整理；修正多位元組工作區資料夾名稱導致的 Cursor 掃描崩潰 |

### v1.14.0

| 功能 | 說明 |
|---------|-------------|
| **CodeBuddy Code 提供者** | 新增 CodeBuddy Code — 與其他 AI 程式設計助手一同瀏覽其對話記錄 |
| **WebUI 帳號登入** | `--serve` 模式新增可選的帳號驗證（Argon2id + 伺服器端工作階段 + CSRF）、唯讀模式，以及供反向代理託管使用的 base-path 支援 |
| **持久化訊息篩選器** | 角色與內容類型篩選器現可跨工作階段切換與應用程式重啟保留 |
| **Subagent 工作階段穩定性** | 修正多 subagent 點擊對應，以及開啟大型 subagent 工作階段時偶發的崩潰 |
| **Linux IME 輸入** | 修正 Linux 搜尋框中的 ibus/fcitx 輸入（韓文、中文、日文） |

### v1.13.0

| 功能 | 說明 |
|---------|-------------|
| **macOS 自訂標題列** | 可拖曳的覆蓋層標題列取代傳統 macOS 標題列 — 螢幕空間運用更一致；Linux/Windows 不受影響 |
| **工作階段來源篩選** | 基於 Claude Code 的 `entrypoint` 欄位按建立位置（CLI、VS Code 或 Desktop）篩選工作階段 |
| **Codex Resume 支援** | 右鍵「複製 Resume 命令」現支援 Codex 工作階段，並自動加入 `cd '<cwd>' && ` 前置字串 — 貼上執行即可回到原目錄 |
| **計價準確性** | 修正 `claude-opus-4-7` 3 倍超額計費；新增 `gpt-5.4` / `gpt-5.5` 計價並支援 Codex 快取 Token 處理 |
| **macOS 更新器穩定化** | 針對 Tauri v2 macOS relaunch bug 的 OS 級原生重新啟動回退 — 不再顯示「請手動重啟」 |

> 歷史版本：v1.12.0 及更早請參閱 [CHANGELOG.md](./CHANGELOG.md)。

### 更多

| 功能 | 說明 |
|---------|-------------|
| **工作階段右鍵選單** | 複製工作階段 ID、resume 命令、檔案路徑；刪除工作階段、顯示 JSONL 檔案；原生重新命名整合搜尋 |
| **ANSI 色彩渲染** | 以原始 ANSI 色彩顯示終端輸出 |
| **多語言支援** | 英語、韓語、日語、簡體中文、繁體中文 |
| **最近編輯** | 檢視檔案修改歷史記錄並還原 |
| **自動更新** | 內建更新程式，支援略過或延後更新 |

## 安裝

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

或使用完整 Cask 路徑直接安裝：

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

如果出現 `No Cask with this name exists`，請使用上面的完整路徑命令。

升級：

```bash
brew upgrade --cask claude-code-history-viewer
```

解除安裝：

```bash
brew uninstall --cask claude-code-history-viewer
```

> **從手動安裝 (.dmg) 遷移？**
> 為避免衝突，請先刪除現有應用程式，然後透過 Homebrew 安裝。
> 請只使用**一種**安裝方式 — 不要混合使用手動安裝和 Homebrew。
> ```bash
> # 先刪除手動安裝的應用程式
> rm -rf "/Applications/Claude Code History Viewer.app"
> # 透過 Homebrew 安裝
> brew tap jhlee0409/tap
> brew install --cask claude-code-history-viewer
> ```

## 從原始碼建置

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer

# Option 1: Using just (recommended)
brew install just    # or: cargo install just
just setup
just dev             # Development
just tauri-build     # Production build

# Option 2: Using pnpm directly
pnpm install
pnpm tauri:dev       # Development
pnpm tauri:build     # Production build
```

**需求**：Node.js 18+、pnpm、Rust 工具鏈

## 伺服器模式 (WebUI)

無需桌面環境，作為無頭 HTTP 伺服器執行 — 適合 VPS、遠端伺服器或 Docker。伺服器二進位檔內嵌前端 — **只需一個檔案**。

> **初次部署伺服器？** 請參閱完整的[伺服器模式指南](docs/server-guide.md)（[한국어](docs/server-guide.ko.md)），涵蓋本機測試、VPS 設定、Docker 等逐步說明。

### 快速安裝

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# Or one-line script
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

兩種方式都會將 `cchv-server` 安裝至您的 PATH。

### 啟動伺服器

```bash
cchv-server --serve
```

輸出：

```
🔑 Auth token: b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
   Open in browser: http://192.168.1.10:3727?token=b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
👁 File watcher active: /home/user/.claude/projects
🚀 WebUI server running at http://0.0.0.0:3727
```

在瀏覽器中開啟 URL — 權杖會自動儲存。

### 預建二進位檔

| 平台 | 資產 |
|----------|-------|
| Linux x64 | `cchv-server-linux-x64.tar.gz` |
| Linux ARM64 | `cchv-server-linux-arm64.tar.gz` |
| macOS ARM | `cchv-server-macos-arm64.tar.gz` |
| macOS x64 | `cchv-server-macos-x64.tar.gz` |

從 [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases) 下載。

**CLI 選項：**

| 旗標 | 預設值 | 說明 |
|------|---------|-------------|
| `--serve` | — | **必要。** 啟動 HTTP 伺服器而非桌面應用程式 |
| `--port <number>` | `3727` | 伺服器連接埠 |
| `--host <address>` | `0.0.0.0` | 繫結位址（僅本機：`127.0.0.1`） |
| `--token <value>` | 自動 (uuid v4) | 自訂驗證權杖 |
| `--no-auth` | — | 停用驗證（不建議在公開網路使用） |
| `--dist <path>` | 內嵌 | 使用外部 `dist/` 目錄取代內嵌前端 |

### 驗證

所有 `/api/*` 端點受 Bearer 權杖驗證保護。權杖在每次伺服器啟動時自動產生並輸出至 stderr。

- **瀏覽器存取**：使用啟動時輸出的 `?token=...` URL。權杖自動儲存至 `localStorage`。
- **API 存取**：包含 `Authorization: Bearer <token>` 請求標頭。
- **自訂權杖**：`--token my-secret-token` 設定自訂權杖。
- **環境變數**：`CCHV_TOKEN=your-token cchv-server --serve`（適用於 systemd/Docker）。
- **停用**：`--no-auth` 完全略過驗證（僅在可信任的網路使用）。

### 即時更新

伺服器監控 `~/.claude/projects/` 的檔案變更，並透過 SSE（Server-Sent Events）將更新推送至瀏覽器。在另一個終端機使用 Claude Code 時，檢視器會自動更新 — 無需手動重新整理。

### Docker

```bash
docker compose up -d
```

啟動後檢查權杖：

```bash
docker compose logs webui
# 🔑 Auth token: ... ← paste this URL in your browser
```

`docker-compose.yml` 將 `~/.claude`、`~/.codex` 和 `~/.local/share/opencode` 作為唯讀磁碟區掛載。

### systemd 服務

在 Linux 上持續運行伺服器，使用提供的 systemd 範本：

```bash
sudo cp contrib/cchv.service /etc/systemd/system/
sudo systemctl edit --full cchv.service   # Set User= to your username
sudo systemctl enable --now cchv.service
```

### 從原始碼建置（僅伺服器）

```bash
just serve-build           # Build frontend + embed into server binary
just serve-build-run       # Build and run (embedded assets)

# Or run in development (external dist/):
just serve-dev             # Build frontend + run server with --dist
```

### 健康檢查

```
GET /health
→ { "status": "ok" }
```

## 使用方式

1. 啟動應用程式
2. 自動掃描所有 25 個支援提供者（Claude Code、Codex CLI、Gemini CLI、Cursor、Cline、Continue.dev、Goose、Zed、Qwen Code、Amazon Q CLI 等 — 見上方提供者表格）的對話資料
3. 在左側邊欄瀏覽專案 — 使用分頁列依提供者篩選
4. 點擊工作階段檢視訊息
5. 使用分頁切換訊息、分析、Token 統計、最近編輯和工作階段面板

### 命令列旗標

使用 `--session` 旗標啟動應用程式並預先聚焦於指定工作階段：

```bash
# Full UUID
claude-code-history-viewer --session 1265cd74-caa9-472e-b343-c4f44b5cf12c

# UUID prefix (8+ hex-or-dash chars, up to 36) — first match wins
claude-code-history-viewer --session 1265cd74

# Equals form also works
claude-code-history-viewer --session=1265cd74
```

檢視器會掃描所有已知專案並導覽至符合的工作階段；若無任何相符項目，則以一般流程啟動。既非 hex-或-短橫線的 8..36 字元、也非絕對路徑的值會被靜默忽略。

## 無障礙

為鍵盤操作、低視力和螢幕閱讀器使用者提供無障礙功能。

- 鍵盤優先導覽：
  - 專案瀏覽器、主內容區、訊息導航器和設定的跳轉連結
  - `ArrowUp/ArrowDown/Home/End` 導覽專案樹，支援輸入預先搜尋，`*` 展開同層群組
  - `ArrowUp/ArrowDown/Home/End` 導覽訊息導航器，`Enter` 開啟聚焦的訊息
- 視覺無障礙：
  - 持久化的全域字型大小縮放（`90%`、`100%`、`110%`、`120%`、`130%`）
  - 設定中高對比度模式切換
- 螢幕閱讀器支援：
  - 地標和樹/列表語意（`navigation`、`tree`、`treeitem`、`group`、`listbox`、`option`）
  - 狀態/載入和專案樹導覽/選取變更的即時播報
  - 透過 `aria-describedby` 提供內嵌鍵盤說明描述

## 技術架構

| 層級 | 技術 |
|-------|------------|
| **後端** | ![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white) ![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?logo=tauri&logoColor=white) |
| **前端** | ![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) |
| **狀態管理** | ![Zustand](https://img.shields.io/badge/Zustand-433E38?logo=react&logoColor=white) |
| **建置工具** | ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) |
| **國際化** | ![i18next](https://img.shields.io/badge/i18next-26A69A?logo=i18next&logoColor=white) 5 種語言 |

## 資料隱私

**100% 離線運作。** 不會將任何對話資料傳送至任何伺服器。無分析、無追蹤、無遙測。

您的資料完全保留在本機電腦上。

## 疑難排解

| 問題 | 解決方案 |
|---------|----------|
| 「找不到 Claude 資料」 | 請確認 `~/.claude` 存在且包含對話記錄 |
| 效能問題 | 大量歷史記錄可能導致初始載入較慢 — 應用程式使用虛擬捲動技術 |
| 更新問題 | 如果自動更新失敗，請從 [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases) 手動下載 |

## 貢獻

歡迎貢獻！以下是參與方式：

1. Fork 此儲存庫
2. 建立功能分支 (`git checkout -b feat/my-feature`)
3. 在提交前執行檢查：
   ```bash
   pnpm tsc --build .        # TypeScript
   pnpm vitest run            # Tests
   pnpm lint                  # Lint
   ```
4. 提交變更 (`git commit -m 'feat: add my feature'`)
5. 推送至分支 (`git push origin feat/my-feature`)
6. 開啟 Pull Request

請參閱 [開發指令](CLAUDE.md#development-commands) 以取得完整可用指令清單。

## 授權條款

[MIT](LICENSE) — 可自由用於個人和商業用途。

---

<div align="center">

如果這個專案對您有幫助，請考慮給它一顆星星！

[![Star History Chart](https://api.star-history.com/svg?repos=jhlee0409/claude-code-history-viewer&type=Date)](https://star-history.com/#jhlee0409/claude-code-history-viewer&Date)

</div>
