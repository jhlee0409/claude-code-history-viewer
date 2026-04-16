<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**AIコーディングアシスタントのための統合履歴ビューア。**

**Claude Code**、**Gemini CLI**、**Antigravity**、**Codex CLI**、**Cline**、**Cursor**、**Aider**、**OpenCode**の会話履歴を閲覧・検索・分析 — デスクトップアプリまたはヘッドレスサーバーとして。100%オフライン。

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
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

## クイックスタート

**デスクトップアプリ** — ダウンロードして実行：

| プラットフォーム | ダウンロード |
|----------|----------|
| macOS (Universal) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) / [`.zip` (ポータブル)](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

**Homebrew** (macOS)：

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

**ヘッドレスサーバー** — ブラウザからアクセス：

```bash
brew install jhlee0409/tap/cchv-server   # または: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

Docker、VPS、systemdのセットアップは[サーバーモード](#サーバーモード-webui)をご覧ください。

---

## なぜ作ったのか

AIコーディングアシスタントは数千もの会話メッセージを生成しますが、ツール間で履歴を振り返る方法を提供していません。CCHVがこの課題を解決します。

**8つのアシスタント。1つのビューア。** Claude Code、Gemini CLI、Antigravity、Codex CLI、Cline、Cursor、Aider、OpenCodeのセッションをシームレスに切り替え — トークン使用量を比較し、プロバイダー間で検索し、ワークフローを1つのインターフェースで分析。

| プロバイダー | データの場所 | 取得できる情報 |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | 完全な会話履歴、ツール使用、思考プロセス、コスト |
| **Gemini CLI** | `~/.gemini/history/` | ツール呼び出しを含む会話履歴 |
| **Antigravity** | `~/.gemini/antigravity/.token-monitor/rpc-cache/v1/` | トークンモニターのセッション、usage スナップショット、分析向け統計 |
| **Codex CLI** | `~/.codex/sessions/` | エージェント応答を含むセッションロールアウト |
| **Cline** | `~/.cline/tasks/` | タスクベースの会話履歴 |
| **Cursor** | `~/.cursor/` | Composerとチャットの会話 |
| **Aider** | プロジェクトディレクトリ | チャット履歴と編集ログ |
| **OpenCode** | `~/.local/share/opencode/` | 会話セッションとツール結果 |

ベンダーロックインなし。クラウド依存なし。ローカルの会話ファイルを美しくレンダリング。

## 目次

- [主な機能](#主な機能)
- [インストール](#インストール)
- [ソースからビルド](#ソースからビルド)
- [サーバーモード (WebUI)](#サーバーモード-webui)
- [使い方](#使い方)
- [アクセシビリティ](#アクセシビリティ)
- [技術スタック](#技術スタック)
- [データプライバシー](#データプライバシー)
- [トラブルシューティング](#トラブルシューティング)
- [コントリビュート](#コントリビュート)
- [ライセンス](#ライセンス)

## 主な機能

### コア

| 機能 | 説明 |
|---------|-------------|
| **マルチプロバイダー** | **Claude Code**、**Gemini CLI**、**Antigravity**、**Codex CLI**、**Cline**、**Cursor**、**Aider**、**OpenCode**の会話を統合ビューアで閲覧 — プロバイダー別フィルタリング、ツール間比較 |
| **会話ブラウザ** | プロジェクト/セッション別に会話を閲覧（ワークツリーグループ化対応） |
| **グローバル検索** | 全プロバイダーの会話を瞬時に検索 |
| **分析ダッシュボード** | デュアルモードトークン統計（課金 vs 会話）、コスト内訳、プロバイダー分布チャート |
| **セッションボード** | マルチセッション視覚分析（ピクセルビュー、属性ブラッシング、アクティビティタイムライン） |
| **設定マネージャー** | スコープ対応のClaude Code設定エディタ（MCPサーバー管理付き） |
| **メッセージナビゲーター** | 右側折りたたみ式TOCで会話を素早くナビゲーション |
| **リアルタイム監視** | セッションファイルのライブ監視で即座に更新 |

### プロバイダーメモ

| プロバイダー | メモ |
|---------|-------|
| **Antigravity** | 既存の標準プロバイダーパイプラインで読み込まれます。セッションは token monitor のキャッシュから取得され、専用 UI モードを増やさずに、プロジェクト/セッション表示、トークン統計、分析、グローバル検索に参加します。 |

### v1.10.0の新機能

| 機能 | 説明 |
|---------|-------------|
| **月別カレンダーヒートマップ** | アクティビティヒートマップを月別カレンダーブロックに分割し、日ごとの可視化を改善 |
| **セッション管理** | セッション削除（ゴミ箱へ移動）とJSONLファイルをファイルエクスプローラーで表示 |
| **パスコピー** | プロジェクトコンテキストメニューからプロジェクトパスをコピー |
| **統計日付フィルター** | 分析ダッシュボードで日付範囲のフィルタリング |
| **Windowsポータブル** | ポータブル`.zip`ビルド — インストーラー不要で実行可能 |
| **ツール別カード** | Bash、Read、Edit、Glob、Grep、Write、WebFetch、WebSearch、Agentツール専用レンダリングカード |

### v1.9.0

| 機能 | 説明 |
|---------|-------------|
| **4つの新プロバイダー** | **Gemini CLI**、**Cline**、**Cursor**、**Aider**を追加 — 合計7つのAIコーディングアシスタントに対応 |
| **WSLサポート** | Windows Subsystem for Linux連携 — WSLディストロ内のClaude Codeプロジェクトをスキャン |
| **グローバル検索の強化** | プロジェクトフィルター、LRUキャッシュ、aho-corasickマルチパターン最適化、メッセージナビゲーション |
| **ズームコントロール** | ズームイン/アウトのキーボードショートカット |

### v1.6.0

| 機能 | 説明 |
|---------|-------------|
| **WebUIサーバーモード** | `--serve`でヘッドレスWebサーバーとして実行 — ブラウザからアクセス、VPS/Dockerデプロイ |
| **スクリーンショットキャプチャ** | 範囲選択、プレビューモーダル、複数選択エクスポート付きロングスクリーンショット |
| **アーカイブ管理** | セッションアーカイブの作成、閲覧、名前変更、エクスポート（ファイル別ダウンロード） |
| **アクセシビリティ** | キーボードナビゲーション、スクリーンリーダー対応、フォントスケーリング、ハイコントラストモード |
| **モバイルUI** | 390pxビューポート対応、ボトムタブバー |
| **外部リンク** | 全てのリンクがWebViewの代わりにシステムブラウザで開く |

### その他

| 機能 | 説明 |
|---------|-------------|
| **セッションコンテキストメニュー** | セッションID・再開コマンド・ファイルパスのコピー、セッション削除、JSONLファイル表示、ネイティブ名変更と検索連携 |
| **ANSIカラーレンダリング** | ターミナル出力を元のANSIカラーで表示 |
| **多言語対応** | 英語、韓国語、日本語、中国語（簡体字・繁体字） |
| **最近の編集** | ファイル変更履歴の確認と復元 |
| **自動更新** | スキップ/延期オプション付きビルトイン更新機能 |

## インストール

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

または、完全なCaskパスで直接インストール:

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

`No Cask with this name exists` と表示される場合は、上記の完全パスコマンドを使用してください。

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

## サーバーモード (WebUI)

デスクトップ環境なしでヘッドレスHTTPサーバーとして実行 — VPS、リモートサーバー、Dockerに最適。サーバーバイナリがフロントエンドを内蔵しているため、**ファイル1つで動作します**。

> **サーバーデプロイが初めての方へ** ローカルテスト、VPSセットアップ、Dockerなどのステップバイステップガイドは[サーバーモードガイド](docs/server-guide.md)をご覧ください。

### クイックインストール

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# またはワンラインスクリプト
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

### サーバー起動

```bash
cchv-server --serve
```

出力:

```
🔑 Auth token: b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
   Open in browser: http://192.168.1.10:3727?token=b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
👁 File watcher active: /home/user/.claude/projects
🚀 WebUI server running at http://0.0.0.0:3727
```

ブラウザでURLを開くと、トークンは自動的に保存されます。

### ビルド済みバイナリ

| プラットフォーム | アセット |
|----------|-------|
| Linux x64 | `cchv-server-linux-x64.tar.gz` |
| Linux ARM64 | `cchv-server-linux-arm64.tar.gz` |
| macOS ARM | `cchv-server-macos-arm64.tar.gz` |
| macOS x64 | `cchv-server-macos-x64.tar.gz` |

[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)からダウンロード。

**CLIオプション:**

| フラグ | デフォルト | 説明 |
|------|---------|-------------|
| `--serve` | — | **必須。** デスクトップアプリの代わりにHTTPサーバーを起動 |
| `--port <number>` | `3727` | サーバーポート |
| `--host <address>` | `0.0.0.0` | バインドアドレス（ローカルのみ: `127.0.0.1`） |
| `--token <value>` | 自動 (uuid v4) | カスタム認証トークン |
| `--no-auth` | — | 認証を無効化（公開ネットワークでは非推奨） |
| `--dist <path>` | 内蔵 | 内蔵フロントエンドの代わりに外部`dist/`ディレクトリを使用 |

### 認証

すべての`/api/*`エンドポイントはBearerトークン認証で保護されます。トークンはサーバー起動時に自動生成されstderrに出力されます。

- **ブラウザアクセス**: 起動時に表示される`?token=...`URLを使用。トークンは`localStorage`に自動保存。
- **APIアクセス**: `Authorization: Bearer <token>`ヘッダーを含める。
- **カスタムトークン**: `--token my-secret-token`で独自に設定。
- **無効化**: `--no-auth`で認証をスキップ（信頼できるネットワークでのみ）。

### リアルタイム更新

サーバーは`~/.claude/projects/`のファイル変更を監視し、SSE（Server-Sent Events）でブラウザに更新を送信します。別のターミナルでClaude Codeを使用すると、ビューアが自動更新されます — 手動リフレッシュは不要。

### Docker

```bash
docker compose up -d
```

起動後にトークンを確認:

```bash
docker compose logs webui
# 🔑 Auth token: ... ← このURLをブラウザに貼り付け
```

`docker-compose.yml`は`~/.claude`、`~/.codex`、`~/.local/share/opencode`を読み取り専用ボリュームとしてマウントします。

### systemdサービス

Linuxでの永続的なサーバー運用には、提供されたsystemdテンプレートを使用:

```bash
sudo cp contrib/cchv.service /etc/systemd/system/
sudo systemctl edit --full cchv.service   # User=をユーザー名に設定
sudo systemctl enable --now cchv.service
```

### ソースからビルド（サーバーのみ）

```bash
just serve-build           # フロントエンドビルド + サーバーバイナリに埋め込み
just serve-build-run       # ビルドして実行（埋め込みアセット）

# または開発モードで実行（外部dist/）:
just serve-dev             # フロントエンドビルド + --distでサーバー実行
```

### ヘルスチェック

```
GET /health
→ { "status": "ok" }
```

## 使い方

1. アプリを起動
2. 対応する全プロバイダー（Claude Code、Gemini CLI、Codex CLI、Cline、Cursor、Aider、OpenCode）から会話データを自動スキャン
3. 左サイドバーでプロジェクトを閲覧 — タブバーでプロバイダー別フィルタリング
4. セッションをクリックしてメッセージを確認
5. タブでメッセージ、分析、トークン統計、最近の編集、セッションボードを切り替え

## アクセシビリティ

キーボード操作、ロービジョン、スクリーンリーダーユーザー向けのアクセシビリティ機能を提供。

- キーボードファーストナビゲーション：
  - プロジェクトエクスプローラー、メインコンテンツ、メッセージナビゲーター、設定へのスキップリンク
  - `ArrowUp/ArrowDown/Home/End`でプロジェクトツリーナビゲーション、タイプアヘッド検索、`*`で兄弟グループ展開
  - `ArrowUp/ArrowDown/Home/End`と`Enter`でメッセージナビゲーターのナビゲーションとフォーカスメッセージを開く
- ビジュアルアクセシビリティ：
  - グローバルフォントサイズスケーリング（`90%`、`100%`、`110%`、`120%`、`130%`）
  - 設定でハイコントラストモードトグル
- スクリーンリーダーサポート：
  - ランドマークとツリー/リストセマンティクス（`navigation`、`tree`、`treeitem`、`group`、`listbox`、`option`）
  - ステータス/ローディングとプロジェクトツリーナビゲーション/選択変更のライブアナウンスメント
  - `aria-describedby`によるインラインキーボードヘルプの説明

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
