# LLM-Friendly Codebase Refactoring Plan

## Overview

**목표**: LLM이 이해하고 유지보수하기 쉬운 구조로 전면 리팩토링
**범위**: Frontend (React/TypeScript) + Backend (Rust/Tauri)
**제약**: 기능 변경 없이 구조만 개선, 테스트 코드 스킵

---

## 현재 구조 분석

### 문제가 있는 파일들

| 파일 | Lines | 문제점 |
|------|-------|--------|
| `MessageViewer.tsx` | 1,311 | 7개 이상의 컴포넌트/함수가 한 파일에 |
| `AnalyticsDashboard.tsx` | 1,252 | 8개의 차트/뷰 컴포넌트 혼재 |
| `useAppStore.ts` | 916 | 4개 이상의 도메인이 하나의 스토어에 |
| `types/index.ts` | 771 | 80개 이상의 타입이 한 파일에 |
| `session.rs` | 1,572 | 10개 이상의 함수가 한 모듈에 |
| `models.rs` | 1,054 | 모든 데이터 모델이 한 파일에 |

### LLM 친화적 구조 원칙

1. **Single Responsibility**: 파일당 하나의 명확한 책임
2. **200-300 Lines Max**: 파일당 최대 300줄 목표
3. **Domain-Based**: 기술 기반이 아닌 도메인 기반 구조
4. **Self-Documenting**: 파일명만으로 내용 유추 가능
5. **Flat Dependencies**: 순환 의존성 제거, 명확한 의존 방향

---

## Phase 1: Frontend Types 분리 (types/index.ts → types/*)

### 현재 구조
```
src/types/
└── index.ts (771 lines, 80+ types)
```

### 목표 구조
```
src/types/
├── index.ts              # re-exports only
├── message.types.ts      # ClaudeMessage, MessageNode, MessagePayload
├── content.types.ts      # ContentItem, TextContent, ImageContent, etc.
├── session.types.ts      # ClaudeSession, ClaudeProject
├── stats.types.ts        # TokenStats, GlobalStatsSummary, etc.
├── tool.types.ts         # ToolUseContent, ToolResultContent, etc.
├── update.types.ts       # UpdateInfo, UpdateMessage, etc.
├── mcp.types.ts          # MCPToolUseContent, MCPToolResultContent
└── error.types.ts        # AppError, AppErrorType
```

### 작업 상세
1. **message.types.ts** (~100 lines)
   - `RawClaudeMessage`, `ClaudeMessage`, `MessageNode`, `MessagePage`
   - `MessagePayload`, `PaginationState`

2. **content.types.ts** (~150 lines)
   - `ContentItem`, `TextContent`, `ImageContent`
   - `ThinkingContent`, `RedactedThinkingContent`
   - `DocumentContent`, `Citation`, `CitationsConfig`

3. **session.types.ts** (~50 lines)
   - `ClaudeSession`, `ClaudeProject`, `AppState`

4. **stats.types.ts** (~100 lines)
   - `SessionTokenStats`, `GlobalStatsSummary`, `ProjectStatsSummary`
   - `DailyStats`, `ModelStats`, `ToolUsageStats`
   - `ActivityHeatmap`, `DateRange`, `ProjectRanking`

5. **tool.types.ts** (~150 lines)
   - `ToolUseContent`, `ToolResultContent`, `ClaudeToolUseResult`
   - `ServerToolUseContent`, `SearchResultContent`
   - `WebSearchToolResultContent`, `WebFetchToolResultContent`

6. **update.types.ts** (~50 lines)
   - `UpdateInfo`, `UpdateMessage`, `UpdateMetadata`
   - `UpdateType`, `UpdatePriority`

7. **mcp.types.ts** (~80 lines)
   - `MCPToolUseContent`, `MCPToolResultContent`
   - `MCPTextResult`, `MCPImageResult`, `MCPResourceResult`
   - `ClaudeMCPResult`

8. **error.types.ts** (~30 lines)
   - `AppError`, `AppErrorType`

---

## Phase 2: Store 분리 (useAppStore.ts → store/*)

### 현재 구조
```
src/store/
├── useAppStore.ts (916 lines)
└── useLanguageStore.ts
```

### 목표 구조
```
src/store/
├── index.ts                    # combined store exports
├── slices/
│   ├── projectSlice.ts         # project/folder selection
│   ├── sessionSlice.ts         # session/messages state
│   ├── searchSlice.ts          # search functionality
│   └── paginationSlice.ts      # pagination state
├── useAppStore.ts              # combined store (minimal)
└── useLanguageStore.ts
```

