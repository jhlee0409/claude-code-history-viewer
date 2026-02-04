# i18n 구조 리팩토링 분석

## 현재 상태 분석

### 구조
```
src/i18n/
├── index.ts                 # i18next 설정 (단일 namespace)
├── useAppTranslation.ts     # 타입 안전 훅
├── types.generated.ts       # 자동 생성 타입 (35K+ tokens)
└── locales/
    ├── en.json              # 1392 keys, ~25K tokens
    ├── ko.json              # 1392 keys
    ├── ja.json              # 1392 keys
    ├── zh-CN.json           # 1392 keys
    └── zh-TW.json           # 1392 keys
```

### 문제점

1. **LLM 컨텍스트 한계**: 단일 파일 25K+ tokens → Claude가 한 번에 읽기 불가능
2. **변경 영향 범위**: 한 컴포넌트 번역 수정 시 전체 파일 수정 필요
3. **병렬 작업 불가**: 여러 기능의 번역을 동시에 작업하기 어려움
4. **코드 리뷰 어려움**: 관련 없는 키까지 노출되어 리뷰 복잡도 증가

### Prefix 분포 분석 (63개 고유 prefix)

| Prefix | Keys | 비율 | 설명 |
|--------|------|------|------|
| settingsManager | 483 | 34.7% | 설정 관리자 UI |
| analytics | 132 | 9.5% | 분석 대시보드 |
| session | 96 | 6.9% | 세션 관련 |
| common | 80 | 5.7% | 공통 UI 요소 |
| messageViewer | 37 | 2.7% | 메시지 뷰어 |
| error | 37 | 2.7% | 에러 메시지 |
| tools | 33 | 2.4% | 도구명 |
| feedback | 32 | 2.3% | 피드백 UI |
| toolResult | 25 | 1.8% | 도구 결과 |
| (기타 54개) | ~470 | 33.7% | 소규모 prefix들 |

## 리팩토링 전략

### 목표 구조
```
src/i18n/
├── index.ts                 # 멀티 namespace 설정
├── useAppTranslation.ts     # namespace 지원 훅
├── types.generated.ts       # namespace별 타입
└── locales/
    └── {lang}/              # 언어별 디렉토리
        ├── common.json      # 공통 (~80 keys, ~2K tokens)
        ├── analytics.json   # 분석 (~132 keys, ~4K tokens)
        ├── session.json     # 세션 (~96 keys, ~3K tokens)
        ├── settings.json    # 설정 (~483 keys, ~12K tokens)
        ├── tools.json       # 도구 (~58 keys, ~2K tokens)
        ├── error.json       # 에러 (~37 keys, ~1K tokens)
        ├── message.json     # 메시지 (~57 keys, ~2K tokens)
        ├── renderers.json   # 렌더러 (~200 keys, ~5K tokens)
        ├── update.json      # 업데이트 (~70 keys, ~2K tokens)
        └── feedback.json    # 피드백 (~32 keys, ~1K tokens)
```

### Namespace 통합 맵핑

| 새 Namespace | 포함할 Prefix |
|--------------|---------------|
| common | common, status, time, copyButton |
| analytics | analytics |
| session | session, project |
| settings | settingsManager, settings, folderPicker |
| tools | tools, toolResult, toolUseRenderer |
| error | error |
| message | message, messages, messageViewer, messageContentDisplay |
| renderers | *Renderer, *Display (각종 렌더러 통합) |
| update | update*, simpleUpdateModal, advancedTextDiff 등 |
| feedback | feedback, captureMode |

### 기대 효과

1. **LLM 친화적**: 각 namespace 2-12K tokens → 단일 컨텍스트에서 완전 처리 가능
2. **관심사 분리**: 컴포넌트 수정 시 관련 namespace만 변경
3. **병렬 번역 가능**: 여러 기능을 독립적으로 번역 작업 가능
4. **타입 안전성 유지**: namespace별 타입 + 전체 타입 유니온

## 구현 계획

### Phase 0: Impact Analysis & Migration Automation

Before applying the locales restructure, complete these steps:

#### 0.1 Build Config Assessment
- Review Vite configuration for locale loading patterns
- Check Tauri build process for i18n bundling
- Document any path resolution that depends on current structure

#### 0.2 Usage Audit
- List all files importing from `locales/{lang}.json`
- Identify i18next initialization code (src/i18n/index.ts)
- Map required rewrites in loader/init logic

#### 0.3 Migration Script
- Create automated script to transform `locales/{lang}.json` → `locales/{lang}/{namespace}.json`
- Include dry-run mode with output preview
- Add validation tests to verify key preservation
- Test roundtrip: split → verify keys → merge back

#### 0.4 Developer Workflow Documentation
- Document explicit migration steps
- Provide rollback instructions
- Update CI/CD pipeline if needed

This ensures the refactor is executed safely and repeatably.

### Phase 1: 분리 스크립트 작성
- `scripts/split-i18n.mjs`: 단일 JSON → namespace별 파일 분리
- prefix 맵핑 정의 및 자동 분류

### Phase 2: i18next 설정 업데이트
- 멀티 namespace 로딩 설정
- fallback 및 lazy loading 구성

### Phase 3: 타입 시스템 업데이트
- namespace별 타입 생성
- `useAppTranslation` 훅 업데이트

### Phase 4: 검증
- TypeScript 빌드 통과
- 모든 테스트 통과
- 런타임 번역 동작 확인

## 마이그레이션 호환성

기존 코드의 `t('prefix.key')` 호출은 **변경 없이** 동작해야 함:
- i18next는 모든 namespace를 로드하므로 기존 키 형식 유지
- 점진적으로 `t('key', { ns: 'namespace' })` 형식으로 이전 가능
