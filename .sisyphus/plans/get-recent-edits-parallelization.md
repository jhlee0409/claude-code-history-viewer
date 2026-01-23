# get_recent_edits 병렬화 최적화 계획

## 현재 상태

### 벤치마크 결과 (최적화 전)
| 테스트 크기 | 소요 시간 |
|------------|----------|
| 5 세션 × 50 편집 | 386 µs |
| 10 세션 × 100 편집 | 1.4 ms |
| 20 세션 × 100 편집 | 2.9 ms |

### 현재 구현의 병목점
1. **순차적 파일 처리**: `WalkDir` 순회 후 각 파일을 순차적으로 처리
2. **단일 스레드 파싱**: JSON 파싱이 단일 스레드에서 수행
3. **공유 상태 집계**: `all_edits`와 `cwd_counts`가 루프 내에서 직접 수정됨

### 참고: stats.rs 병렬화 패턴
```rust
// 1. 파일 목록 수집
let session_files: Vec<PathBuf> = WalkDir::new(&project_path)...collect();

// 2. 병렬 처리
let file_stats: Vec<FileStats> = session_files
    .par_iter()
    .filter_map(|path| process_file(path))
    .collect();

// 3. 결과 집계
for stats in file_stats { ... }
```

---

## 구현 계획

### Phase 1: 중간 구조체 정의

새로운 구조체 추가:
```rust
/// 단일 세션 파일에서 추출한 편집 정보 (병렬 처리용)
struct SessionEditsResult {
    edits: Vec<RecentFileEdit>,
    cwd_counts: HashMap<String, usize>,
}
```

### Phase 2: 파일 처리 함수 분리

```rust
/// 단일 세션 파일에서 편집 정보 추출
fn process_session_file_for_edits(file_path: &PathBuf) -> Option<SessionEditsResult> {
    // 기존 루프 내부 로직을 함수로 추출
    // cwd_counts도 로컬로 수집하여 반환
}
```

### Phase 3: rayon 병렬화 적용

```rust
pub async fn get_recent_edits(project_path: String) -> Result<RecentEditsResult, String> {
    // 1. 파일 목록 수집
    let session_files: Vec<PathBuf> = WalkDir::new(&project_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .map(|e| e.path().to_path_buf())
        .collect();

    // 2. 병렬 처리
    let file_results: Vec<SessionEditsResult> = session_files
        .par_iter()
        .filter_map(|path| process_session_file_for_edits(path))
        .collect();

    // 3. 결과 집계
    let mut all_edits: Vec<RecentFileEdit> = Vec::new();
    let mut cwd_counts: HashMap<String, usize> = HashMap::new();

    for result in file_results {
        all_edits.extend(result.edits);
        for (cwd, count) in result.cwd_counts {
            *cwd_counts.entry(cwd).or_insert(0) += count;
        }
    }

    // 4. 기존 후처리 로직 (필터링, 정렬, 중복 제거)
    // ... (변경 없음)
}
```

### Phase 4: 용량 사전 할당

```rust
// 예상 용량 계산 (파일 크기 기반)
let estimated_capacity: usize = session_files
    .iter()
    .filter_map(|p| p.metadata().ok())
    .map(|m| std::cmp::max(1, m.len() as usize / 4096))
    .sum();

let mut all_edits: Vec<RecentFileEdit> = Vec::with_capacity(estimated_capacity);
```

---

## 예상 개선 효과

| 테스트 크기 | Before | After (예상) | 개선율 |
|------------|--------|-------------|-------|
| 5 세션 × 50 편집 | 386 µs | ~200 µs | ~48% |
| 10 세션 × 100 편집 | 1.4 ms | ~500 µs | ~64% |
| 20 세션 × 100 편집 | 2.9 ms | ~800 µs | ~72% |

*병렬 처리는 세션 수가 많을수록 효과가 큼*

---

## 구현 단계

- [ ] Phase 1: `SessionEditsResult` 구조체 정의
- [ ] Phase 2: `process_session_file_for_edits` 함수 분리
- [ ] Phase 3: `rayon::par_iter()` 적용
- [ ] Phase 4: 용량 사전 할당 추가
- [ ] Phase 5: 벤치마크 실행 및 결과 비교
- [ ] Phase 6: 기존 테스트 통과 확인

---

## 위험 요소

1. **cwd_counts 집계**: 병렬로 수집 후 순차 병합 필요 (HashMap 병합 오버헤드)
2. **메모리 사용량**: 병렬 처리 시 각 스레드에서 중간 결과 보관
3. **작은 데이터셋**: 세션 수가 적을 때 병렬화 오버헤드가 이득보다 클 수 있음

---

## 대안 고려

### 옵션 A: 전체 병렬화 (권장)
- 모든 세션 파일을 `par_iter`로 병렬 처리
- 구현이 간단하고 대부분의 경우 성능 향상

### 옵션 B: 조건부 병렬화
- 세션 수가 특정 임계값(예: 5개) 이상일 때만 병렬화
- 작은 데이터셋에서 오버헤드 방지

### 옵션 C: 청크 기반 병렬화
- 파일을 청크로 나누어 병렬 처리
- 더 세밀한 제어 가능하지만 복잡도 증가

**선택: 옵션 A** - stats.rs와 동일한 패턴으로 일관성 유지

---

## 완료 기준

1. 벤치마크에서 최소 40% 성능 향상
2. 기존 테스트 모두 통과
3. 코드 스타일 일관성 유지 (stats.rs 패턴 따름)
