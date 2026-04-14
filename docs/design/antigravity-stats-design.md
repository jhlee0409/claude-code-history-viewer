# Antigravity 统计接入设计

## 1. 目标

### 1.1 新增约束

本次需求在原设计基础上新增以下强约束，优先级高于后文的扩展性设计：

1. 新增 `antigravity` 的目标是把它作为一个新的 provider 接入现有应用。
2. 不能修改基线界面的视觉结果。
3. 不能为了接入 `antigravity` 引入新的页面布局、导航结构、Header 结构、Sidebar 结构、Bottom Tab 结构或样式体系。
4. 不允许为了 `antigravity` 单独重做 UI；应复用基线已有界面、布局和样式代码。
5. 前端 UI 改动方式应与新增 `opencode` 支持保持同一思路：只补 provider 枚举、标签、过滤、扫描、列表加载、消息加载、统计接线等必要能力，尽可能小改。
6. 如果某能力无法在不改动基线界面结构的前提下接入，则优先降级该能力，而不是新增专用 UI。

当前改动的目标不是单独做一个只读页面，而是把 `antigravity` 作为一个完整 provider 接入现有应用的数据流：

1. provider 检测
2. 项目扫描
3. session 列表
4. 消息加载
5. token stats / analytics / global stats
6. 全文搜索

明确排除：

1. 不以新增独立 `Antigravity Usage` 页面作为本次需求前提。
2. 不以新增 Header 入口、移动端独立 Tab、单独路由或新的页面容器作为接入条件。

这里有两套并行数据流：

1. `rpc-cache` provider 数据流
2. `monitor-state` 独立汇总数据流

两者都来自 `~/.gemini/antigravity`，但职责不同。

## 2. 数据源

### 2.1 Provider 数据源

用于项目树、session 列表、消息页、统计页。

路径：

```text
~/.gemini/antigravity/.token-monitor/rpc-cache/v1/
  <session-id>/
    manifest.json
    usage.jsonl
```

其中：

1. `manifest.json` 提供 step 数、导出时间、服务端修改时间
2. `usage.jsonl` 是每次 usage 记录的原始来源

### 2.2 独立汇总页数据源

用于 `Antigravity Usage` 页面。

路径：

```text
~/.gemini/antigravity/
  monitor-state.json
  monitor-state.archive-YYYY-MM.json
```

其中：

1. `monitor-state.json` 是活跃状态
2. `monitor-state.archive-*.json` 是归档状态

## 3. 后端数据流

### 3.1 Provider 检测

入口：

`src-tauri/src/providers/mod.rs`

流程：

1. 调用 `crate::commands::antigravity::get_antigravity_root()`
2. 拼出 `~/.gemini/antigravity/.token-monitor/rpc-cache/v1`
3. 如果目录存在，则注册 provider：
   - `id = "antigravity"`
   - `display_name = "Antigravity"`
   - `base_path = ~/.gemini/antigravity`

产出：

1. `detect_providers()` 返回的 provider 列表包含 `antigravity`
2. 前端 provider filter / provider scan 能看到它

### 3.2 项目扫描

入口：

`src-tauri/src/commands/multi_provider.rs`

provider 实现：

`src-tauri/src/providers/antigravity.rs`

流程：

1. `scan_all_projects()` 在 active providers 包含 `antigravity` 时调用 `providers::antigravity::scan_projects()`
2. `scan_projects()` 扫描 `rpc-cache/v1/*`
3. 仅统计包含 `usage.jsonl` 的 session 目录
4. 聚合成一个虚拟项目：
   - `name = "Antigravity"`
   - `path = rpc-cache/v1`
   - `provider = "antigravity"`

设计取舍：

1. `antigravity` 当前在项目树里表现为单项目 provider
2. 该项目下的每个子目录对应一个 session

### 3.3 Session 加载

入口：

`src-tauri/src/commands/multi_provider.rs`

provider 实现：

`src-tauri/src/providers/antigravity.rs`

流程：

1. `load_provider_sessions(provider="antigravity")`
2. 调用 `providers::antigravity::load_sessions()`
3. 对每个 `usage.jsonl`：
   - 统计 call 数
   - 累计 input/output token
   - 从 `manifest.json` 提取 step 数
   - 生成 `ClaudeSession`

字段映射：

1. `session_id = 目录名`
2. `file_path = session 目录路径`
3. `message_count = usage call_count`
4. `summary = "<short-id> (N calls · M steps · in=... out=...)"`
5. `provider = "antigravity"`

### 3.4 消息加载

入口：

`src-tauri/src/commands/multi_provider.rs`

provider 实现：

`src-tauri/src/providers/antigravity.rs`

流程：

1. `load_provider_messages(provider="antigravity")`
2. 调用 `providers::antigravity::load_messages(session_path)`
3. 逐行读取 `usage.jsonl`
4. 对每条 `recordType = "usage"` 生成两条 `ClaudeMessage`

生成规则：

1. 一条 synthetic `user` 消息
   - 仅用于让消息页保持“对话成对显示”
   - 不携带 `usage`
2. 一条真实 `assistant` 消息
   - 携带 `TokenUsage`
   - 包含 input/output/cache token

注意：

1. 真实统计数据来自 `assistant` 消息上的 `usage`
2. synthetic `user` 消息仅用于展示，不代表真实 usage 记录

### 3.5 独立 Antigravity 汇总命令

文件：

