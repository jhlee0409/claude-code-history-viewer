# Claude Code History Viewer

浏览存储在`~/.claude`中的Claude Code对话历史的桌面应用。

![Version](https://img.shields.io/badge/Version-1.0.0--beta.4-orange.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> ⚠️ **Beta** - 可能不稳定或有变化

## 截图

<p align="center">
  <img width="49%" alt="Main Interface 1" src="https://github.com/user-attachments/assets/45719832-324c-40c3-8dfe-5c70ddffc0a9" />
  <img width="49%" alt="Main Interface 2" src="https://github.com/user-attachments/assets/bb9fbc9d-9d78-4a95-a2ab-a1b1b763f515" />
</p>

<img width="720" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/77dc026c-8901-47d1-a8ca-e5235b97e945" />

## 功能

- **浏览对话**: 按项目/会话浏览对话记录
- **搜索**: 在所有对话中搜索消息
- **统计**: 令牌使用量分析和API费用计算
- **多语言**: 英语、韩语、日语、中文
- **最近编辑**: 查看文件修改历史和恢复
- **其他**: 自动更新、文件夹更改、反馈

## 安装

从[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)下载适合您平台的安装文件。

## 从源码构建

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
pnpm install
pnpm tauri:build
```

**要求**: Node.js 18+、pnpm、Rust工具链

## 数据隐私

仅本地运行。不向服务器发送数据。

## 许可证

MIT