### 작업 상세
1. **projectSlice.ts** (~150 lines)
   - `claudeFolderPath`, `projects`, `selectedProject`
   - `setClaudeFolderPath`, `setProjects`, `setSelectedProject`
   - `scanProjects`, `loadProjectSessions`

2. **sessionSlice.ts** (~200 lines)
   - `sessions`, `selectedSession`, `messages`, `rootMessages`
   - `setSelectedSession`, `loadMessages`, `loadMoreMessages`
   - `isLoadingMessages`, `error`

3. **searchSlice.ts** (~150 lines)
   - `SearchState`, `SearchMatch`, `SearchFilterType`
   - `sessionSearch`, `searchMessages`, `navigateMatches`
   - `performSearch`, `clearSearch`

4. **paginationSlice.ts** (~100 lines)
   - `pagination`, `hasMore`, `currentPage`
   - `loadNextPage`, `resetPagination`

---

## Phase 3: MessageViewer 분리

### 현재 구조
```
src/components/
└── MessageViewer.tsx (1,311 lines)
    - MessageViewer (main)
    - MessageHeader
    - SummaryMessage
    - ClaudeMessageNode
    - groupAgentProgressMessages()
    - groupAgentTasks()
    - extractAgentTask()
    - isAgentTaskMessage()
    - etc.
```

### 목표 구조
```
src/components/MessageViewer/
├── index.ts                        # exports
├── MessageViewer.tsx               # main component (~200 lines)
├── MessageHeader.tsx               # header component (~80 lines)
├── SummaryMessage.tsx              # summary renderer (~60 lines)
├── ClaudeMessageNode.tsx           # message node (~150 lines)
├── SearchBar.tsx                   # search UI (~100 lines)
├── hooks/
│   ├── useMessageTree.ts           # tree building logic
│   ├── useMessageSearch.ts         # search within session
│   └── useScrollNavigation.ts      # scroll to match
└── utils/
    ├── agentGrouping.ts            # groupAgentProgressMessages, etc.
    ├── messageFilters.ts           # isAgentTaskMessage, isEmptyMessage
    └── messageExtractors.ts        # extractAgentTask, getParentUuid
```

### 작업 상세
1. **MessageViewer.tsx** (~200 lines)
   - 컨테이너 역할만 담당
   - 하위 컴포넌트 조합
   - 스크롤 컨테이너 관리

2. **MessageHeader.tsx** (~80 lines)
   - 세션 정보 표시
   - 타임스탬프, 메시지 수

3. **ClaudeMessageNode.tsx** (~150 lines)
   - 단일 메시지 렌더링
   - 메시지 타입별 분기

4. **hooks/useMessageTree.ts** (~100 lines)
   - `renderMessageTree` 로직
   - 트리 구조 플래트닝

5. **utils/agentGrouping.ts** (~100 lines)
   - `groupAgentProgressMessages`
   - `groupAgentTasks`
   - `AgentProgressEntry` 타입

---

## Phase 4: AnalyticsDashboard 분리

### 현재 구조
```
src/components/
└── AnalyticsDashboard.tsx (1,252 lines)
    - ActivityHeatmapComponent
    - DailyTrendChart
    - TokenDistributionChart
    - ToolUsageChart
    - GlobalStatsView
    - ProjectStatsView
    - SessionStatsView
    - SectionCard
```

### 목표 구조
```
src/components/AnalyticsDashboard/
├── index.ts
├── AnalyticsDashboard.tsx          # main (~100 lines)
├── views/
│   ├── GlobalStatsView.tsx         # (~150 lines)
│   ├── ProjectStatsView.tsx        # (~120 lines)
│   └── SessionStatsView.tsx        # (~150 lines)
├── charts/
│   ├── ActivityHeatmap.tsx         # (~100 lines)
│   ├── DailyTrendChart.tsx         # (~80 lines)
│   ├── TokenDistributionChart.tsx  # (~80 lines)
│   └── ToolUsageChart.tsx          # (~80 lines)
└── shared/
    ├── SectionCard.tsx             # (~50 lines)
    └── StatItem.tsx                # (~40 lines)
```

---

## Phase 5: Rust Backend 분리

### 현재 구조
```
src-tauri/src/
├── commands/
│   ├── mod.rs
│   ├── session.rs (1,572 lines)
│   ├── stats.rs (748 lines)
│   └── ...
└── models.rs (1,054 lines)
```