`src-tauri/src/commands/antigravity.rs`
`src-tauri/src/models/antigravity.rs`

暴露命令：

1. `load_antigravity_state`
2. `get_antigravity_session`
3. `get_antigravity_project_summary`

流程：

1. 读取 `monitor-state.json`
2. 扫描所有 `monitor-state.archive-*.json`
3. 按 session id 合并 archive 和 active
4. 计算 `AntigravityProjectSummary`

这个链路不依赖 `rpc-cache` provider 消息解析，主要服务独立的 `Antigravity Usage` 页面。

### 3.6 全文搜索

入口：

`src-tauri/src/commands/multi_provider.rs`

provider 实现：

`src-tauri/src/providers/antigravity.rs`

流程：

1. `search_all_providers()` 在 active providers 包含 `antigravity` 时调用 `providers::antigravity::search()`
2. `search()` 扫描 `rpc-cache/v1/*` 下所有 session 目录
3. 对每个 session 的 `usage.jsonl` 做前缀匹配或 model 名匹配
4. 返回匹配 session 的 `ClaudeMessage` 列表

搜索口径：

1. session ID 前缀或子串匹配
2. model 名子串匹配
3. 返回结果按 timestamp 降序排列

注意：

1. `usage.jsonl` 不包含自然对话内容，搜索基于 session 元数据
2. 搜索结果为 synthetic 消息，不携带真实 usage

## 4. 统计链路接入

核心文件：

`src-tauri/src/commands/stats.rs`

### 4.1 Provider 识别

新增：

1. `StatsProvider::Antigravity`
2. `detect_project_provider()` 识别 antigravity path
3. `detect_session_provider()` 识别 antigravity session path

辅助函数：

1. `is_antigravity_path(path)`

规则：

1. 只要路径位于 `~/.gemini/antigravity` 下，即视为 `StatsProvider::Antigravity`

### 4.2 统一 provider 统计入口

以下函数已接入 `Antigravity`：

1. `collect_provider_global_file_stats`
2. `resolve_provider_project_name`
3. `resolve_provider_project_name_from_session`
4. `load_provider_sessions_for_stats`
5. `load_provider_messages_for_stats`
6. `get_project_token_stats`
7. `get_project_stats_summary`
8. `get_session_comparison`
9. `get_session_token_stats`
10. `get_global_stats_summary`

实现方式：

1. 直接复用 `providers::antigravity::{scan_projects, load_sessions, load_messages}`
2. 不再走之前 `get_global_stats_summary()` 里那段手工拼接的 experimental Antigravity 汇总逻辑

### 4.3 统计口径

为了避免重复计数，统计链路新增了：

1. `is_synthetic_antigravity_prompt`
2. `should_include_stats_message`

规则：

1. `provider == "antigravity"`
2. `message_type == "user"`
3. `usage == None`

同时满足以上条件时，视为 synthetic 占位消息，不纳入统计。

这不表示忽略 Antigravity 数据。被排除的只是消息视图里人为补出的包装消息；真实 usage 数据仍全部保留，并通过对应的 `assistant` 消息进入：

1. token 统计
2. session comparison
3. project summary
4. global summary
5. provider distribution

### 4.4 当前统计含义

对 `antigravity` 而言：

1. `message_count` 统计的是 usage assistant 记录数，不是 UI 中渲染出来的消息条数
2. `total_tokens` 来自 usage 中的 input/output/cache 汇总
3. `project summary` / `global summary` 均走统一 provider 链路

## 5. 前端数据流

### 5.1 Provider 过滤与扫描

相关文件：

1. `src/utils/providers.ts`
2. `src/components/ProjectTree/index.tsx`
3. `src/store/slices/providerSlice.ts`
4. `src/store/slices/projectSlice.ts`

流程：

1. `PROVIDER_IDS` 新增 `antigravity`
2. 初始化时调用 `detect_providers`
3. `scanProjects()` 使用 `scan_all_projects`
4. `ProjectTree` 的 provider tab 会展示 `antigravity`
5. 选中 provider 后前端做项目过滤

### 5.2 项目与消息视图

相关文件：

1. `src/App.tsx`
2. `src/layouts/AppLayout.tsx`

行为：

1. 选中 `antigravity` 项目时，走普通 provider 项目流
2. 不新增独立 `Antigravity Usage` 页面
3. `token stats` / `analytics` 等已存在页面在可复用前提下对 `antigravity` 正常发起请求
4. 对无法与基线 UI 语义对齐的能力，默认隐藏入口或返回“不支持”，不新增专用 UI 兜底

### 5.3 前端 Stats 链路接入规则（新增约束）

> 本节是基于“antigravity 作为 provider 最小接入”原则的强约束，优先级高于早期设计中的双链路方案。

规则：

1. `loadSessionTokenStats()`、`loadProjectTokenStats()`、`loadProjectStatsSummary()`、`loadSessionComparison()` 等前端统计加载函数**不应为 `antigravity` 新增 provider 特判分支**。
2. 这些函数应直接调用通用统计 API（`fetchSessionTokenStats` / `fetchProjectTokenStats` 等），由后端 `stats.rs` 的 `StatsProvider::Antigravity` 分支处理数据聚合。
3. **不应引入** `antigravityAnalytics.ts`、`antigravityApi.ts` 等专用前端工具层来处理 antigravity 的 Token Stats / Analytics。
4. `load_antigravity_state` / `get_antigravity_session` 命令仅服务于可选的独立 `Antigravity Usage` 页面，**不应出现**在通用统计链路（Token Stats / Analytics / Global Stats）的代码路径中。

