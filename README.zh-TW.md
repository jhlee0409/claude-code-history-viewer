# Claude Code History Viewer

瀏覽儲存在`~/.claude`中的Claude Code對話記錄的桌面應用。

![Version](https://img.shields.io/badge/Version-1.0.0--beta.4-orange.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> ⚠️ **Beta** - 可能不穩定或有變化

## 截圖

<p align="center">
  <img width="49%" alt="Main Interface 1" src="https://github.com/user-attachments/assets/45719832-324c-40c3-8dfe-5c70ddffc0a9" />
  <img width="49%" alt="Main Interface 2" src="https://github.com/user-attachments/assets/bb9fbc9d-9d78-4a95-a2ab-a1b1b763f515" />
</p>

<img width="720" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/77dc026c-8901-47d1-a8ca-e5235b97e945" />

## 功能

- **瀏覽對話**: 按專案/工作階段瀏覽對話記錄
- **搜尋**: 在所有對話中搜尋訊息
- **統計**: Token使用量分析和API費用計算
- **多語言**: 英語、韓語、日語、中文
- **最近編輯**: 查看檔案修改記錄和還原
- **其他**: 自動更新、資料夾變更、回饋

## 安裝

從[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)下載適合您平台的安裝檔案。

## 從原始碼建置

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
pnpm install
pnpm tauri:build
```

**需求**: Node.js 18+、pnpm、Rust工具鏈

## 資料隱私

僅本機執行。不向伺服器傳送資料。

## 授權條款

MIT
