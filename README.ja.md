<div align="center">

# Claude Code History Viewer

**Claude Codeの会話履歴を閲覧・検索・分析 — 完全オフライン。**

Claude Code、Codex CLI、OpenCodeの会話履歴を分析ダッシュボード、セッションボード、リアルタイム監視で閲覧するデスクトップアプリ。

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Downloads](https://img.shields.io/github/downloads/jhlee0409/claude-code-history-viewer/total?color=green)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Stars](https://img.shields.io/github/stars/jhlee0409/claude-code-history-viewer?style=flat&color=yellow)](https://github.com/jhlee0409/claude-code-history-viewer/stargazers)
[![License](https://img.shields.io/github/license/jhlee0409/claude-code-history-viewer)](LICENSE)
[![Rust Tests](https://img.shields.io/github/actions/workflow/status/jhlee0409/claude-code-history-viewer/rust-tests.yml?label=Rust%20Tests)](https://github.com/jhlee0409/claude-code-history-viewer/actions/workflows/rust-tests.yml)
[![Last Commit](https://img.shields.io/github/last-commit/jhlee0409/claude-code-history-viewer)](https://github.com/jhlee0409/claude-code-history-viewer/commits/main)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[ウェブサイト](https://jhlee0409.github.io/claude-code-history-viewer/) · [ダウンロード](https://github.com/jhlee0409/claude-code-history-viewer/releases) · [バグ報告](https://github.com/jhlee0409/claude-code-history-viewer/issues)

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

## 目次

- [主な機能](#主な機能)
- [インストール](#インストール)
- [ソースからビルド](#ソースからビルド)
- [使い方](#使い方)
- [技術スタック](#技術スタック)
- [データプライバシー](#データプライバシー)
- [トラブルシューティング](#トラブルシューティング)
- [コントリビュート](#コントリビュート)
- [ライセンス](#ライセンス)

## 主な機能

| 機能 | 説明 |
|---------|-------------|
| **マルチプロバイダー** | Claude Code、Codex CLI、OpenCodeの会話を統合ビューアで閲覧 |
| **会話ブラウザ** | プロジェクト/セッション別に会話を閲覧（ワークツリーグループ化対応） |
| **グローバル検索** | 全ての会話を瞬時に検索 |
| **分析ダッシュボード** | プロバイダー別トークン使用量統計とAPI費用計算 |
| **セッションボード** | マルチセッション視覚分析（ピクセルビュー、属性ブラッシング、アクティビティタイムライン） |
| **設定マネージャー** | スコープ対応のClaude Code設定エディタ（MCPサーバー管理付き） |
| **メッセージナビゲーター** | 右側折りたたみ式TOCで会話を素早くナビゲーション |
| **リアルタイム監視** | セッションファイルのライブ監視で即座に更新 |
| **セッションコンテキストメニュー** | セッションID・再開コマンド・ファイルパスのコピー、ネイティブ名変更と検索連携 |
| **ANSIカラーレンダリング** | ターミナル出力を元のANSIカラーで表示 |
| **多言語対応** | 英語、韓国語、日本語、中国語（簡体字・繁体字） |
| **最近の編集** | ファイル変更履歴の確認と復元 |
| **自動更新** | スキップ/延期オプション付きビルトイン更新機能 |

## インストール

プラットフォームに合った最新リリースをダウンロード:

| プラットフォーム | ダウンロード |
|----------|----------|
| macOS (Universal) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

アップグレード:

```bash
brew upgrade --cask claude-code-history-viewer
```

アンインストール:

```bash
brew uninstall --cask claude-code-history-viewer
```

> **手動インストール(.dmg)から移行しますか？**
> 競合を防ぐため、Homebrewでインストールする前に既存のアプリを削除してください。
> インストール方法は**1つだけ**使用してください — 手動とHomebrewを混在させないでください。
> ```bash
> # 手動インストールしたアプリを先に削除
> rm -rf "/Applications/Claude Code History Viewer.app"
> # Homebrewでインストール
> brew tap jhlee0409/tap
> brew install --cask claude-code-history-viewer
> ```

## ソースからビルド

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer

# オプション1: justを使用（推奨）
brew install just    # または: cargo install just
just setup
just dev             # 開発モード
just tauri-build     # プロダクションビルド

# オプション2: pnpmを直接使用
pnpm install
pnpm tauri:dev       # 開発モード
pnpm tauri:build     # プロダクションビルド
```

**要件**: Node.js 18+、pnpm、Rustツールチェーン

## 使い方

1. アプリを起動
2. 対応する全プロバイダー（Claude Code、Codex CLI、OpenCode）から会話データを自動スキャン
3. 左サイドバーでプロジェクトを閲覧 — タブバーでプロバイダー別フィルタリング
4. セッションをクリックしてメッセージを確認
5. タブでメッセージ、分析、トークン統計、最近の編集、セッションボードを切り替え

## 技術スタック

| レイヤー | 技術 |
|-------|------------|
| **バックエンド** | ![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white) ![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?logo=tauri&logoColor=white) |
| **フロントエンド** | ![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) |
| **状態管理** | ![Zustand](https://img.shields.io/badge/Zustand-433E38?logo=react&logoColor=white) |
| **ビルド** | ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) |
| **国際化** | ![i18next](https://img.shields.io/badge/i18next-26A69A?logo=i18next&logoColor=white) 5言語対応 |

## データプライバシー

**100%オフライン。** 会話データはどのサーバーにも送信されません。分析、トラッキング、テレメトリーは一切ありません。

データはあなたのマシンに留まります。

## トラブルシューティング

| 問題 | 解決策 |
|---------|----------|
| 「Claudeデータが見つかりません」 | `~/.claude`に会話履歴があることを確認 |
| パフォーマンスの問題 | 大量の履歴は初期読み込みが遅い場合あり — 仮想スクロールを使用 |
| 更新の問題 | 自動更新が失敗した場合、[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)から手動ダウンロード |

## コントリビュート

コントリビュート歓迎！始め方:

1. リポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feat/my-feature`)
3. コミット前にチェックを実行:
   ```bash
   pnpm tsc --build .        # TypeScript
   pnpm vitest run            # テスト
   pnpm lint                  # Lint
   ```
4. 変更をコミット (`git commit -m 'feat: add my feature'`)
5. ブランチにプッシュ (`git push origin feat/my-feature`)
6. プルリクエストを開く

利用可能なコマンドの完全なリストは[開発コマンド](CLAUDE.md#development-commands)を参照。

## ライセンス

[MIT](LICENSE) — 個人・商用利用無料。

---

<div align="center">

このプロジェクトが役に立ったら、スターをお願いします！

[![Star History Chart](https://api.star-history.com/svg?repos=jhlee0409/claude-code-history-viewer&type=Date)](https://star-history.com/#jhlee0409/claude-code-history-viewer&Date)

</div>