判断标准：

1. 正确的做法：`antigravity` 与 `opencode`、`codex` 等其他 provider 在前端 messageSlice 中完全对称——无任何特判，直接走通用统计路径。
2. 错误的做法：在 messageSlice 中写 `if (provider === "antigravity") { ... loadAntigravityState() ... return; }`，这绕开了后端已完整接线的统一统计路由。


## 6. 端到端时序

### 6.1 应用启动到 provider 可见

```text
App initialize
  -> providerSlice.detectProviders()
  -> Tauri: detect_providers
  -> Rust: providers::detect_providers()
  -> Rust: antigravity root / rpc-cache 检测
  -> 返回 providers[]
  -> projectSlice.scanProjects()
  -> Tauri: scan_all_projects(activeProviders)
  -> Rust: multi_provider::scan_all_projects()
  -> Rust: providers::antigravity::scan_projects()
  -> 返回 ClaudeProject[]
  -> ProjectTree 渲染 provider tabs + project list
```

### 6.2 点击 Antigravity 项目到消息页

```text
用户点击 ProjectTree 中的 Antigravity 项目
  -> App.handleProjectSelect(project)
  -> projectSlice.selectProject(project)
  -> Tauri: load_provider_sessions(provider="antigravity", projectPath)
  -> Rust: providers::antigravity::load_sessions()
  -> 返回 ClaudeSession[]
  -> SessionList 渲染

用户点击某个 session
  -> App.handleSessionSelect(session)
  -> messageSlice.selectSession(session)
  -> Tauri: load_provider_messages(provider="antigravity", sessionPath)
  -> Rust: providers::antigravity::load_messages()
  -> usage.jsonl -> synthetic user + real assistant
  -> 返回 ClaudeMessage[]
  -> MessageViewer 渲染
```

### 6.3 从 Antigravity 项目进入统计页

```text
用户点击 Token Stats / Analytics / Global Stats
  -> analyticsActions.switchTo*
  -> Tauri: get_project_token_stats / get_project_stats_summary / get_global_stats_summary
  -> Rust: stats.rs 检测 StatsProvider::Antigravity
  -> Rust: load_provider_sessions_for_stats()
  -> Rust: load_provider_messages_for_stats()
  -> Rust: should_include_stats_message()
     -> 排除 synthetic user
     -> 保留真实 assistant usage
  -> 聚合 token / session / project / provider 统计
  -> 返回前端统计模型
  -> TokenStatsViewer / AnalyticsDashboard 渲染
```

## 7. 文件职责矩阵

| 文件 | 角色 | 输入 | 输出 |
| --- | --- | --- | --- |
| `src-tauri/src/providers/mod.rs` | provider 注册与检测 | 本地 provider 根目录 | `ProviderInfo[]` |
| `src-tauri/src/providers/antigravity.rs` | rpc-cache provider 适配层 | `rpc-cache/v1/*` | `ClaudeProject[]` / `ClaudeSession[]` / `ClaudeMessage[]` |
| `src-tauri/src/commands/multi_provider.rs` | 多 provider 路由入口 | 前端 provider 命令 | 对应 provider 数据 |
| `src-tauri/src/commands/stats.rs` | 统一统计聚合 | provider messages / session paths | token stats / analytics / global summary |
| `src/utils/providers.ts` | provider 常量与 label | provider id | label / badge / capability |
| `src/components/ProjectTree/index.tsx` | provider tabs + 项目树 | projects + activeProviders | provider filter UI |
| `src/App.tsx` | 项目/session 选择协调 | project/session events | 当前主视图切换 |
| `src/layouts/AppLayout.tsx` | 页面级容器与既有视图渲染 | currentView | 内容区域渲染 |

## 8. 已修改文件

### 8.1 Rust

1. `src-tauri/src/models/antigravity.rs`
2. `src-tauri/src/models.rs`
3. `src-tauri/src/commands/mod.rs`
4. `src-tauri/src/commands/multi_provider.rs`
5. `src-tauri/src/commands/stats.rs`
6. `src-tauri/src/lib.rs`
7. `src-tauri/src/providers/antigravity.rs`
8. `src-tauri/src/providers/mod.rs`

### 8.2 前端

1. `src/store/slices/types.ts`
2. `src/store/useAppStore.ts`
3. `src/utils/providers.ts`
4. `src/App.tsx`
5. `src/layouts/AppLayout.tsx`
6. `src/components/ProjectTree/index.tsx`
7. `src/i18n/index.ts`
8. `src/i18n/locales/*/antigravity.json`

## 9. 测试方案

## 9.1 后端测试

### 单元测试

文件：

1. `src-tauri/src/models/antigravity.rs`
2. `src-tauri/src/commands/antigravity.rs`
3. `src-tauri/src/commands/stats.rs`

覆盖点：

1. `AntigravityState` 默认值与序列化
2. lifecycle 状态序列化
3. `PersistedSessionState` JSON 反序列化
4. `load_state_file`
5. `load_archive_states`
6. `merge_states`
7. `compute_project_summary`
8. `detect_project_provider` / `detect_session_provider`
9. `parse_active_stats_providers` 包含 `Antigravity`
10. synthetic antigravity prompt 不进入统计

