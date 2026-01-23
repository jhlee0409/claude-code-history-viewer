# Rust Backend Performance Optimization Plan

**Created**: 2026-01-23
**Status**: ✅ Completed
**Estimated Phases**: 6

---

## Executive Summary

Claude Code History Viewer의 Rust 백엔드 성능을 최적화하는 종합 계획입니다.
5가지 주요 최적화를 단계별 PR로 구현하며, criterion 벤치마크로 개선 효과를 측정합니다.

### Actual Results (2026-01-23)

| Function | Improvement | Notes |
|----------|-------------|-------|
| `load_session_messages_paginated` | **30-43%** | True pagination with lazy parsing |
| `get_session_message_count` | **6-49%** | Parallel fast classification |
| `search_messages` (simple) | **9.4%** | Recursive value search |
| `search_messages` (partial) | **13.2%** | Eliminates JSON serialization |
| `get_project_stats_summary` | **46-69%** | Parallel file processing |
| `get_global_stats_summary` | **42-53%** | Parallel project processing |
| `load_session_messages` (1000 msgs) | **8.1%** | Memory pre-allocation |

### Original Expected Improvements

| Area | Current | Target | Improvement |
|------|---------|--------|-------------|
| Pagination (1000 msgs, page 100) | ~200ms | ~20ms | **10x** |
| Global Stats | 2-10s | 500ms-2s | **5x** |
| Search | 1-5s | 200ms-1s | **5x** |
| Memory Usage | 100% | 60-70% | **30-40% reduction** |

---

## Phase 0: Benchmark Infrastructure Setup

**Priority**: Foundation
**Estimated Files**: 3-4 new files

### Tasks

1. **Add criterion dependency**
   ```toml
   # Cargo.toml
   [dev-dependencies]
   criterion = { version = "0.5", features = ["html_reports"] }

   [[bench]]
   name = "performance"
   harness = false
   ```

2. **Create benchmark fixtures**
   - Generate sample JSONL files (100, 1000, 10000 messages)
   - Location: `src-tauri/benches/fixtures/`

3. **Implement baseline benchmarks**
   - `bench_load_session_messages`
   - `bench_load_session_messages_paginated`
   - `bench_search_messages`
   - `bench_get_global_stats_summary`
   - `bench_get_project_stats_summary`

4. **Run baseline measurements**
   ```bash
   cargo bench --bench performance -- --save-baseline before
   ```

### Deliverables
- [ ] `src-tauri/benches/performance.rs`
- [ ] `src-tauri/benches/fixtures/` (sample data)
- [ ] Baseline benchmark results documented

---

## Phase 1: True Pagination Implementation

**Priority**: HIGH (10-100x improvement potential)
**Target File**: `src-tauri/src/commands/session/load.rs`

### Problem

현재 `load_session_messages_paginated`가 전체 파일을 읽고 슬라이스함:
```rust
// Current: O(n) regardless of page size
let content = fs::read_to_string(&path)?;
let lines: Vec<(usize, &str)> = content.lines().enumerate().collect();
// ... parse all, then slice
```

### Solution

Lazy iteration으로 필요한 라인만 읽기:
```rust
pub fn load_session_messages_paginated(
    path: &str,
    offset: usize,
    limit: usize,
    exclude_sidechain: bool,
) -> Result<PaginatedMessages, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let messages: Vec<ClaudeMessage> = reader
        .lines()
        .enumerate()
        .filter_map(|(idx, line)| {
            line.ok().and_then(|l| {
                serde_json::from_str::<RawLogEntry>(&l)
                    .ok()
                    .map(|entry| (idx, entry))
            })
        })
        .filter(|(_, entry)| {
            !exclude_sidechain || !entry.is_sidechain.unwrap_or(false)
        })
        .skip(offset)
        .take(limit)
        .map(|(idx, entry)| convert_to_claude_message(entry, idx))
        .collect();

    // Total count는 별도로 캐시하거나 lazy하게 계산
    Ok(PaginatedMessages {
        messages,
        total_count: get_cached_count(path)?, // 캐싱 활용
        has_more: messages.len() == limit,
    })
}
```

### Additional Optimizations

1. **Message count 캐싱**
   - 파일 수정 시간 기반 캐시 무효화
   - `DashMap<PathBuf, (SystemTime, usize)>` 사용

