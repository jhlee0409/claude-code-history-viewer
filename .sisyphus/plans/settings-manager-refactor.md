# Settings Manager 전체 리팩토링 계획

## 개요

| 항목 | 내용 |
|------|------|
| **목표** | Settings Manager 코드 품질 개선 및 통합 |
| **브랜치** | feat/mcp-settings-manager |
| **최종 UI** | UnifiedSettingsManager (사이드바 기반) |

---

## Phase 1: 레거시 컴포넌트 제거 및 통합

### 1.1 SettingsManager.tsx 제거
- [ ] `SettingsManager.tsx` (661줄) 삭제
- [ ] `index.ts`에서 export 정리 → `UnifiedSettingsManager`만 export
- [ ] App.tsx에서 import 경로 확인 및 수정

### 1.2 컴포넌트 정리
- [ ] `components/index.ts` export 정리
- [ ] 사용되지 않는 컴포넌트 확인 및 제거
  - `JsonViewer.tsx` (39줄) - 사용 여부 확인
  - `ScopeTabs.tsx` (73줄) - UnifiedSettingsManager에서 미사용 시 제거

---

## Phase 2: 보안 강화

### 2.1 환경 변수 마스킹 유틸리티 통합
- [ ] `src/utils/securityUtils.ts` 생성
```typescript
export const SENSITIVE_PATTERNS = ['key', 'token', 'secret', 'password', 'api'];

export function maskSensitiveValue(key: string, value: string): string {
  const isSensitive = SENSITIVE_PATTERNS.some(p =>
    key.toLowerCase().includes(p)
  );
  if (isSensitive || value.length <= 8) {
    return '••••••••';
  }
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

export function shouldMaskKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some(p => key.toLowerCase().includes(p));
}
```

- [ ] `MCPServerManager.tsx` 마스킹 로직 교체
- [ ] `UnifiedMCPList.tsx` 마스킹 로직 교체
- [ ] `EffectiveSettingsViewer.tsx` 환경변수 마스킹 적용

### 2.2 내보내기 시 민감 정보 경고
- [ ] `ExportImport.tsx`에 경고 다이얼로그 추가
- [ ] 민감 정보 포함 여부 감지 로직 추가
- [ ] i18n 키 추가: `settingsManager.export.sensitiveWarning`

---

## Phase 3: 에러 핸들링 개선

### 3.1 Toast 알림 시스템 연동
- [ ] 기존 Toast 컴포넌트 확인 또는 추가
- [ ] `useMCPServers.ts`에 에러 Toast 연동
- [ ] `UnifiedSettingsManager.tsx`에 저장 성공/실패 Toast 추가

### 3.2 에러 경계 추가
- [ ] Settings Manager용 ErrorBoundary 컴포넌트 생성
- [ ] 주요 섹션별 에러 격리

---

## Phase 4: 성능 최적화

### 4.1 컴포넌트 메모이제이션
- [ ] `MCPServerManager.tsx` → `React.memo` 적용
- [ ] `UnifiedMCPList.tsx` → `React.memo` 적용
- [ ] `EffectiveSettingsViewer.tsx` → `React.memo` 적용
- [ ] `ScopeSwitcher.tsx` → `React.memo` 적용
- [ ] 내부 컴포넌트들도 메모이제이션 검토
  - `ServerCard`
  - `SourceBadge`
  - `ScopeBadge`

### 4.2 불필요한 리렌더링 방지
- [ ] `useCallback` 적용 검토 (이벤트 핸들러)
- [ ] Context 분리 검토 (상태 vs 액션)

### 4.3 Magic Numbers 상수화
- [ ] `src/components/SettingsManager/constants.ts` 생성
```typescript
export const DIALOG_MAX_HEIGHT = '80vh';
export const PROJECT_LIST_MAX_HEIGHT = '55vh';
export const MASK_MIN_LENGTH = 8;
```

---

## Phase 5: 코드 정리

### 5.1 Unused Imports 제거
- [ ] 각 파일에서 사용하지 않는 import 정리
- [ ] ESLint `no-unused-vars` 경고 해결

### 5.2 타입 정리
- [ ] `MCPViewSource` 타입을 types 파일로 이동
- [ ] 공통 Props 타입 추출 (중복 제거)

### 5.3 파일 구조 정리
```
SettingsManager/
├── index.ts                 # UnifiedSettingsManager만 export
├── UnifiedSettingsManager.tsx
├── constants.ts             # 새로 생성
├── components/
│   ├── index.ts
│   ├── MCPServerManager.tsx
│   ├── UnifiedMCPList.tsx
│   ├── EffectiveSettingsViewer.tsx
│   ├── PresetManager.tsx
│   ├── ExportImport.tsx
│   ├── JsonSettingsEditor.tsx
│   └── VisualSettingsEditor.tsx
├── sidebar/
├── editor/
├── sections/
└── dialogs/
```

---

## Phase 6: 테스트 보강

### 6.1 기존 테스트 검증
- [ ] `useMCPServers.test.ts` 실행 및 통과 확인
- [ ] `UnifiedMCPList.test.tsx` 실행 및 통과 확인

### 6.2 추가 테스트 작성
- [ ] `securityUtils.test.ts` - 마스킹 유틸리티 테스트
- [ ] `settingsMerger.test.ts` - 병합 로직 테스트
- [ ] `UnifiedSettingsManager.test.tsx` - 통합 컴포넌트 테스트

---

## Phase 7: i18n 정리

### 7.1 사용되지 않는 키 제거
- [ ] 레거시 컴포넌트 제거 후 불필요한 i18n 키 정리

### 7.2 새 키 추가
- [ ] 보안 경고 관련 키
- [ ] Toast 메시지 관련 키

---

## 실행 순서

```
Phase 1 (통합) → Phase 5 (정리) → Phase 2 (보안) → Phase 3 (에러) → Phase 4 (성능) → Phase 6 (테스트) → Phase 7 (i18n)
```

**이유**:
1. 먼저 레거시를 제거해야 작업 범위가 명확해짐
2. 코드 정리 후 새 기능 추가가 깔끔함
3. 테스트는 기능 구현 후 검증

---

## 예상 변경 파일

| 작업 | 파일 |
|------|------|
| 삭제 | `SettingsManager.tsx`, `ScopeTabs.tsx`(조건부), `JsonViewer.tsx`(조건부) |
| 생성 | `securityUtils.ts`, `constants.ts`, `securityUtils.test.ts`, `settingsMerger.test.ts` |
| 수정 | `index.ts`, `MCPServerManager.tsx`, `UnifiedMCPList.tsx`, `EffectiveSettingsViewer.tsx`, `ExportImport.tsx`, `useMCPServers.ts`, `App.tsx`, i18n 파일들 |

---

## 완료 기준

- [ ] `pnpm tsc --build .` 통과
- [ ] `pnpm test run` 통과
- [ ] `pnpm lint` 경고 최소화
- [ ] 레거시 컴포넌트 0개
- [ ] 모든 환경 변수 마스킹 통일
- [ ] 에러 시 Toast 표시
- [ ] 내보내기 시 민감 정보 경고

---

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| App.tsx 통합 시 기존 사용처 누락 | 런타임 에러 | grep으로 모든 import 확인 |
| i18n 키 삭제 시 누락 | 번역 깨짐 | 키 사용처 검색 후 삭제 |
| 메모이제이션 과적용 | 오히려 성능 저하 | 실제 리렌더링 측정 후 적용 |