建议执行：

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml stats:: -- --nocapture
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml antigravity -- --nocapture
```

### 集成测试

文件：

1. `src-tauri/tests/scan_all_test.rs`
2. `src-tauri/src/bin/test_api.rs`
3. `src-tauri/src/bin/test_detect.rs`

覆盖点：

1. `detect_providers()` 是否返回 `antigravity`
2. `providers::antigravity::scan_projects()` 是否能扫到虚拟项目
3. `scan_all_projects()` 是否包含 `antigravity`
4. `providers::antigravity::load_sessions()` 是否能产出 session
5. `providers::antigravity::load_messages()` 是否能产出展示消息

建议执行：

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml --test scan_all_test -- --nocapture
PATH="$HOME/.cargo/bin:$PATH" cargo run --manifest-path src-tauri/Cargo.toml --bin test_detect
PATH="$HOME/.cargo/bin:$PATH" cargo run --manifest-path src-tauri/Cargo.toml --bin test_api --no-default-features
```

### 编译验证

建议至少执行：

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo check --manifest-path src-tauri/Cargo.toml
```

如果本地 `target` 被其他进程占用，可使用独立目录：

```bash
PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR=/tmp/cchv-antigravity-check cargo check --manifest-path src-tauri/Cargo.toml
```

## 9.2 前端测试

### 单元测试

文件：

1. provider / stats / message 相关单测

覆盖点：

1. provider API 是否调用正确 Tauri endpoint
2. 既有项目树 / session / message / stats 链路在接入 `antigravity` 后不回归

建议执行：

```bash
./node_modules/.bin/vitest run src/test/providers.utils.test.ts
```

### 类型与构建验证

建议执行：

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
```

### 手工联调

建议按下面顺序验证：

1. 启动桌面应用
2. 首页 provider filter 出现 `Antigravity`
3. 选中 `Antigravity` 后项目树可看到虚拟项目
4. 点击项目可加载 session 列表
5. 点击 session 可进入消息视图
6. 点击 `Token Stats` 可拿到该项目统计
7. 点击 `Analytics` 可拿到项目汇总
8. `Global Stats` 中 provider distribution 包含 `antigravity`
9. 搜索框搜索 session ID 或 model 名，可返回 antigravity session 结果

### 回归检查矩阵

| 场景 | 数据源 | 入口 | 预期 |
| --- | --- | --- | --- |
| provider 检测 | `rpc-cache/v1` | 应用启动 | provider tabs 中出现 `Antigravity` |
| 项目扫描 | `rpc-cache/v1/*` | 项目树 | 出现单个 `Antigravity` 虚拟项目 |
| session 列表 | `usage.jsonl` + `manifest.json` | 点击项目 | session 数、summary、时间正确 |
| 消息视图 | `usage.jsonl` | 点击 session | 能看到 synthetic user + real assistant |
| 项目 token stats | `usage.jsonl` | `Token Stats` | token 汇总正确，message_count 为 usage 数 |
| 项目 analytics | `usage.jsonl` | `Analytics` | project summary、activity、tool/model 分布可用 |
| 全局统计 | 多 provider + `usage.jsonl` | `Global Stats` | provider distribution 包含 `antigravity` |
| 全文搜索 | `rpc-cache/v1/*` | 搜索框 | session ID / model 名匹配结果 |

## 10. 风险与后续项

### 10.1 当前风险

1. `antigravity` 消息是从 `usage.jsonl` 映射为 ClaudeMessage 兼容结构，不是原生 Claude 日志
2. message count 的定义是“真实 usage 记录数”，不是 UI 中的渲染消息条数
3. `recent edits` / `board` 等功能是否对 `antigravity` 有业务意义，还需要进一步确认
4. `antigravity` 的项目路径是缓存目录，不是真实工作目录；如果复用现有 project-scoped settings / rename / file-action 入口，语义可能与 `opencode` 不一致

## 11. 边界与不做项

### 11.1 当前明确支持

1. provider 检测与 provider filter
2. 项目扫描
3. session 列表
4. 消息加载与消息页展示
5. 项目级 token stats
6. 项目级 analytics summary
7. session comparison
8. global stats provider 聚合
9. 不新增专用 `Antigravity Usage` 页面
10. 全文搜索（session ID / model 名匹配）

### 11.2 当前不保证完全语义等价的能力

1. `recent edits`
   - 现有逻辑主要面向 Claude 会话里的文件编辑痕迹
   - `antigravity` 的 `usage.jsonl` 不天然提供等价的文件编辑结构
2. `session board`
   - 当前仍是 Claude-only 语义
   - 即使入口可见，也不应视为 `antigravity` 已支持 board 语义
3. 消息级 tool / file change 语义
   - `antigravity` 映射后的 ClaudeMessage 主要服务统计与基础消息展示
   - 不保证具备 Claude 原生日志那样完整的 tool/result 语义

### 11.3 不做项

本次接入不包含：

1. 为 `antigravity` 定义全新的前端消息渲染协议
2. 为 `antigravity` 补齐 Claude 原生日志的全部 message subtype
3. 让 `recent edits` 基于 `usage.jsonl` 反推出精确文件编辑历史
4. 让 `session board` 对 `antigravity` 具备与 Claude 完全相同的交互语义

## 12. 验收标准

### 12.1 最低验收标准

