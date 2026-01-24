# Claude Code History Viewer

浏览存储在`~/.claude`中的Claude Code对话历史的桌面应用。

🌐 [网站](https://jhlee0409.github.io/claude-code-history-viewer/) | 📦 [下载](https://github.com/jhlee0409/claude-code-history-viewer/releases)

![Version](https://img.shields.io/badge/Version-1.1.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> 

## 截图

<p align="center">
  <img width="49%" alt="对话历史" src="https://github.com/user-attachments/assets/9a18304d-3f08-4563-a0e6-dd6e6dfd227e" />
  <img width="49%" alt="分析仪表板" src="https://github.com/user-attachments/assets/0f869344-4a7c-4f1f-9de3-701af10fc255" />
</p>
<p align="center">
  <img width="49%" alt="令牌统计" src="https://github.com/user-attachments/assets/d30f3709-1afb-4f76-8f06-1033a3cb7f4a" />
  <img width="49%" alt="最近编辑" src="https://github.com/user-attachments/assets/8c9fbff3-55dd-4cfc-a135-ddeb719f3057" />
</p>

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

## 使用方法

1. 启动应用
2. 自动扫描`~/.claude`文件夹中的对话数据
3. 在左侧边栏浏览项目
4. 点击会话查看消息
5. 使用标签页切换消息、统计、令牌分析、最近编辑

## 数据隐私

仅本地运行。对话数据不会发送到服务器。

匿名使用统计（应用启动、功能使用）通过[Aptabase](https://aptabase.com/)收集以改进应用。不会追踪对话内容或个人信息。

## 故障排除

**"找不到Claude数据"**: 确认`~/.claude`文件夹和对话记录存在。

**性能问题**: 大量对话记录可能初始加载较慢。使用虚拟滚动处理。

**更新错误**: 如果自动更新失败，从[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)手动下载。

## 技术栈

- **后端**: Rust + Tauri v2
- **前端**: React 19, TypeScript, Tailwind CSS, Zustand
- **构建**: Vite, just

## 许可证

MIT License - 参见[LICENSE](LICENSE)。

---

[提交Issue](https://github.com/jhlee0409/claude-code-history-viewer/issues)提问或报告bug。
