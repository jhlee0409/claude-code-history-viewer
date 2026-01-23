# i18n 구조 LLM 친화적 리팩토링 계획 (v2)

## 개요
현재 분산된 i18n 파일 구조를 **언어별 단일 파일 + 도트 표기법 평탄화**로 변경하여 LLM이 쉽게 이해하고 누락 없이 수정할 수 있는 구조로 개선합니다.

## 현재 상태

```
src/i18n/
├── index.ts
├── types.ts
└── locales/
    └── {lang}/           # 5개 언어 (en, ko, ja, zh-CN, zh-TW)
        ├── common.json     (~86줄)
        ├── messages.json   (~10줄)
        └── components.json (~787줄) ← 거대한 파일
```

### 문제점
1. `components.json`이 787줄로 너무 큼
2. 3개 파일로 분산되어 있어 어디에 추가할지 판단 필요
3. 깊은 중첩 구조로 키 경로 복잡
4. 5개 언어 × 3개 파일 = 15개 파일 관리 필요

## 목표 구조

```
src/i18n/
├── index.ts              # i18n 설정 (업데이트)
├── types.ts              # 자동 생성 타입
├── generateTypes.ts      # 타입 생성 스크립트 (신규)
└── locales/
    ├── en.json           # 영어 전체 (~730줄)
    ├── ko.json           # 한국어 전체
    ├── ja.json           # 일본어 전체
    ├── zh-CN.json        # 중국어 간체 전체
    └── zh-TW.json        # 중국어 번체 전체
```

## 키 구조 (도트 표기법 평탄화)

### Before (중첩 구조)
```json
{
  "analytics": {
    "legend": {
      "less": "Less",
      "more": "More"
    },
    "tokenDistribution": "Token Distribution"
  }
}
```

### After (1단계 평탄화)
```json
{
  "analytics.legend.less": "Less",
  "analytics.legend.more": "More",
  "analytics.tokenDistribution": "Token Distribution"
}
```

## 키 접두사 규칙

| 접두사 | 용도 | 예시 |
|--------|------|------|
| `common.` | 공통 UI (버튼, 액션, 상태) | `common.loading`, `common.cancel` |
| `analytics.` | 분석/통계 | `analytics.dashboard`, `analytics.tokenUsage` |
| `session.` | 세션/프로젝트 | `session.title`, `session.loading` |
| `project.` | 프로젝트 관련 | `project.count`, `project.notFound` |
| `message.` | 메시지 뷰어 | `message.user`, `message.claude` |
| `tools.` | 도구 이름 | `tools.terminal`, `tools.readFile` |
| `toolResult.` | 도구 결과 | `toolResult.output`, `toolResult.error` |
| `error.` | 에러 메시지 | `error.unexpected`, `error.sorry` |
| `settings.` | 설정 화면 | `settings.title`, `settings.theme.light` |
| `update.` | 업데이트 | `update.available`, `update.downloading` |
| `feedback.` | 피드백 | `feedback.title`, `feedback.send` |
| `time.` | 시간 관련 | `time.justNow`, `time.minutesAgo` |
| `renderer.` | 렌더러 컴포넌트 | `renderer.thinking.title`, `renderer.webSearch.query` |
| `diff.` | Diff 뷰어 | `diff.before`, `diff.after` |

## TypeScript 타입 생성

### generateTypes.ts
```typescript
// en.json을 읽어서 타입 자동 생성
// 접두사별로 그룹화된 타입 제공

export type TranslationKey =
  | 'common.appName'
  | 'common.loading'
  | 'analytics.dashboard'
  // ... 모든 키

// 접두사별 키 타입 (자동완성용)
export type CommonKey = 'appName' | 'loading' | 'cancel' | ...
export type AnalyticsKey = 'dashboard' | 'tokenUsage' | ...
```

### 사용 예시
```typescript
// 타입 안전한 번역 호출
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();
t('analytics.dashboard');  // ✅ 자동완성 지원
t('analytics.nonexistent'); // ❌ 타입 에러
```