1. 应用能成功编译
2. provider 列表中可检测到 `antigravity`
3. 项目树中可看到 `Antigravity` 项目
4. 点击项目可加载 session
5. 点击 session 可加载消息
6. `Token Stats` 对 `antigravity` 项目返回非空统计
7. `Analytics` 对 `antigravity` 项目返回非空汇总
8. `Global Stats` 的 provider distribution 包含 `antigravity`
9. 基线界面布局与样式不因 `antigravity` 接入发生变化

### 12.2 数据口径验收标准

1. token 总量以真实 usage assistant 记录为准
2. synthetic user 消息不影响 token 汇总
3. session 数以 `rpc-cache/v1/*` 下有效 session 目录为准
4. 如果后续保留 `monitor-state*.json` 数据链路，也不得要求新增专用页面才能视为验收通过

### 12.3 回归验收标准

1. Claude / Codex / OpenCode 既有统计链路不因 `Antigravity` 枚举新增而编译失败
2. provider filter 切换不影响原有 provider 项目加载
3. 全局统计在包含和不包含 `antigravity` 时都能返回结果
4. 不得因为 `antigravity` 接入引入新的主视图切换路径

## 13. 后续可选优化

1. 为 `antigravity` 单独定义更准确的 message schema，而不是映射成 ClaudeMessage
2. 在不改布局的前提下，明确展示“usage count”与“rendered message count”的区别
3. 为 `antigravity` 增加更完整的 Rust fixture 测试数据目录
4. 为 `stats.rs` 增加针对 `usage.jsonl` 的固定快照测试

## 16. 现有设计问题

按“保持基线界面不变、参考 `opencode` 最小接入”的标准，当前设计存在以下问题：

1. 设计范围过大。
   当前文档把 `antigravity` 拆成 provider 链路和独立汇总页两套前端链路，这已经明显超出“像 `opencode` 一样接入 provider”的范围。
2. 与“不能修改基线界面”冲突。
   文档中的 `Antigravity Usage` 独立页面、Header 入口、移动端 Bottom Tab 入口都会改变既有界面结构，不符合基线约束。
3. 与“最小修改”原则冲突。
   当前前端变更面包含 `Header`、`AppLayout`、`BottomTabBar`、独立 store slice、独立页面组件和导航 hook，改动面远大于 `opencode` 的 provider 式接入。
4. 文档内目标不一致。
   一方面说目标不是单独只读页面，另一方面又把独立 `Antigravity Usage` 页面设计成主路径，并给出专门导航与测试方案，目标存在漂移。
5. provider 语义与项目语义混淆。
   `antigravity` 被设计为单虚拟项目，其 `actual_path` 指向缓存目录而不是真实工作目录；如果复用项目级设置、文件动作、重命名、recent edits 等现有项目语义，容易产生错误行为。
6. 对不支持能力的边界收敛不够。
   文档正文中把 `recent edits`、`board`、独立统计入口都写进正常流程，但风险和边界章节又承认它们未必有业务意义，前后不够收敛。
7. 搜索定义名不副实。
   文档写的是“全文搜索”，但实际设计仅支持 session ID / model 名等元数据匹配，不是常规意义上的全文搜索，应降级表述，避免误导验收。
8. 验收标准夹带了扩展能力。
   当前验收包含独立汇总页可用，这会把非必要 UI 扩展变成强制交付项，不符合新的需求约束。
9. 测试方案绑定了被裁剪的 UI 方案。
   文档中的前端测试和手工验收大量围绕 `AntigravityView` 与页面入口展开；在“基线 UI 不变”的约束下，这部分测试目标需要回退到既有 provider 链路。

## 14. 测试执行剧本

### 14.1 本地快速验证

适用场景：

1. 开发中频繁自检
2. 修改 provider / stats / 前端展示后的快速回归

建议顺序：

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run src/test/providers.utils.test.ts
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml antigravity -- --nocapture
PATH="$HOME/.cargo/bin:$PATH" cargo check --manifest-path src-tauri/Cargo.toml
```

如果本地 `target` 目录被其他进程占用：

```bash
PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR=/tmp/cchv-antigravity-check cargo check --manifest-path src-tauri/Cargo.toml
```

通过标准：

1. TS 无类型错误
2. 前端 provider 相关测试通过
3. Rust antigravity 相关测试通过
4. Rust 主工程可编译

### 14.2 CI 必跑项

适用场景：

1. PR 检查
2. 合并前阻断项

建议最小集：

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run src/test/providers.utils.test.ts
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml --test scan_all_test -- --nocapture
PATH="$HOME/.cargo/bin:$PATH" cargo check --manifest-path src-tauri/Cargo.toml
```

建议增强集：

```bash
./node_modules/.bin/vite build
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml stats:: -- --nocapture
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml antigravity -- --nocapture
```

CI 验证目标：

1. 编译链路不因 `StatsProvider::Antigravity` 新增而失败
2. provider 检测与多 provider 扫描集成测试可过
3. 前端既有 provider 链路不回归

### 14.3 手工验收剧本

适用场景：

1. 功能确认
2. 发布前 smoke test

前置条件：

1. 本机存在 `~/.gemini/antigravity`
2. `rpc-cache/v1` 下至少有一个有效 session

步骤：

1. 启动桌面应用
2. 确认左上 provider filter 出现 `Antigravity`
3. 只勾选 `Antigravity`
4. 确认项目树中出现 `Antigravity` 项目
5. 点击项目，确认 session 列表可见
6. 点击 session，确认消息页可见
7. 在消息页确认至少能看到一组 synthetic user / real assistant 配对消息
8. 点击 `Token Stats`，确认有 token 数值且非空
9. 点击 `Analytics`，确认项目汇总正常
10. 进入 `Global Stats`，确认 provider distribution 中有 `antigravity`

