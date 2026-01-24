# Claude Code History Viewer

`~/.claude`に保存されたClaude Codeの会話履歴を閲覧するデスクトップアプリ。

🌐 [ウェブサイト](https://jhlee0409.github.io/claude-code-history-viewer/) | 📦 [ダウンロード](https://github.com/jhlee0409/claude-code-history-viewer/releases)

![Version](https://img.shields.io/badge/Version-1.1.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> 

## スクリーンショット

<p align="center">
  <img width="49%" alt="会話履歴" src="https://github.com/user-attachments/assets/9a18304d-3f08-4563-a0e6-dd6e6dfd227e" />
  <img width="49%" alt="分析ダッシュボード" src="https://github.com/user-attachments/assets/0f869344-4a7c-4f1f-9de3-701af10fc255" />
</p>
<p align="center">
  <img width="49%" alt="トークン統計" src="https://github.com/user-attachments/assets/d30f3709-1afb-4f76-8f06-1033a3cb7f4a" />
  <img width="49%" alt="最近の編集" src="https://github.com/user-attachments/assets/8c9fbff3-55dd-4cfc-a135-ddeb719f3057" />
</p>

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

## 使い方

1. アプリを起動
2. `~/.claude`フォルダから会話データを自動スキャン
3. 左サイドバーでプロジェクトを閲覧
4. セッションをクリックしてメッセージを確認
5. タブでメッセージ、統計、トークン分析、最近の編集を切り替え

## データプライバシー

ローカルでのみ実行。会話データはサーバーに送信されません。

匿名の使用統計（アプリ起動、機能使用）は、アプリ改善のため[Aptabase](https://aptabase.com/)を通じて収集されます。会話内容や個人情報は追跡されません。

## トラブルシューティング

**「Claudeデータが見つかりません」**: `~/.claude`フォルダと会話履歴があるか確認。

**パフォーマンス問題**: 大量の会話履歴は初期読み込みが遅い場合あり。仮想スクロールで処理。

**更新エラー**: 自動更新が失敗した場合、[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)から手動ダウンロード。

## 技術スタック

- **バックエンド**: Rust + Tauri v2
- **フロントエンド**: React 19, TypeScript, Tailwind CSS, Zustand
- **ビルド**: Vite, just

## ライセンス

MIT License - [LICENSE](LICENSE)参照。

---

[Issue登録](https://github.com/jhlee0409/claude-code-history-viewer/issues)で質問やバグレポート。