## 커스텀 훅 설계

### useAppTranslation 훅
```typescript
// src/i18n/useAppTranslation.ts
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from './types';

export function useAppTranslation() {
  const { t: originalT, i18n } = useTranslation();

  // 타입 안전한 t 함수
  const t = (key: TranslationKey, options?: Record<string, unknown>) => {
    return originalT(key, options);
  };

  return { t, i18n };
}
```

### 사용 예시
```typescript
// Before
const { t } = useTranslation("common");
const { t: tComponents } = useTranslation("components");
t('loading');
tComponents('session.title');

// After
const { t } = useAppTranslation();
t('common.loading');      // ✅ 자동완성
t('session.title');       // ✅ 자동완성
t('invalid.key');         // ❌ 타입 에러
```

---

## 구현 단계

### Phase 1: 영어 기준 파일 생성 (소스 병합 + 평탄화)
1. `en/common.json` + `en/messages.json` + `en/components.json` 병합
2. 모든 키를 도트 표기법으로 평탄화
3. 접두사 정렬하여 `locales/en.json` 생성

### Phase 2: 다국어 파일 생성
1. `ko/` 파일들 병합 → `locales/ko.json`
2. `ja/` 파일들 병합 → `locales/ja.json`
3. `zh-CN/` 파일들 병합 → `locales/zh-CN.json`
4. `zh-TW/` 파일들 병합 → `locales/zh-TW.json`

### Phase 3: 타입 시스템 구축
1. `generateTypes.ts` 스크립트 작성
2. `package.json`에 `generate:i18n-types` 스크립트 추가
3. `types.ts` 자동 생성

### Phase 4: i18n 설정 업데이트
1. `index.ts`에서 새 구조로 리소스 로딩 변경
2. 네임스페이스 설정 제거 (단일 네임스페이스)

### Phase 5: 코드 마이그레이션
1. `useTranslation('namespace')` → `useTranslation()` 변경
2. 키 경로 업데이트 (예: `t('title')` → `t('session.title')`)
3. 타입 체크 확인

### Phase 6: 정리 및 검증
1. 기존 `locales/{lang}/` 디렉토리 삭제
2. 빌드 테스트
3. 런타임 테스트
4. 키 개수 일치 검증 (5개 언어 모두 동일해야 함)

## 장점

### LLM 친화성
| 항목 | 개선 효과 |
|------|----------|
| 파일 수 | 15개 → 5개 (언어당 1개) |
| 메시지 추가 | 분류 고민 없이 접두사만 결정 |
| 누락 검증 | `diff en.json ko.json`으로 즉시 확인 |
| 컨텍스트 | 단일 파일로 전체 구조 파악 용이 |

### 확장성
| 시나리오 | 작업 |
|----------|------|
| 새 언어 추가 | 1개 파일 복사 후 번역 |
| 새 메시지 추가 | 5개 파일에 동일 키 추가 |
| 키 검증 | `jq 'keys | length' *.json`으로 개수 비교 |

## 검증 체크리스트

```bash
# 모든 언어 파일의 키 개수 확인
for f in src/i18n/locales/*.json; do
  echo "$f: $(jq 'keys | length' $f)"
done

# 영어 기준 누락 키 확인
diff <(jq -r 'keys[]' en.json | sort) <(jq -r 'keys[]' ko.json | sort)
```

## 성공 기준

1. ✅ 5개 언어 파일 모두 동일한 키 개수
2. ✅ 모든 키가 도트 표기법 (최대 3단계: `prefix.group.key`)
3. ✅ TypeScript 키 자동완성 동작
4. ✅ 기존 번역 100% 보존
5. ✅ 빌드 성공
6. ✅ 런타임 에러 없음

## 예상 결과

| 파일 | 줄 수 | 키 개수 (예상) |
|------|-------|---------------|
| en.json | ~730 | ~350 |
| ko.json | ~730 | ~350 |
| ja.json | ~730 | ~350 |
| zh-CN.json | ~730 | ~350 |
| zh-TW.json | ~730 | ~350 |