重点观察项：

1. 切换 `Antigravity` 项目时，不应被强制跳转到任何新增视图
2. `Token Stats` / `Analytics` 不应报“不支持”类错误
3. message count 不应因 synthetic user 被翻倍
4. 不应因接入 `antigravity` 出现 Header、Sidebar、Bottom Tab 布局变化

### 14.4 故障排查剧本

如果测试失败，按下面顺序排查：

1. `detect_providers` 无 `antigravity`
   - 检查 `~/.gemini/antigravity/.token-monitor/rpc-cache/v1` 是否存在
2. 项目树无 `Antigravity`
   - 检查 `scan_all_projects` 的 active providers 是否包含 `antigravity`
3. session 为空
   - 检查 session 目录下是否存在 `usage.jsonl`
4. 消息页为空
   - 检查 `usage.jsonl` 是否有 `recordType = "usage"` 记录
5. 统计页为空
   - 检查 `stats.rs` 是否走到了 `StatsProvider::Antigravity`
   - 检查真实 assistant usage 是否被正确解析

## 15. 桌面端手工验收清单

### 15.1 前置条件

执行前确认：

1. 本机存在 `~/.gemini/antigravity/.token-monitor/rpc-cache/v1`
2. `rpc-cache/v1` 下至少存在一个带 `usage.jsonl` 的 session 目录
3. 应用使用当前分支最新代码重新启动

建议先记录环境：

1. `~/.gemini/antigravity` 是否存在
2. `rpc-cache/v1` 下 session 目录数量

### 15.2 启动检查

1. 启动桌面应用
2. 确认应用能正常进入主界面
3. 确认无启动报错弹窗
4. 确认顶部 Header 正常渲染

通过标准：

1. 应用无白屏
2. 无初始化报错

### 15.3 Provider 检测检查

1. 查看左侧 provider filter 区域
2. 确认出现 `Antigravity`
3. 观察 `Antigravity` 旁边的项目数量是否大于 0
4. 点击 `Antigravity`
5. 确认 provider filter 切换后没有报错提示

通过标准：

1. `Antigravity` 可见
2. 可点击
3. 点击后项目树结果发生过滤

失败判定：

1. provider 列表中没有 `Antigravity`
2. 点击后项目区为空且控制台报 provider 错误

### 15.4 项目树检查

1. 在只选中 `Antigravity` 的情况下查看项目树
2. 确认出现单个 `Antigravity` 项目
3. 确认该项目的 session 数与预期大体一致
4. 点击该项目

通过标准：

1. 项目树中出现 `Antigravity`
2. 点击项目后右侧 session 列表开始加载

失败判定：

1. 能检测到 provider，但项目树没有 `Antigravity`
2. 点击项目后 session 不加载

### 15.5 Session 列表检查

1. 确认 session 列表出现多条记录
2. 确认每条记录包含 summary
3. 确认 summary 中包含 call 数、step 数或 token 摘要
4. 随机点击 2 到 3 个 session

通过标准：

1. session 列表非空
2. session 可切换
3. 切换时无崩溃、无空白页

失败判定：

1. session 列表为空
2. 点击 session 后无响应

### 15.6 消息页检查

对任一已打开 session：

1. 确认消息页成功渲染
2. 确认能看到一组由 synthetic `user` 和真实 `assistant` 组成的消息对
3. 确认真实 `assistant` 消息里能看到 token 摘要信息
4. 切换不同 session，确认消息内容同步变化

通过标准：

1. 消息页非空
2. 不报解析错误
3. 切换 session 时内容可更新

失败判定：

1. 消息页为空
2. 出现明显 JSON 解析错误或 provider 加载错误

### 15.7 Token Stats 检查

在选中 `Antigravity` 项目和某个 session 的情况下：

1. 点击 `Token Stats`
2. 确认页面能打开
3. 确认总 token、input、output、cache 等统计项非空
4. 记下当前 session 的 token 数，切换 session 后再次确认数据变化

通过标准：

1. `Token Stats` 可打开
2. 数值非空
3. 不出现“不支持”类错误

失败判定：

1. 点击后报错
2. 全部数值为 0 且与真实数据明显不符

### 15.8 Analytics 检查

1. 点击 `Analytics`
2. 确认项目级 summary 可见
3. 确认至少有总 token、session 数、message 数等汇总
4. 若有 activity / provider / model 维度图表，确认它们能正常渲染

通过标准：

1. Analytics 页面可打开
2. 项目汇总非空
3. 不出现 provider 分支未支持错误

失败判定：

1. 页面空白
2. 图表组件报错

### 15.9 Global Stats 检查

1. 进入 `Global Stats`
2. 保持 active providers 包含 `Antigravity`
3. 确认 provider distribution 中有 `antigravity`
4. 记录其 projects / sessions / tokens 是否非零

通过标准：

1. 全局统计能加载
2. `antigravity` 出现在 provider distribution 中

失败判定：

1. 全局统计可见但没有 `antigravity`
2. 一包含 `antigravity` 就整体报错

### 15.10 视图切换回归检查

1. 从 `Antigravity` 项目进入消息页
2. 切到 `Token Stats`
3. 切到 `Analytics`
4. 再切回 `Messages`