2. **Seek-based pagination (advanced)**
   - 라인 오프셋 인덱스 생성 (첫 로드 시)
   - 이후 요청은 `seek()` + 부분 읽기

### Tasks

1. [ ] `load_session_messages_paginated` 리팩토링
2. [ ] Message count 캐싱 구현
3. [ ] `get_session_message_count` 최적화 (캐시 활용)
4. [ ] 벤치마크 실행 및 비교

### Deliverables
- [ ] Modified `load.rs`
- [ ] New caching module (if needed)
- [ ] Benchmark comparison report

---

## Phase 2: Search Optimization

**Priority**: HIGH (2-5x improvement potential)
**Target File**: `src-tauri/src/commands/session/search.rs`

### Problem

배열 콘텐츠를 JSON 문자열로 직렬화 후 검색:
```rust
// Current: Allocates twice (serialize + lowercase)
serde_json::Value::Array(arr) => {
    serde_json::to_string(arr).unwrap_or_default().to_lowercase()
}
```

### Solution

재귀적 값 검색으로 직렬화 제거:
```rust
fn search_in_value(value: &serde_json::Value, query: &str) -> bool {
    match value {
        Value::String(s) => s.to_lowercase().contains(query),
        Value::Array(arr) => arr.iter().any(|v| search_in_value(v, query)),
        Value::Object(map) => map.values().any(|v| search_in_value(v, query)),
        Value::Number(n) => n.to_string().contains(query),
        _ => false,
    }
}

fn extract_searchable_content(message: &RawLogEntry) -> bool {
    let query_lower = query.to_lowercase();

    // Check message content
    if let Some(msg) = &message.message {
        if search_in_value(&msg.content, &query_lower) {
            return true;
        }
    }

    // Check tool use
    if let Some(tool) = &message.tool_use {
        if search_in_value(tool, &query_lower) {
            return true;
        }
    }

    // Check tool result
    if let Some(result) = &message.tool_use_result {
        if search_in_value(result, &query_lower) {
            return true;
        }
    }

    false
}
```

### Additional Optimizations

1. **Early termination**
   - 매치 발견 시 즉시 반환

2. **Query preprocessing**
   - 쿼리를 한 번만 lowercase 변환
   - 검색 전에 정규화

3. **Parallel search within file**
   - 대용량 파일은 청크 단위 병렬 검색

### Tasks

1. [ ] `search_in_value` 재귀 함수 구현
2. [ ] `search_in_file` 리팩토링
3. [ ] Early termination 로직 추가
4. [ ] 벤치마크 실행 및 비교

### Deliverables
- [ ] Modified `search.rs`
- [ ] Benchmark comparison report

---

## Phase 3: Global Stats Parallelization

**Priority**: HIGH (5-10x improvement potential)
**Target File**: `src-tauri/src/commands/stats.rs`

### Problem

3중 중첩 루프로 순차 처리:
```rust
// Current: O(P × S × M × 6) sequential
for project in projects {
    for session in sessions {
        for message in messages {
            // 6 HashMap updates
        }
    }
}
```

### Solution

Rayon 병렬화 + Map-Reduce 패턴:
```rust
use rayon::prelude::*;

#[derive(Default)]
struct StatsAccumulator {
    daily_stats: HashMap<String, DailyStats>,
    activity_map: HashMap<(u8, u8), (u32, u64)>,
    model_usage: HashMap<String, ModelUsage>,
    total_tokens: TokenStats,
    session_count: u32,
    message_count: u32,
}

impl StatsAccumulator {
    fn merge(mut self, other: Self) -> Self {
        // Merge all HashMaps
        for (key, value) in other.daily_stats {
            self.daily_stats
                .entry(key)
                .and_modify(|e| e.merge(&value))
                .or_insert(value);
        }
        // ... merge other fields
        self
    }
}

pub async fn get_global_stats_summary(path: &str) -> Result<GlobalStats, String> {
    let projects_path = Path::new(path).join("projects");

    let project_dirs: Vec<_> = fs::read_dir(&projects_path)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();

    let stats = project_dirs
        .par_iter()
        .map(|project| {
            let sessions = collect_sessions(&project.path());
            sessions
                .par_iter()
                .map(|session| compute_session_stats(session))
                .reduce(StatsAccumulator::default, StatsAccumulator::merge)
        })
        .reduce(StatsAccumulator::default, StatsAccumulator::merge);

    Ok(stats.into_global_stats())
}
```

