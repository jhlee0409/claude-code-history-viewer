<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**AI 程式設計助手的統一歷史檢視器。**

瀏覽、搜尋和分析 **Claude Code**、**Gemini CLI**、**Antigravity**、**Codex CLI**、**Cline**、**Cursor**、**Aider** 和 **OpenCode** 的對話記錄 — 桌面應用程式或無頭伺服器。100% 離線。

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

**無頭伺服器** — 從瀏覽器存取：

```bash
brew install jhlee0409/tap/cchv-server   # 或: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

Docker、VPS、systemd 設定請參閱[伺服器模式](#伺服器模式-webui)。

---

## 為什麼做這個

AI 程式設計助手產生了數千條對話訊息，但它們都沒有提供跨工具回顧歷史的方式。CCHV 解決了這個問題。

**八個助手。一個檢視器。** 在 Claude Code、Gemini CLI、Antigravity、Codex CLI、Cline、Cursor、Aider 和 OpenCode 工作階段之間無縫切換 — 比較 Token 用量、跨提供者搜尋、在一個介面中分析您的工作流程。

| 提供者 | 資料位置 | 取得內容 |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | 完整對話記錄、工具使用、思考過程、成本 |
| **Gemini CLI** | `~/.gemini/history/` | 包含工具呼叫的對話記錄 |
| **Antigravity** | `~/.gemini/antigravity/.token-monitor/rpc-cache/v1/` | Token 監控快取工作階段、usage 快照、可直接用於統計分析 |
| **Codex CLI** | `~/.codex/sessions/` | 包含代理回應的工作階段記錄 |
| **Cline** | `~/.cline/tasks/` | 基於任務的對話記錄 |
| **Cursor** | `~/.cursor/` | Composer 和聊天對話 |
| **Aider** | 專案目錄 | 聊天記錄和編輯日誌 |
| **OpenCode** | `~/.local/share/opencode/` | 對話工作階段和工具結果 |

無供應商鎖定。無雲端依賴。本機對話檔案，精美呈現。

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
| **多提供者支援** | 統一檢視 **Claude Code**、**Gemini CLI**、**Antigravity**、**Codex CLI**、**Cline**、**Cursor**、**Aider** 和 **OpenCode** 對話記錄 — 依提供者篩選、跨工具比較 |
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
| **Antigravity** | 透過既有統一 provider 資料流接入。工作階段來自 token monitor 快取，可直接參與專案/工作階段瀏覽、Token 統計、分析儀表板與全域搜尋，無需另外建立專用頁面。 |

### v1.10.0 新增

| 功能 | 說明 |
|---------|-------------|
| **月曆熱力圖** | 活動熱力圖拆分為月曆區塊，按天視覺化更加清晰 |
| **工作階段管理** | 刪除工作階段（移至回收桶）及在檔案管理器中顯示 JSONL 檔案 |
| **複製路徑** | 從專案右鍵選單複製專案路徑 |
| **統計日期篩選** | 分析儀表板支援按日期範圍篩選 |
| **Windows 可攜版** | 可攜式 `.zip` 建置 — 無需安裝即可執行 |
| **工具專屬卡片** | Bash、Read、Edit、Glob、Grep、Write、WebFetch、WebSearch、Agent 工具專用渲染卡片 |

### v1.9.0

| 功能 | 說明 |
|---------|-------------|
| **4 個新提供者** | 新增 **Gemini CLI**、**Cline**、**Cursor**、**Aider** — 現已支援 7 個 AI 程式設計助手 |
| **WSL 支援** | Windows Subsystem for Linux 整合 — 掃描 WSL 發行版內的 Claude Code 專案 |
| **全域搜尋增強** | 專案篩選器、LRU 快取、aho-corasick 多模式最佳化、訊息導覽 |
| **縮放控制** | 放大/縮小鍵盤快捷鍵 |

### v1.6.0

| 功能 | 說明 |
|---------|-------------|
| **WebUI 伺服器模式** | 使用 `--serve` 作為無頭 Web 伺服器執行 — 從瀏覽器存取，部署到 VPS/Docker |
| **螢幕截圖擷取** | 支援範圍選取、預覽對話框和多選匯出的長螢幕截圖 |
| **封存管理** | 建立、瀏覽、重新命名和匯出工作階段封存，支援逐檔下載 |
| **無障礙** | 完整鍵盤導覽、螢幕閱讀器支援、字型縮放和高對比度模式 |
| **行動裝置 UI** | 390px 視埠支援，底部分頁列 |
| **外部連結** | 所有連結在系統瀏覽器中開啟，而非 WebView |

### 更多

| 功能 | 說明 |
|---------|-------------|
| **工作階段快捷選單** | 複製工作階段 ID、恢復指令和檔案路徑；刪除工作階段、顯示 JSONL 檔案；原生重新命名整合搜尋 |
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

或使用完整 Cask 路徑直接安裝:

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

如果出現 `No Cask with this name exists`，請使用上面的完整路徑命令。

升級:

```bash
brew upgrade --cask claude-code-history-viewer
```

解除安裝:

```bash
brew uninstall --cask claude-code-history-viewer
```

> **從手動安裝(.dmg)遷移？**
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

# 方法 1：使用 just（推薦）
brew install just    # 或：cargo install just
just setup
just dev             # 開發模式
just tauri-build     # 正式版建置

# 方法 2：直接使用 pnpm
pnpm install
pnpm tauri:dev       # 開發模式
pnpm tauri:build     # 正式版建置
```