通过标准：

1. 各视图切换正常
2. 不会被错误强制跳转
3. 不会卡在 loading 状态

失败判定：

1. 选中 `Antigravity` 项目后被直接重定向到新增视图
2. 普通项目视图在切换后失效

### 15.11 验收记录模板

建议记录：

```text
日期：
执行人：
分支：

环境检查：
- rpc-cache/v1 是否存在：
- session 目录数量：

结果：
- 启动检查：通过 / 失败
- Provider 检测：通过 / 失败
- 项目树：通过 / 失败
- Session 列表：通过 / 失败
- 消息页：通过 / 失败
- Token Stats：通过 / 失败
- Analytics：通过 / 失败
- Global Stats：通过 / 失败
- 视图切换回归：通过 / 失败

备注：
```

## 17. 开发任务清单

本节按“保持基线 UI 不变、参考 `opencode` 最小接入”的原则拆分开发任务。除非明确说明，否则任务默认不允许新增页面、导航、布局或样式层。

### 17.1 阶段一：设计收敛

目标：

1. 把需求收敛为单一 provider 接入。
2. 清除与基线 UI 约束冲突的实现范围。

任务：

1. 确认本次交付范围仅包含 provider 检测、项目扫描、session 列表、消息加载、stats、搜索。
2. 从设计和实施范围中移除独立 `Antigravity Usage` 页面、Header 入口、Bottom Tab 入口、独立路由。
3. 明确 `monitor-state` 链路不作为本次前端交付前提。
4. 明确不支持项：
   - `recent edits`
   - `session board`
   - native rename
   - project-scoped settings / file actions

交付物：

1. 更新后的设计文档
2. 范围确认结论

### 17.2 阶段二：后端 provider 接入

目标：

1. 让 `antigravity` 像 `opencode` 一样被统一 provider 框架识别和加载。

任务：

1. 在 `src-tauri/src/providers/mod.rs` 注册 `antigravity`。
2. 在 `src-tauri/src/providers/antigravity.rs` 完成 `detect()`。
3. 完成 `scan_projects()`，输出单个虚拟项目。
4. 完成 `load_sessions()`，基于 `usage.jsonl` + `manifest.json` 生成 `ClaudeSession`。
5. 完成 `load_messages()`，为每条 usage 记录生成 synthetic `user` + real `assistant`。
6. 完成 `search()`，仅支持 session ID / model 名等元数据匹配。
7. 确认 `multi_provider.rs` 路由已完整接线：
   - `scan_all_projects`
   - `load_provider_sessions`
   - `load_provider_messages`
   - `search_all_providers`

交付物：

1. 可被统一 provider 流程调用的 `antigravity` provider
2. 本地可加载项目、session、消息

### 17.3 阶段三：统一统计链路接入

目标：

1. 让 `antigravity` 进入既有 `Token Stats` / `Analytics` / `Global Stats` 统计体系。

任务：

1. 在 `src-tauri/src/commands/stats.rs` 增加 `StatsProvider::Antigravity`。
2. 完成 `detect_project_provider()` 对 antigravity path 的识别。
3. 完成 `detect_session_provider()` 对 antigravity session path 的识别。
4. 将 `antigravity` 接入统一统计入口：
   - `load_provider_sessions_for_stats`
   - `load_provider_messages_for_stats`
   - `get_project_token_stats`
   - `get_project_stats_summary`
   - `get_global_stats_summary`
5. 增加 synthetic message 过滤规则，避免统计翻倍。
6. 验证 provider distribution 中出现 `antigravity`。

交付物：

1. `antigravity` 的项目级和全局统计可用
2. synthetic user 不进入统计

### 17.4 阶段四：前端最小接入

目标：

1. 不改基线界面结构，仅让 `antigravity` 进入现有前端链路。

任务：

1. 在 `src/utils/providers.ts` 增加 `antigravity` provider 常量、label、能力映射、badge 映射。
2. 检查 `providerSlice` / `projectSlice` 是否已能识别并扫描 `antigravity`。
3. 确认 `ProjectTree` provider filter 可显示 `antigravity`。
4. 确认选中 `antigravity` 后走既有项目树、session 列表、消息页。
5. 确认 `Token Stats`、`Analytics`、`Global Stats` 不需要新增视图即可工作。
6. 补齐 i18n 文案：
   - `common.provider.antigravity`
   - 其他必要 provider 展示文本

7. **不新增前端 provider 分支**：确认 `messageSlice` 中的统计加载函数（`loadSessionTokenStats` / `loadProjectTokenStats` / `loadProjectStatsSummary` / `loadSessionComparison`）不为 `antigravity` 添加特判，直接复用现有通用路径（见 §5.3）。
8. **不引入专用工具层**：删除或不新建 `antigravityAnalytics.ts`、`antigravityApi.ts` 等仅服务于独立页面的前端文件。
交付物：

1. 基线 UI 不变
2. `antigravity` 在既有界面中可见、可切换、可查看

### 17.5 阶段五：不支持能力降级

目标：

1. 对无法与 `opencode` 等价复用的能力进行显式收敛。

任务：

1. 梳理 `antigravity` 是否会暴露以下入口：
   - native rename
   - recent edits
   - session board
   - project settings / file actions
2. 对不成立的能力隐藏入口，或返回统一“不支持”。
3. 确认不会因 `actual_path` 指向缓存目录而误触真实项目语义。
4. 补充相应的注释、文档或测试说明。