### Additional Optimizations

1. **Pre-allocated collections**
   ```rust
   let mut daily_stats = HashMap::with_capacity(365); // 1년치
   let mut activity_map = HashMap::with_capacity(24 * 7); // 168 슬롯
   ```

2. **날짜 파싱 최적화**
   - `chrono::DateTime` 대신 간단한 문자열 슬라이싱
   ```rust
   // Instead of: timestamp.format("%Y-%m-%d").to_string()
   let date_str = &timestamp_str[..10]; // "2024-01-23"
   ```

3. **타임스탬프 정렬 제거**
   - 단일 패스로 min/max 계산
   ```rust
   let (min_ts, max_ts) = timestamps.iter()
       .fold((i64::MAX, i64::MIN), |(min, max), &ts| {
           (min.min(ts), max.max(ts))
       });
   ```

### Tasks

1. [ ] `StatsAccumulator` 구조체 정의
2. [ ] `merge` 메서드 구현
3. [ ] `get_global_stats_summary` 병렬화
4. [ ] `get_project_stats_summary` 병렬화
5. [ ] Pre-allocation 적용
6. [ ] 벤치마크 실행 및 비교

### Deliverables
- [ ] Modified `stats.rs`
- [ ] New `stats/accumulator.rs` (optional)
- [ ] Benchmark comparison report

---

## Phase 4: Session Loading Optimization

**Priority**: MEDIUM (2x improvement potential)
**Target File**: `src-tauri/src/commands/session/load.rs`

### Problem

Summary propagation이 2회 순회 필요:
```rust
// Current: 2 iterations
for session in &sessions {
    if session.summary.is_some() {
        summary_map.insert(leaf_uuid, summary);
    }
}
for session in &mut sessions {
    if session.summary.is_none() {
        session.summary = summary_map.get(&session.uuid);
    }
}
```

### Solution

단일 패스 처리:
```rust
pub fn load_project_sessions(path: &str, exclude: bool) -> Result<Vec<SessionInfo>, String> {
    let file_paths = collect_jsonl_files(path)?;

    // Parallel load with summary tracking
    let (sessions, summary_map): (Vec<_>, HashMap<_, _>) = file_paths
        .par_iter()
        .filter_map(|path| load_session_from_file(path, exclude))
        .fold(
            || (Vec::new(), HashMap::new()),
            |(mut sessions, mut summaries), session| {
                if let Some(ref summary) = session.summary {
                    if let Some(leaf) = &session.leaf_uuid {
                        summaries.insert(leaf.clone(), summary.clone());
                    }
                }
                sessions.push(session);
                (sessions, summaries)
            },
        )
        .reduce(
            || (Vec::new(), HashMap::new()),
            |(mut s1, mut m1), (s2, m2)| {
                s1.extend(s2);
                m1.extend(m2);
                (s1, m1)
            },
        );

    // Apply summaries in single pass
    let sessions: Vec<_> = sessions
        .into_iter()
        .map(|mut s| {
            if s.summary.is_none() {
                s.summary = summary_map.get(&s.uuid).cloned();
            }
            s
        })
        .collect();

    Ok(sessions)
}
```

### Additional Optimizations

1. **Clone 감소**
   - `Cow<'_, str>` 사용으로 불필요한 문자열 복제 방지

2. **조건부 필드 추출**
   - 필요한 필드만 추출 (summary 전파용)

### Tasks

1. [ ] `load_project_sessions` 리팩토링
2. [ ] Fold-reduce 패턴 적용
3. [ ] Clone 최소화
4. [ ] 벤치마크 실행 및 비교

### Deliverables
- [ ] Modified `load.rs`
- [ ] Benchmark comparison report

---

## Phase 5: Memory Optimization

**Priority**: LOW-MEDIUM (30-40% memory reduction)
**Target Files**: `src-tauri/src/types.rs`, related modules

### Problem

