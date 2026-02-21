<div align="center">

# Claude Code History Viewer

**瀏覽、搜尋和分析您的 Claude Code 對話記錄 — 完全離線。**

讀取 Claude Code、Codex CLI 和 OpenCode 對話記錄的桌面應用，支援資料分析、工作階段面板和即時監控。

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Downloads](https://img.shields.io/github/downloads/jhlee0409/claude-code-history-viewer/total?color=green)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
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

## 目錄

- [功能特色](#功能特色)
- [安裝](#安裝)
- [從原始碼建置](#從原始碼建置)
- [使用方式](#使用方式)
- [技術架構](#技術架構)
- [資料隱私](#資料隱私)
- [疑難排解](#疑難排解)
- [貢獻](#貢獻)
- [授權條款](#授權條款)

## 功能特色

| 功能 | 說明 |
|---------|-------------|
| **多提供者** | 統一檢視 Claude Code、Codex CLI 和 OpenCode 對話記錄 |
| **對話瀏覽器** | 依專案/工作階段瀏覽對話記錄，支援工作樹分組 |
| **全域搜尋** | 即時搜尋所有對話記錄 |
| **分析儀表板** | 依提供者統計 Token 使用量與 API 成本 |
| **工作階段面板** | 多工作階段視覺化分析，包含像素視圖、屬性篩選和活動時間軸 |
| **設定管理器** | 具作用域感知的 Claude Code 設定編輯器，支援 MCP 伺服器管理 |
| **訊息導航器** | 右側可摺疊目錄，快速瀏覽對話內容 |
| **即時監控** | 即時監控工作階段檔案變更 |
| **工作階段快捷選單** | 複製工作階段 ID、恢復指令和檔案路徑；原生重新命名整合搜尋 |
| **ANSI 色彩渲染** | 以原始 ANSI 色彩顯示終端輸出 |
| **多語言支援** | 英語、韓語、日語、簡體中文、繁體中文 |
| **最近編輯** | 檢視檔案修改歷史記錄並還原 |
| **自動更新** | 內建更新程式，支援略過或延後更新 |

## 安裝

下載適合您平台的最新版本：

| 平台 | 下載 |
|----------|----------|
| macOS (通用版) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

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

## 使用方式

1. 啟動應用程式
2. 自動掃描所有支援的提供者（Claude Code、Codex CLI、OpenCode）的對話資料
3. 在左側邊欄瀏覽專案 — 使用分頁列依提供者篩選
4. 點擊工作階段檢視訊息
5. 使用分頁切換訊息、分析、Token 統計、最近編輯和工作階段面板

## 技術架構

| 層級 | 技術 |
|-------|------------|
| **後端** | ![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white) ![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?logo=tauri&logoColor=white) |
| **前端** | ![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) |
| **狀態管理** | ![Zustand](https://img.shields.io/badge/Zustand-433E38?logo=react&logoColor=white) |
| **建置工具** | ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) |
| **國際化** | ![i18next](https://img.shields.io/badge/i18next-26A69A?logo=i18next&logoColor=white) 5 種語言 |

## 資料隱私

**100% 離線運作。**不會將任何對話資料傳送至任何伺服器。無分析、無追蹤、無遙測。

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