交付物：

1. 降级后的稳定行为
2. 不产生误导性 UI 或错误副作用

### 17.6 阶段六：测试与回归

目标：

1. 确认 `antigravity` 接入后既有 provider 与基线 UI 不回归。

任务：

1. Rust 单测覆盖：
   - provider 检测
   - scan_projects
   - load_sessions
   - load_messages
   - stats provider 识别
2. Rust 集成测试覆盖：
   - `scan_all_projects`
   - provider 搜索
   - stats 聚合
3. 前端测试覆盖：
   - provider 常量/工具函数
   - 既有项目树 / session / stats 链路
4. 手工回归：
   - provider filter
   - 项目树
   - session 列表
   - 消息页
   - `Token Stats`
   - `Analytics`
   - `Global Stats`
5. 明确验证“基线 UI 没变化”。

交付物：

1. 自动化测试结果
2. 手工验收记录

### 17.7 文件级任务拆分

| 模块 | 文件 | 任务 |
| --- | --- | --- |
| Provider 注册 | `src-tauri/src/providers/mod.rs` | 注册 `antigravity`，接入 detect 列表 |
| Provider 实现 | `src-tauri/src/providers/antigravity.rs` | 实现 detect / scan / sessions / messages / search |
| 多 provider 路由 | `src-tauri/src/commands/multi_provider.rs` | 确认扫描、加载、搜索都已接线 |
| 统计聚合 | `src-tauri/src/commands/stats.rs` | 增加 `StatsProvider::Antigravity` 和 synthetic 过滤 |
| 前端 provider 常量 | `src/utils/providers.ts` | 增加 provider id、label、能力、badge |
| Store 接线 | `src/store/slices/providerSlice.ts` `src/store/slices/projectSlice.ts` | 确认 detect / scan / select 流程无分支缺口 |
| 项目树展示 | `src/components/ProjectTree/index.tsx` | 确认 provider filter 与列表展示正常 |
| 主视图协调 | `src/App.tsx` `src/layouts/AppLayout.tsx` | 确认不引入新视图切换 |
| 文案 | `src/i18n/locales/*/*.json` | 增加 provider 文案 |
| 测试 | `src/test/*` `src-tauri/tests/*` | 补 provider、stats、回归测试 |

## 18. 进度记录表

### 18.1 总表

| 编号 | 阶段 | 负责人 | 状态 | 开始日期 | 完成日期 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 设计收敛 |  | 未开始 |  |  |  |
| T2 | 后端 provider 接入 |  | 未开始 |  |  |  |
| T3 | 统一统计链路接入 |  | 未开始 |  |  |  |
| T4 | 前端最小接入 |  | 未开始 |  |  |  |
| T5 | 不支持能力降级 |  | 未开始 |  |  |  |
| T6 | 测试与回归 |  | 未开始 |  |  |  |

状态建议：

1. 未开始
2. 进行中
3. 已完成
4. 已阻塞
5. 已取消

### 18.2 子任务记录表

| 编号 | 子任务 | 对应文件 | 负责人 | 状态 | 检查结果 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| T2-1 | 注册 `antigravity` provider | `src-tauri/src/providers/mod.rs` |  | 未开始 |  |  |
| T2-2 | 实现 `detect()` | `src-tauri/src/providers/antigravity.rs` |  | 未开始 |  |  |
| T2-3 | 实现 `scan_projects()` | `src-tauri/src/providers/antigravity.rs` |  | 未开始 |  |  |
| T2-4 | 实现 `load_sessions()` | `src-tauri/src/providers/antigravity.rs` |  | 未开始 |  |  |
| T2-5 | 实现 `load_messages()` | `src-tauri/src/providers/antigravity.rs` |  | 未开始 |  |  |
| T2-6 | 实现 `search()` | `src-tauri/src/providers/antigravity.rs` |  | 未开始 |  |  |
| T3-1 | 增加 `StatsProvider::Antigravity` | `src-tauri/src/commands/stats.rs` |  | 未开始 |  |  |
| T3-2 | 增加 synthetic 过滤 | `src-tauri/src/commands/stats.rs` |  | 未开始 |  |  |
| T4-1 | 增加 provider 常量与 label | `src/utils/providers.ts` |  | 未开始 |  |  |
| T4-2 | 校验项目树 filter 展示 | `src/components/ProjectTree/index.tsx` |  | 未开始 |  |  |
| T4-3 | 校验主视图不新增切换 | `src/App.tsx` `src/layouts/AppLayout.tsx` |  | 未开始 |  |  |
| T4-4 | 补 i18n 文案 | `src/i18n/locales/*/*.json` |  | 未开始 |  |  |
| T5-1 | 梳理并隐藏不支持入口 | 前端相关入口文件 |  | 未开始 |  |  |
| T6-1 | Rust 单测补齐 | `src-tauri/src/*` |  | 未开始 |  |  |
| T6-2 | Rust 集成测试补齐 | `src-tauri/tests/*` |  | 未开始 |  |  |
| T6-3 | 前端回归测试补齐 | `src/test/*` |  | 未开始 |  |  |
| T6-4 | 手工验收执行 | 本文第 15 节 |  | 未开始 |  |  |

### 18.3 周报/日更记录模板

```text
日期：
更新人：

本次完成：
1.
2.
3.

当前进行中：
1.
2.

阻塞项：
1.

下一步：
1.
2.
```