`ClaudeMessage`가 29개 필드를 가지며 대부분 `Option<T>`:
```rust
pub struct ClaudeMessage {
    pub uuid: String,
    pub parent_uuid: Option<String>,
    pub session_id: String,
    pub timestamp: String,
    pub r#type: String,
    // ... 24 more fields, mostly Option<T>
}
```

### Solution Options

#### Option A: Enum-based Message Types (Recommended)

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClaudeMessage {
    User(UserMessage),
    Assistant(AssistantMessage),
    System(SystemMessage),
    Summary(SummaryMessage),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserMessage {
    pub uuid: String,
    pub session_id: String,
    pub timestamp: String,
    pub content: MessageContent,
    pub parent_uuid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssistantMessage {
    pub uuid: String,
    pub session_id: String,
    pub timestamp: String,
    pub content: Vec<ContentItem>,
    pub model: Option<String>,
    pub usage: Option<Usage>,
    pub stop_reason: Option<String>,
    // ... assistant-specific fields
}
```

#### Option B: Box Optional Fields

```rust
pub struct ClaudeMessage {
    // Common fields (always present)
    pub uuid: String,
    pub session_id: String,
    pub timestamp: String,
    pub r#type: String,

    // Boxed optional fields (reduce stack size)
    pub assistant_data: Option<Box<AssistantData>>,
    pub tool_data: Option<Box<ToolData>>,
}
```

### Breaking Change Consideration

API 시그니처를 유지하려면:
- Frontend TypeScript 타입도 함께 업데이트 필요
- 또는 변환 레이어 추가

### Tasks

1. [ ] 메시지 타입별 사용 필드 분석
2. [ ] Enum 기반 구조 설계
3. [ ] Serde 태그 기반 역직렬화 구현
4. [ ] Frontend 타입 동기화
5. [ ] 메모리 사용량 측정

### Deliverables
- [ ] Modified `types.rs`
- [ ] Modified `src/types/index.ts`
- [ ] Memory usage comparison report

---

## Phase 6: Final Optimization & Documentation

**Priority**: Wrap-up

### Tasks

1. **Final Benchmark**
   ```bash
   cargo bench --bench performance -- --save-baseline after
   cargo bench --bench performance -- --baseline before --load-baseline after
   ```

2. **Error Handling Improvement**
   - Silent failures에 로깅 추가
   - Metrics 수집 (옵션)

3. **Documentation**
   - Performance optimization guide
   - Benchmark results summary

4. **Code Cleanup**
   - Dead code 제거
   - Clippy warnings 해결

### Deliverables
- [ ] Final benchmark report
- [ ] Updated CLAUDE.md with performance notes
- [ ] PR descriptions for each phase

---

## Implementation Order

```
Phase 0 (Foundation)
    │
    ├──> Phase 1 (Pagination) ──┐
    │                           │
    ├──> Phase 2 (Search) ──────┼──> Phase 5 (Memory)
    │                           │         │
    └──> Phase 3 (Stats) ───────┘         │
              │                           │
              v                           v
         Phase 4 (Loading)          Phase 6 (Final)
```

**Phases 1, 2, 3**은 독립적으로 병렬 진행 가능
**Phase 4**는 Phase 1, 3 완료 후 진행
**Phase 5**는 모든 기능 최적화 후 진행 (Breaking change 가능성)
**Phase 6**은 마지막에 진행

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API 호환성 깨짐 | Low | High | 각 PR에서 타입 체크 |
| 벤치마크 불안정 | Medium | Low | 여러 번 실행 평균 |
| Phase 5 복잡도 | High | Medium | Option B로 단순화 가능 |
| 기존 버그 노출 | Medium | Medium | 테스트 커버리지 확인 |

---

## Success Criteria

- [ ] 모든 벤치마크에서 예상 개선 달성
- [ ] 기존 기능 정상 동작 (수동 테스트)
- [ ] 빌드 에러 없음
- [ ] Clippy 경고 없음

---

## Dependencies to Add

```toml
[dependencies]
dashmap = "5.5"  # Thread-safe caching (Phase 1)

[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }
tempfile = "3.10"  # Benchmark fixtures
```

---

## Notes

- 각 Phase는 독립적인 PR로 제출
- Phase 완료 시 벤치마크 결과 PR 설명에 포함
- Breaking change가 필요한 경우 사전 논의
