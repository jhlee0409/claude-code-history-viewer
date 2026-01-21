# Claude Code History Viewer

`~/.claude`に保存されたClaude Codeの会話履歴を閲覧するデスクトップアプリ。

![Version](https://img.shields.io/badge/Version-1.0.0--beta.4-orange.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> ⚠️ **Beta** - 不安定または変更の可能性あり

## スクリーンショット

<p align="center">
  <img width="49%" alt="Main Interface 1" src="https://github.com/user-attachments/assets/45719832-324c-40c3-8dfe-5c70ddffc0a9" />
  <img width="49%" alt="Main Interface 2" src="https://github.com/user-attachments/assets/bb9fbc9d-9d78-4a95-a2ab-a1b1b763f515" />
</p>

<img width="720" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/77dc026c-8901-47d1-a8ca-e5235b97e945" />

## 機能

- **会話の閲覧**: プロジェクト/セッション別に会話履歴を閲覧
- **検索**: 全ての会話からメッセージを検索
- **統計**: トークン使用量分析とAPI費用計算
- **多言語**: 英語、韓国語、日本語、中国語
- **最近の編集**: ファイル変更履歴の確認と復元
- **その他**: 自動更新、フォルダ変更、フィードバック

## インストール

[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)からプラットフォームに合ったインストールファイルをダウンロード。

## ソースからビルド

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
pnpm install
pnpm tauri:build
```

**要件**: Node.js 18+、pnpm、Rustツールチェーン

## データプライバシー

ローカルでのみ実行。サーバーへのデータ送信なし。

## ライセンス

MIT