### 목표 구조
```
src-tauri/src/
├── commands/
│   ├── mod.rs
│   ├── session/
│   │   ├── mod.rs
│   │   ├── load.rs              # load_session_messages
│   │   ├── search.rs            # search_messages
│   │   └── edits.rs             # get_recent_edits
│   ├── stats/
│   │   ├── mod.rs
│   │   ├── session_stats.rs
│   │   └── global_stats.rs
│   ├── project.rs
│   ├── update.rs
│   └── feedback.rs
├── models/
│   ├── mod.rs
│   ├── message.rs               # ClaudeMessage, MessagePage
│   ├── session.rs               # ClaudeSession, ClaudeProject
│   ├── stats.rs                 # TokenStats, etc.
│   └── edit.rs                  # RecentFileEdit
└── utils.rs
```

### 작업 상세

#### commands/session/ 분리
1. **load.rs** (~400 lines)
   - `load_session_messages`
   - `load_messages_paginated`
   - 메시지 파싱 로직

2. **search.rs** (~300 lines)
   - `search_messages`
   - `search_with_filters`
   - 검색 관련 유틸

3. **edits.rs** (~300 lines)
   - `get_recent_edits`
   - `extract_file_edits`
   - 편집 추출 로직

#### models/ 분리
1. **message.rs** (~300 lines)
   - `ClaudeMessage`, `RawClaudeMessage`
   - `MessagePage`, `MessagePayload`

2. **session.rs** (~150 lines)
   - `ClaudeSession`, `ClaudeProject`

3. **stats.rs** (~300 lines)
   - `SessionTokenStats`, `GlobalStatsSummary`
   - `ProjectStatsSummary`, `DailyStats`

4. **edit.rs** (~200 lines)
   - `RecentFileEdit`, `RecentEditsResult`

---

## Phase 6: 추가 컴포넌트 정리

### RecentEditsViewer.tsx (582 lines) 분리
```
src/components/RecentEditsViewer/
├── index.ts
├── RecentEditsViewer.tsx       # main (~150 lines)
├── EditItem.tsx                # (~100 lines)
├── EditFilters.tsx             # (~80 lines)
└── hooks/
    └── useRecentEdits.ts       # (~100 lines)
```

### ProjectTree.tsx (374 lines) 분리
```
src/components/ProjectTree/
├── index.ts
├── ProjectTree.tsx             # main (~100 lines)
├── ProjectItem.tsx             # (~80 lines)
├── SessionItem.tsx             # (~80 lines)
└── hooks/
    └── useProjectTree.ts       # (~60 lines)
```

---

## 실행 순서

### Step 1: Types 분리 (영향도 낮음, 먼저 시작)
1. 새 타입 파일들 생성
2. index.ts에서 re-export
3. 기존 import 수정

### Step 2: Store 분리
1. slice 파일들 생성
2. useAppStore를 slice 조합으로 변경
3. 기존 import 확인

### Step 3: MessageViewer 분리
1. 디렉토리 구조 생성
2. 컴포넌트/유틸 분리
3. index.ts로 export 유지

### Step 4: AnalyticsDashboard 분리
1. 디렉토리 구조 생성
2. 뷰/차트 컴포넌트 분리

### Step 5: Rust Backend 분리
1. models/ 디렉토리 생성
2. commands/session/ 디렉토리 생성
3. mod.rs 업데이트

### Step 6: 나머지 컴포넌트 정리
1. RecentEditsViewer 분리
2. ProjectTree 분리

---

## 예상 결과

### Before
```
총 파일 수: ~100개
평균 파일 크기: ~220 lines
최대 파일 크기: 1,572 lines
```

### After
```
총 파일 수: ~150개
평균 파일 크기: ~100 lines
최대 파일 크기: ~300 lines
```

### 이점
1. **LLM 컨텍스트 효율**: 작은 파일 = 적은 토큰 = 정확한 이해
2. **수정 범위 명확**: 변경 시 영향받는 파일 예측 용이
3. **병렬 작업**: 여러 파일 동시 수정 가능
4. **검색 효율**: 파일명으로 빠른 탐색

---

## 주의사항

1. **기능 변경 없음**: 리팩토링만, 새 기능 추가 X
2. **Import 정리**: 순환 의존성 체크
3. **Export 유지**: 기존 API 호환성 유지
4. **단계별 검증**: 각 Phase 완료 후 `pnpm build` 확인

---

## 체크리스트

- [x] Phase 1: Types 분리 완료
- [x] Phase 2: Store 분리 완료
- [x] Phase 3: MessageViewer 분리 완료
- [x] Phase 4: AnalyticsDashboard 분리 완료
- [x] Phase 5: Rust Backend 분리 완료
- [x] Phase 6: 추가 컴포넌트 정리 완료 (RecentEditsViewer 분리, ProjectTree 유지)
- [x] 최종 빌드 검증 (`pnpm build && just tauri-build`) - 앱 빌드 성공, DMG 패키징은 별도 이슈
