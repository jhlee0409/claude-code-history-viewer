<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**AIコーディングアシスタントのための統合履歴ビューア。**

**Claude Code**、**Gemini CLI**、**Antigravity**、**Codex CLI**、**Cline**、**Cursor**、**Aider**、**OpenCode**、**ForgeCode**、**CodeBuddy Code**の会話履歴を閲覧・検索・分析 — デスクトップアプリまたはヘッドレスサーバーとして。100%オフライン。

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

**ヘッドレスサーバー** — 任意のブラウザからアクセス：

```bash
brew install jhlee0409/tap/cchv-server   # or: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

Docker、VPS、systemdのセットアップは[サーバーモード](#サーバーモード-webui)をご覧ください。

---

## なぜ作ったのか

AIコーディングアシスタントは数千もの会話メッセージを生成しますが、ツール間で履歴を振り返る方法を提供していません。CCHVがこの課題を解決します。

**25のアシスタント。1つのビューア。** Claude Code、GitHub Copilot、Gemini CLI、Antigravity、Codex CLI、Cline（Roo Code・Kilo Code含む）、Cursor、Cursor Agent、Aider、OpenCode、ForgeCode、CodeBuddy Code、Kimi、Kiro、Amazon Q CLI、Continue.dev、PearAI、Goose、Crush、llm、Open Interpreter、Qwen Code、Zed、OpenHands、Traeのセッションをシームレスに切り替え — トークン使用量を比較し、プロバイダー間で検索し、ワークフローを1つのインターフェースで分析。

| プロバイダー | データの場所 | 取得できる情報 |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | 完全な会話履歴、ツール使用、思考プロセス、コスト |
| **GitHub Copilot** | `~/.copilot/session-state/`（CLI & Desktop）、VS Code `workspaceStorage/.../chatSessions/` | Copilot CLI、Copilot Desktop、VS Code Copilot Chatの履歴（読み取り専用、WSL対応） |
| **Gemini CLI** | `~/.gemini/history/` | ツール呼び出しを含む会話履歴 |
| **Antigravity** | `~/.gemini/antigravity/` | `brain/`配下の会話状態と`.token-monitor/rpc-cache/v1/`配下のトークンモニターデータ |
| **Codex CLI** | `~/.codex/sessions/` | エージェント応答を含むセッションロールアウト |
| **Cline**（Roo Code・Kilo Code含む） | VS Code `globalStorage/<ext>/tasks/` | Clineファミリー全体のタスクベースの履歴 |
| **Cursor** | `~/.cursor/` | Composerとチャットの会話 |
| **Cursor Agent** | `~/.cursor/projects/.../agent-transcripts/` | エージェントトランスクリプト（Cursor IDEソースとは別系統） |
| **Aider** | プロジェクトディレクトリ | チャット履歴と編集ログ |
| **OpenCode** | `~/.local/share/opencode/` | 会話セッションとツール結果 |
| **ForgeCode** | `~/.forge/.forge.db` | SQLiteデータベースの会話履歴 |
| **CodeBuddy Code** | `~/.codebuddy/projects/` | ツール呼び出しを含む会話履歴（Claude Codeフォーク形式） |
| **Kimi** | `~/.kimi/` | `kimi -r`によるresume対応のセッション履歴 |
| **Kiro** | `kiro-cli/data.sqlite3` | SQLiteベースの会話履歴 |
| **Amazon Q CLI** | `…/amazon-q/data.sqlite3` | SQLite `conversations`ストア（Kiro CLIプロバイダーと同一形式） |
| **Continue.dev** | `~/.continue/sessions/*.json` | セッション単位のJSON、ワークスペース別にグループ化（`CONTINUE_GLOBAL_DIR`対応） |
| **PearAI** | `~/.pearai/sessions/` | Continueフォーク — 同一のセッション形式 |
| **Goose** | `…/goose/sessions/sessions.db` | Blockのエージェント — SQLiteセッション + メッセージ |
| **Crush** | プロジェクトごとの`./.crush/crush.db` | CharmのTUI — SQLite、一般的なコードルート全体から検出 |
| **llm** | `…/io.datasette.llm/logs.db` | Simon WillisonのCLI — トークン数付きSQLite conversations/responses |
| **Open Interpreter** | `~/.openinterpreter/sessions/` | Codex形式のロールアウト（Codexパーサーを再利用；`INTERPRETER_HOME`で上書き可） |
| **Qwen Code** | `~/.qwen/projects/.../chats/` | セッション単位のJSONLトランスクリプト（ツール呼び出し、思考プロセス、トークン使用量） |
| **Zed** | `…/Zed/threads/threads.db` | Agent Panelスレッド — SQLite + Zstd圧縮JSON |
| **OpenHands** | `~/.openhands/sessions/` | クラシックなイベントストア形式の会話 |
| **Trae** | `…/Trae/User/workspaceStorage/.../state.vscdb` | ワークスペース単位のチャット（icubeストア；実験的、リバースエンジニアリングによる対応） |

ベンダーロックインなし。クラウド依存なし。ローカルの会話ファイルを美しくレンダリング。

Antigravityに関する注記：ビューアはAntigravityルートを`~/.gemini/antigravity`として解決し、セッション状態を`brain/`から、usage/キャッシュ成果物を`.token-monitor/rpc-cache/v1/`から読み取ります。これは現在のランタイムレイアウトおよび`src-tauri/src/commands/antigravity.rs`のルートリゾルバと一致しています。

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
| **マルチプロバイダー対応** | **25のAIコーディングアシスタント**を統合ビューアで閲覧 — Claude Code、GitHub Copilot、Gemini CLI、Codex CLI、Cursor / Cursor Agent、Cline（Roo Code・Kilo Code含む）、Aider、OpenCode、ForgeCode、CodeBuddy Code、Kimi、Kiro、Antigravity、Amazon Q CLI、Continue.dev、PearAI、Goose、Crush、llm、Open Interpreter、Qwen Code、Zed、OpenHands、Trae — プロバイダー別フィルタリング、ツール間比較 |
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
| **Antigravity** | 標準のプロバイダーパイプラインで読み込まれます。セッションはtoken monitorのキャッシュから取得され、専用UIモードを増やさずに、プロジェクト/セッション表示、トークン統計、分析、グローバル検索に参加します。 |

### v1.18.0の新機能

| 機能 | 説明 |
|------|------|
| **起動の高速化** | プロバイダースキャナーが逐次実行ではなく並行実行されるようになり、ビューアと並行して動作するツールがロックしたSQLiteデータベースがスキャン全体を停滞させることがなくなりました — 数秒間の「Initializing app…」ハングを解消 |
| **検索結果のコンテキスト** | グローバル検索結果に各マッチがどの会話に属するかが表示され、セッション間で同じテキストを共有するマッチを区別しやすくなりました |
| **折りたたみ可能なプロバイダーフィルター** | サイドバーのプロバイダーフィルターパネルを折りたたんでセッションリストの縦スペースを確保可能；折りたたみ時のヘッダーにもアクティブなフィルターの概要と件数を表示 |
| **検証可能なプロジェクト名** | プロジェクトの識別が、古いトランスクリプトに記録された陳腐化した`cwd`よりディスク上のフォルダ名を優先するようになり、移動済み・subagent記録のプロジェクトが正しくグループ化されます（初回のみ透過的な再スキャン） |
| **修正** | subagentセッションのエクスポートが空ファイルではなくメッセージを含むように修正；OpenCodeのグローバルセッションをディレクトリ別に分割（空ディレクトリのセッションも正しく読み込み）；OpenCodeセッションキャッシュに上限を設けメモリの無制限な増加を防止 |

### v1.17.0の新機能

| 機能 | 説明 |
|------|------|
| **11の新プロバイダー** | **Continue.dev**と**PearAI**（`~/.continue` / `~/.pearai`のセッションJSON）、**Goose**（SQLite）、**Crush**（プロジェクトごとのSQLite）、**llm**（Simon WillisonのCLI）、**Amazon Q CLI**、**Open Interpreter**（Codex形式ロールアウト）、**Qwen Code**、**Zed**（Agent Panelスレッド — SQLite + Zstd）、**OpenHands**、**Trae**の履歴を閲覧可能に — さらにClineファミリーリーダー経由で**Kilo Code**にも対応。対応アシスタントが14から25に拡大。 |
| **Kiro Windowsパス修正** | Kiro CLIデータベースがWindows上で誤った`AppData\Roaming`ではなく`data_local_dir()`（`%LOCALAPPDATA%`）で解決されるように修正 |

### v1.16.0の新機能

| 機能 | 説明 |
|------|------|
| **GitHub Copilotプロバイダー** | **Copilot CLI**（`~/.copilot/session-state`）、**Copilot Desktop**、**VS Code Copilot Chat**（`workspaceStorage/.../chatSessions`）の読み取り専用履歴 — WSL対応、グローバル検索付き |
| **ヘッドレスセッションエクスポート** | 新しい`--export <session-id\|/abs/path.jsonl> [--format html\|json] [--output <file>]`フラグがGUIを起動せずにHTMLまたはJSONレポートを出力して終了 — SSH/CI用途向け |
| **ワンクリック完全バックアップ** | Archive Managerの「Full Backup」カードで、すべてのClaude Codeプロジェクトの全セッションを一括でアーカイブにコピー — Claude Codeの自動クリーンアップから履歴を保護 |
| **スキル & サブエージェント分析** | 新しい「Most Used Skills」/「Most Used Subagents」セクションがClaudeの`Skill`と`Agent`呼び出しを名前別に集計 — プロジェクト単位とグローバル単位の両方に対応 |
| **修正** | フォントサイズ設定が左パネルだけでなくアプリ全体（メッセージビューア、分析、セッションボード、設定）に適用されるように修正；システムのゴミ箱が利用できない場合（例：Windowsのごみ箱が無効）にセッション削除が完全削除にフォールバック |

### v1.15.0の新機能

| 機能 | 説明 |
|------|------|
| **3つの新プロバイダー** | **Cursor Agent**（agent-transcripts、Cursor IDEソースとは別系統）、**Kimi**（`~/.kimi`、`kimi -r`によるresume対応）、**Kiro**（SQLiteベースの`kiro-cli`）の履歴を閲覧可能に |
| **Codexネイティブのリネーム & 削除** | Codexセッションのリネーム — タイトルは`state_5.sqlite`に書き込まれ`codex`のresumeピッカーに表示され、ロールアウトトランスクリプトは不変のまま — さらに新しいアプリ内確認ダイアログによるセッション削除；`CODEX_HOME`に対応（sessions + archived） |
| **スキャンと検索の高速化** | Codexプロジェクトリストはセッションメタ行のみをスキャン（mmap + memchr）し、各プロバイダーが独立してスキャンするため、遅いプロバイダーが速いプロバイダーをブロックしなくなりました；セッション内検索のインデックス作成をWeb Workerに移行し、大きなセッションでUIがフリーズしなくなりました |
| **正確なClaudeプロジェクトパス** | プロジェクト名と`claude --resume`の作業ディレクトリが、非可逆なフォルダエンコーディングではなくセッションメタデータから解決されるようになりました（初回起動時のみ透過的な再スキャン） |
| **修正** | 仮想化メッセージ履歴の空白ギャップを削除；macOSでのKimi自動更新を修正；マルチバイトのワークスペースフォルダ名でのCursorスキャンクラッシュを修正 |

### v1.14.0

| 機能 | 説明 |
|------|------|
| **CodeBuddy Codeプロバイダー** | CodeBuddy Codeを追加 — 他のAIコーディングアシスタントと並べて会話履歴を閲覧可能 |
| **WebUIアカウントログイン** | `--serve`モードにオプションのアカウント認証（Argon2id + サーバーサイドセッション + CSRF）、読み取り専用モード、リバースプロキシホスティング用のベースパス対応を追加 |
| **メッセージフィルターの永続化** | ロールとコンテンツタイプのフィルターがセッション切り替えとアプリ再起動後も維持されるようになりました |
| **Subagentセッションの安定化** | 複数subagentのクリックマッピングと、大きなsubagentセッションを開く際の稀なクラッシュを修正 |
| **Linux IME入力** | Linuxの検索ボックスでのibus/fcitx入力（韓国語、中国語、日本語）を修正 |

### v1.13.0

| 機能 | 説明 |
|------|------|
| **macOSカスタムタイトルバー** | ドラッグ可能なオーバーレイヘッダーが従来のmacOSタイトルバーを置き換え、画面領域を効率的に利用；Linux/Windowsは影響なし |
| **セッションソースフィルター** | Claude Codeの`entrypoint`フィールドに基づいてセッションを作成元（CLI / VS Code / Desktop）でフィルタリング |
| **Codex Resumeサポート** | 右クリック「Resumeコマンドをコピー」がCodexセッションに対応し、`cd '<cwd>' && `プレフィックスを自動付加 — 貼り付けて実行で元のディレクトリで再開 |
| **料金精度の向上** | `claude-opus-4-7`の3倍過剰請求を修正；`gpt-5.4` / `gpt-5.5`料金を追加しCodexキャッシュトークンを分離処理 |
| **macOSアップデーター安定化** | Tauri v2 macOS再起動バグに対するOSレベルのネイティブ再起動フォールバック — 「手動で再起動してください」が表示されなくなりました |

> 過去のリリース: v1.12.0以前は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

### その他

| 機能 | 説明 |
|---------|-------------|
| **セッションコンテキストメニュー** | セッションID・resumeコマンド・ファイルパスのコピー、セッション削除、JSONLファイル表示、ネイティブリネームと検索連携 |
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

`No Cask with this name exists` と表示される場合は、上記の完全パスコマンドを実行してください。

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
> # Remove the manually installed app first
> rm -rf "/Applications/Claude Code History Viewer.app"
> # Then install via Homebrew
> brew tap jhlee0409/tap
> brew install --cask claude-code-history-viewer
> ```

## ソースからビルド

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

**要件**: Node.js 18+、pnpm、Rustツールチェーン

## サーバーモード (WebUI)

デスクトップ環境なしでヘッドレスHTTPサーバーとして実行 — VPS、リモートサーバー、Dockerに最適。サーバーバイナリがフロントエンドを内蔵しているため、**ファイル1つで動作します**。

> **サーバーデプロイが初めての方へ** ローカルテスト、VPSセットアップ、Dockerなどのステップバイステップガイドは[サーバーモードガイド](docs/server-guide.md)（[한국어](docs/server-guide.ko.md)）をご覧ください。

### クイックインストール

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# Or one-line script
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

どちらの方法でも`cchv-server`がPATHにインストールされます。

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

すべての`/api/*`エンドポイントはBearerトークン認証で保護されます。トークンはサーバー起動のたびに自動生成されstderrに出力されます。

- **ブラウザアクセス**: 起動時に表示される`?token=...`URLを使用。トークンは`localStorage`に自動保存。
- **APIアクセス**: `Authorization: Bearer <token>`ヘッダーを含める。
- **カスタムトークン**: `--token my-secret-token`で独自に設定。
- **環境変数**: `CCHV_TOKEN=your-token cchv-server --serve`（systemd/Dockerに便利）。
- **無効化**: `--no-auth`で認証を完全にスキップ（信頼できるネットワークでのみ使用）。

### リアルタイム更新

サーバーは`~/.claude/projects/`のファイル変更を監視し、SSE（Server-Sent Events）でブラウザに更新を送信します。別のターミナルでClaude Codeを使用すると、ビューアが自動更新されます — 手動リフレッシュは不要。

### Docker

```bash
docker compose up -d
```

起動後にトークンを確認:

```bash
docker compose logs webui
# 🔑 Auth token: ... ← paste this URL in your browser
```

`docker-compose.yml`は`~/.claude`、`~/.codex`、`~/.local/share/opencode`を読み取り専用ボリュームとしてマウントします。

### systemdサービス

Linuxでの永続的なサーバー運用には、提供されたsystemdテンプレートを使用:

```bash
sudo cp contrib/cchv.service /etc/systemd/system/
sudo systemctl edit --full cchv.service   # Set User= to your username
sudo systemctl enable --now cchv.service
```

### ソースからビルド（サーバーのみ）

```bash
just serve-build           # Build frontend + embed into server binary
just serve-build-run       # Build and run (embedded assets)

# Or run in development (external dist/):
just serve-dev             # Build frontend + run server with --dist
```

### ヘルスチェック

```
GET /health
→ { "status": "ok" }
```

## 使い方

1. アプリを起動
2. 対応する全25プロバイダー（Claude Code、Codex CLI、Gemini CLI、Cursor、Cline、Continue.dev、Goose、Zed、Qwen Code、Amazon Q CLIなど — 上記のプロバイダー表を参照）から会話データを自動スキャン
3. 左サイドバーでプロジェクトを閲覧 — タブバーでプロバイダー別フィルタリング
4. セッションをクリックしてメッセージを確認
5. タブでメッセージ、分析、トークン統計、最近の編集、セッションボードを切り替え

### コマンドラインフラグ

`--session` フラグで特定のセッションを事前選択した状態でアプリを起動できます。

```bash
# Full UUID
claude-code-history-viewer --session 1265cd74-caa9-472e-b343-c4f44b5cf12c

# UUID prefix (8+ hex-or-dash chars, up to 36) — first match wins
claude-code-history-viewer --session 1265cd74

# Equals form also works
claude-code-history-viewer --session=1265cd74
```

ビューアは既知のすべてのプロジェクトをスキャンして一致するセッションに移動し、一致するものがなければ通常起動に戻ります。hexまたはダッシュで構成される8〜36文字でも絶対パスでもない値は黙って無視されます。

## アクセシビリティ

キーボード操作、ロービジョン、スクリーンリーダーユーザー向けのアクセシビリティ機能を提供。

- キーボードファーストナビゲーション：
  - プロジェクトエクスプローラー、メインコンテンツ、メッセージナビゲーター、設定へのスキップリンク
  - `ArrowUp/ArrowDown/Home/End`でプロジェクトツリーナビゲーション、タイプアヘッド検索、`*`で兄弟グループ展開
  - `ArrowUp/ArrowDown/Home/End`と`Enter`でメッセージナビゲーターのナビゲーションとフォーカスメッセージを開く
- ビジュアルアクセシビリティ：
  - 永続的なグローバルフォントサイズスケーリング（`90%`、`100%`、`110%`、`120%`、`130%`）
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
| パフォーマンスの問題 | 大量の履歴は初期読み込みが遅い場合あり — アプリは仮想スクロールを使用 |
| 更新の問題 | 自動更新が失敗した場合、[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)から手動ダウンロード |

## コントリビュート

コントリビュート歓迎！始め方:

1. リポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feat/my-feature`)
3. コミット前にチェックを実行:
   ```bash
   pnpm tsc --build .        # TypeScript
   pnpm vitest run            # Tests
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
