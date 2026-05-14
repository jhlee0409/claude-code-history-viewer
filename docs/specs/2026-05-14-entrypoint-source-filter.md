# Entrypoint 来源区分（CLI / VS Code / Desktop）

> 状态：已确认，进入实现
> 日期：2026-05-14
> 范围：仅 entrypoint 一项能力（个人定制 fork）

## 背景与问题

Claude Code 的会话 JSONL 里每条记录都带一个顶层 `entrypoint` 字段，取值
`cli` / `claude-vscode` / `claude-desktop`，标识这条记录是从哪个客户端产生的。

上游的 `claude-code-history-viewer` 完全没有解析这个字段——`RawLogEntry`、
`SessionMetadataEntry`、`ClaudeSession` 里都没有它。因此它能读到 VS Code 插件
产生的会话（物理上就在同一批 jsonl 里），但**无法把它们识别 / 筛选出来**。
本次改造补上这个缺口。

注意：上游的 "provider" 概念是 Claude Code / Codex / Gemini 等**不同工具**之间
的区分，与本次的 entrypoint（Claude Code **内部**的客户端来源）是正交的两个维度。

## 目标

1. 后端解析每个 Claude 会话的 entrypoint，挂到 `ClaudeSession.entrypoint`。
2. 会话列表里每个会话显示一个来源徽章（CLI / VS Code / Desktop）。
3. 会话列表顶部加一个「来源」分段筛选器，可只看某一来源。
4. 筛选选择持久化（跟 `sessionSortOrder` 一样存 `settings.json`）。

## 非目标（YAGNI）

- 不动上游的 provider tab / 架构（降低未来同步上游的冲突面）。
- 不在 SessionBoard / AnalyticsDashboard 里做 entrypoint 图表。
- 不为非 Claude provider 引入 entrypoint（它们 `entrypoint: None`）。
- 不做"混合来源"标记——一个会话取它**首条**带 entrypoint 的记录值，
  与 `actual_session_id` / `first_timestamp` 的"首次命中即锁定"策略一致；
  会话基本是单一来源创建的，resume 到别的客户端是少数情况，按创建来源归类即可。

## 数据语义

- `ClaudeSession.entrypoint: Option<String>` —— 保存**原始值**（`"cli"` /
  `"claude-vscode"` / `"claude-desktop"` / 其他未来值 / `None` 表示老数据或无该字段）。
- 归一化（原始值 → 筛选类目 + 展示标签 + 颜色）只在前端做，集中在
  `src/utils/entrypoint.ts`，后端不做任何映射，保持对未来新 entrypoint 值的健壮性。

## 后端改造（Rust / Tauri）

### `src-tauri/src/models/message.rs`
- `RawLogEntry` 增加 `pub entrypoint: Option<String>`（JSON key 已是小写
  `entrypoint`，无需 `#[serde(rename)]`）。

### `src-tauri/src/models/session.rs`
- `ClaudeSession` 增加 `#[serde(skip_serializing_if = "Option::is_none")]
  pub entrypoint: Option<String>`。`skip` 保证 `None` 时不出现在序列化里，
  现有 `claude_session.snap` / `forgecode_session.snap` 快照**不变**。
- 同文件 `tests` 里的构造点补 `entrypoint: None`。

### `src-tauri/src/commands/session/load.rs`
- `CACHE_VERSION` 8 → 9：使旧的 `.session_cache.json`（无 entrypoint）失效、
  触发全量重解析，把 entrypoint 填进去。
- `SessionMetadataEntry`、`QuickLineClassifier`、`IncrementalParseState`
  各加 `entrypoint: Option<String>`。
- `extract_session_metadata_internal`：把 `entrypoint` 加入初始化元组
  （增量时取 `state.entrypoint.clone()`，否则 `None`）；Phase 1 / Phase 2
  里"首次命中即锁定"——`if entrypoint.is_none() { entrypoint = entry.entrypoint.clone() }`。
- `ClaudeSession { ... }` 构造点填 `entrypoint`。
- 从缓存重建 `IncrementalParseState` 处填 `entrypoint: session.entrypoint.clone()`。

### 其余 `ClaudeSession` 构造点
9 个 provider（gemini/aider/forgecode/opencode×2/codex/cursor/antigravity/cline）
+ `commands/archive.rs` + `commands/stats.rs` + `models/snapshot_tests.rs`×2：
统一补 `entrypoint: None`（这些不是 Claude Code 原生会话，本就没有 entrypoint）。

## 前端改造（React / TS）

### 类型
- `src/types/core/session.ts`：`ClaudeSession` 加 `entrypoint?: string`。
- `src/types/metadata.types.ts`：加
  `export type SessionEntrypointFilter = "all" | "cli" | "vscode" | "desktop"`。

### 归一化工具 `src/utils/entrypoint.ts`（新增）
- `normalizeEntrypoint(raw?: string): "cli" | "vscode" | "desktop" | null`
- `matchesEntrypointFilter(raw, filter): boolean`
- 每个类目的展示元数据（i18n key + 徽章配色 class）。

### Store `src/store/slices/settingsSlice.ts`（+ `types.ts`）
- 完全镜像 `sessionSortOrder` 的写法：state `sessionEntrypointFilter`
  （默认 `"all"`）、action `setSessionEntrypointFilter`、`loadUpdateSettings`
  里读回、写入 `settings.json`。

### `src/components/ProjectTree/components/SessionList.tsx`
- 现状：搜索 + 排序的控件块在普通渲染和虚拟滚动两条分支里**重复**了一份。
  本次把它抽成同文件内的 `SessionListControls` 子组件（消除重复，也方便塞
  新筛选器）——属于"动到的代码顺手修一下"的定向改进，不扩大范围。
- `SessionListControls` 内加一行「来源」分段控件（All / CLI / VS Code / Desktop），
  值来自 store。
- `filteredAndSortedSessions` 的 `useMemo` 里加一步 entrypoint 过滤。

### `src/components/SessionItem/components/SessionMeta.tsx`
- 在已有的 `storage_type` 徽章旁边，按同样的 span 样式渲染 entrypoint 徽章
  （CLI 绿 / VS Code 蓝 / Desktop 紫；`entrypoint` 为空则不渲染）。

### i18n（5 个 locale 的 `session.json`）
新增扁平 key：`session.filter.source.label/all/cli/vscode/desktop`、
`session.item.entrypoint.cli/vscode/desktop`。改完跑 `pnpm generate:i18n-types`。

## 错误处理与边界

- 老会话 / 缺字段：`entrypoint = None` → 前端不渲染徽章；筛选时只有选「All」
  能看到它们（选具体来源时无 entrypoint 的会话被过滤掉，符合直觉）。
- 未知的未来 entrypoint 值：`normalizeEntrypoint` 返回 `null`，按"无徽章"处理，
  不崩溃。
- 缓存：CACHE_VERSION 提升保证存量用户升级后看到的是带 entrypoint 的数据。

## 验证

- `cargo test`（含 message / session / snapshot 测试）。
- `pnpm test`（前端 vitest，含 `SessionList.test.tsx` / `SessionItem.test.tsx`）。
- `pnpm lint` + `pnpm build`（tsc 类型检查）。
- `pnpm tauri:dev` 实际拉起桌面应用，选中本机一个项目，确认：
  徽章出现、来源筛选器可用、刷新后筛选选择被记住。