**需求**：Node.js 18+、pnpm、Rust 工具鏈

## 伺服器模式 (WebUI)

無需桌面環境，作為無頭 HTTP 伺服器執行 — 適合 VPS、遠端伺服器或 Docker。伺服器二進位檔內嵌前端 — **只需一個檔案**。

> **初次部署伺服器？** 請參閱完整的[伺服器模式指南](docs/server-guide.md)，涵蓋本機測試、VPS 設定、Docker 等詳細步驟。

### 快速安裝

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# 或一行腳本
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

### 啟動伺服器

```bash
cchv-server --serve
```

輸出:

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

**CLI 選項:**

| 旗標 | 預設值 | 說明 |
|------|---------|-------------|
| `--serve` | — | **必要。** 啟動 HTTP 伺服器而非桌面應用程式 |
| `--port <number>` | `3727` | 伺服器連接埠 |
| `--host <address>` | `0.0.0.0` | 繫結位址（僅本機: `127.0.0.1`） |
| `--token <value>` | 自動 (uuid v4) | 自訂驗證權杖 |
| `--no-auth` | — | 停用驗證（不建議在公開網路使用） |
| `--dist <path>` | 內嵌 | 使用外部 `dist/` 目錄取代內嵌前端 |

### 驗證

所有 `/api/*` 端點受 Bearer 權杖驗證保護。權杖在每次伺服器啟動時自動產生並輸出至 stderr。

- **瀏覽器存取**: 使用啟動時輸出的 `?token=...` URL。權杖自動儲存至 `localStorage`。
- **API 存取**: 包含 `Authorization: Bearer <token>` 請求標頭。
- **自訂權杖**: `--token my-secret-token` 設定自訂權杖。
- **停用**: `--no-auth` 略過驗證（僅在可信任的網路使用）。

### 即時更新

伺服器監控 `~/.claude/projects/` 的檔案變更，並透過 SSE（Server-Sent Events）將更新推送至瀏覽器。在另一個終端機使用 Claude Code 時，檢視器會自動更新 — 無需手動重新整理。

### Docker

```bash
docker compose up -d
```

啟動後檢查權杖:

```bash
docker compose logs webui
# 🔑 Auth token: ... ← 將此 URL 貼上至瀏覽器
```

`docker-compose.yml` 將 `~/.claude`、`~/.codex` 和 `~/.local/share/opencode` 作為唯讀磁碟區掛載。

### systemd 服務

在 Linux 上持續運行伺服器，使用提供的 systemd 範本:

```bash
sudo cp contrib/cchv.service /etc/systemd/system/
sudo systemctl edit --full cchv.service   # 將 User= 設為您的使用者名稱
sudo systemctl enable --now cchv.service
```

### 從原始碼建置（僅伺服器）

```bash
just serve-build           # 建置前端 + 嵌入伺服器二進位檔
just serve-build-run       # 建置並執行（嵌入資產）

# 或以開發模式執行（外部 dist/）:
just serve-dev             # 建置前端 + 使用 --dist 執行伺服器
```

### 健康檢查

```
GET /health
→ { "status": "ok" }
```

## 使用方式

1. 啟動應用程式
2. 自動掃描所有支援的提供者（Claude Code、Gemini CLI、Codex CLI、Cline、Cursor、Aider、OpenCode）的對話資料
3. 在左側邊欄瀏覽專案 — 使用分頁列依提供者篩選
4. 點擊工作階段檢視訊息
5. 使用分頁切換訊息、分析、Token 統計、最近編輯和工作階段面板

## 無障礙

為鍵盤操作、低視力和螢幕閱讀器使用者提供無障礙功能。

- 鍵盤優先導覽：
  - 專案瀏覽器、主內容區、訊息導航器和設定的跳轉連結
  - `ArrowUp/ArrowDown/Home/End` 導覽專案樹，預搜尋，`*` 展開同層群組
  - `ArrowUp/ArrowDown/Home/End` 和 `Enter` 導覽訊息導航器並開啟聚焦的訊息
- 視覺無障礙：
  - 全域字型大小縮放（`90%`、`100%`、`110%`、`120%`、`130%`）
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
   pnpm vitest run            # 測試
   pnpm lint                  # 程式碼檢查
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
