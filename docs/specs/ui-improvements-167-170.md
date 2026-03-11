# UI Improvements Plan (#167, #168, #169, #170)

> **Branch**: `feature/ui-improvements-167-170`
> **Issues**: #167, #168, #169, #170
> **Reporter**: @jovezhong (2026-03-08)
> **Common Theme**: UI/UX 개선 및 반응형 레이아웃

---

## Issue #170 — 타임스탬프에 날짜 미표시

### 현재 문제

메시지에 시간만 표시되고(`9:42 PM`) 날짜 정보가 없어 과거 대화 리뷰 시 날짜를 알 수 없음.

### 해결 방안: 날짜 구분선 + Hover Tooltip

1. **날짜 구분선**: 날짜가 바뀌는 시점에 `── 2026년 3월 8일 (토) ──` 구분선 삽입 (채팅앱 표준 패턴)
2. **Hover tooltip**: 타임스탬프에 마우스 올리면 전체 날짜+시간 표시

### 수정 대상

| 파일 | 변경 내용 |
|------|----------|
| `src/components/MessageViewer/` | 가상 스크롤 목록에 날짜 구분선 아이템 타입 추가 |
| 타임스탬프 렌더링 컴포넌트 | Tooltip 래핑 (전체 날짜+시간) |
| `src/i18n/locales/*/common.json` | 날짜 포맷 i18n 키 추가 (5개 언어) |

### 주의사항

- 가상 스크롤(`react-window`)에 구분선 아이템의 높이 계산 필요
- i18n: 언어별 날짜 포맷 차이 대응 (en: "Mar 8, 2026", ko: "2026년 3월 8일", ja: "2026年3月8日" 등)

---

## Issue #169 — 캡처 모드 테마 동기화 + 접힘 상태 유지

### 현재 문제

1. 라이트모드를 사용해도 캡처 결과가 항상 다크모드로 생성됨
2. UI에서 접어놓은 도구 상세 정보가 캡처에서 모두 펼쳐짐

### 원인 분석

**테마 하드코딩** — `OffScreenCaptureRenderer.tsx`:
```typescript
// 현재: 다크모드 고정
backgroundColor: "#09090b",  // zinc-950
color: "#fafafa",
```

**강제 펼침** — `CaptureExpandContext.tsx`:
```typescript
// 현재: 모든 접힘 상태를 무시하고 펼침
<CaptureExpandProvider value={{ forceExpanded: true }}>
```

### 해결 방안

#### 방안 1 — 테마 동기화

- `OffScreenCaptureRenderer.tsx`의 하드코딩된 색상 제거
- 현재 테마의 CSS 변수(`--background`, `--foreground` 등)를 참조하도록 변경
- 캡처 컨테이너에 현재 `data-theme` / `class="dark"` 속성 전달

#### 방안 2 — 접힘 상태 WYSIWYG (What You See Is What You Get)

- `CaptureExpandProvider`의 `forceExpanded: true` 제거
- 각 컴포넌트의 실제 collapsed/expanded 상태가 캡처에 그대로 반영
- "보이는 그대로 캡처"가 기본 원칙

### 수정 대상

| 파일 | 변경 내용 |
|------|----------|
| `src/components/MessageViewer/components/OffScreenCaptureRenderer.tsx` | 하드코딩 색상 → CSS 변수, 테마 클래스 전달 |
| `src/contexts/CaptureExpandContext.tsx` | `forceExpanded: true` 제거 또는 조건부 적용 |
| `src/hooks/useCaptureScreenshot.ts` | `toPng()` 호출 시 `backgroundColor` 동적 결정 |

### 주의사항

- `html-to-image`의 `toPng()` 호출 시 `backgroundColor` 옵션도 동적으로 전달해야 함
- OffScreen 렌더러가 별도 DOM이므로 CSS 변수가 정상 상속되는지 확인 필요
- 기존 캡처 기능 회귀 테스트 (다크/라이트 모드 각각)

---

## Issue #168 — 설정 드롭다운 컴팩트화

### 현재 문제

설정 드롭다운 메뉴가 ~19줄로 길어 창 높이가 부족하면 하단 항목(Check for Updates, 버전 정보)에 접근 불가.

### 현재 드롭다운 구조 (19줄)

```
Settings                    ← 1줄
Change Folder               ← 1줄
Send Feedback               ← 1줄
─── Filter ───
Show System Messages        ← 1줄
─── Font Size ───
Compact (90%)               ← 1줄
Default (100%)              ← 1줄
Large (110%)                ← 1줄
Extra Large (120%)          ← 1줄
Maximum (130%)              ← 1줄
─── Accessibility ───
High Contrast Mode          ← 1줄
─── Theme ───
Light                       ← 1줄
Dark                        ← 1줄
System                      ← 1줄
─── Language ───
English                     ← 1줄
한국어                       ← 1줄
日本語                       ← 1줄
简体中文                     ← 1줄
繁體中文                     ← 1줄
───
Check for Updates           ← 1줄
```

### 해결 방안: 컴팩트 UI 패턴 적용

공간을 과다 점유하는 항목을 컴팩트 컨트롤로 교체:

| 항목 | 현재 (줄 수) | 변경 후 (줄 수) | 패턴 |
|------|------------|--------------|------|
| Theme | 라디오 3개 (3줄) | 아이콘 토글 그룹 (1줄) | macOS, shadcn/ui 표준 패턴 |
| Font Size | 라디오 5개 (5줄) | Select 드롭다운 (1줄) | Discord, Chrome 패턴 |
| Language | 라디오 5개 (5줄) | Select 드롭다운 (1줄) | Notion, Figma, Discord 패턴 |

**결과**: 19줄 → ~10줄 (9줄 축소)

### 변경 후 드롭다운 구조 (10줄)

```
Settings                    ← 1줄
Change Folder               ← 1줄
Send Feedback               ← 1줄
─── Filter ───
Show System Messages        ← 1줄
─── Font Size ───
[Default (100%)       ▾]   ← Select 1줄
─── Accessibility ───
High Contrast Mode          ← 1줄
─── Theme ───
[☀️] [🌙] [🖥️]             ← 아이콘 토글 1줄
─── Language ───
[English              ▾]   ← Select 1줄
───
Check for Updates           ← 1줄
```

### 수정 대상

| 파일 | 변경 내용 |
|------|----------|
| 설정 드롭다운 컴포넌트 | Theme → 아이콘 토글 그룹, Font Size → Select, Language → Select |
| `src/components/ui/select.tsx` | 기존 shadcn Select 재활용 (신규 생성 불필요) |
| 드롭다운 컨테이너 | `max-height: calc(100vh - 80px)` + `overflow-y: auto` 안전장치 |

### 참고: 패턴 검증 결과

| 패턴 | 검증 | 사례 |
|------|------|------|
| Theme 아이콘 토글 | 표준화 추세 | macOS Appearance, shadcn/ui, Next.js 생태계 |
| Font Size Select | 잘 확립됨 | Discord (채팅 폰트 스케일링), Chrome (폰트 설정) |
| Language Select | 가장 표준적 | Notion, Figma, Discord, 미국 정부 디자인 시스템(USWDS) |

### 주의사항

- Theme 아이콘에 `aria-label` + tooltip 필수 (특히 "System" 아이콘)
- Language Select 내 언어명은 해당 언어로 표기 ("日本語", "한국어") — 현재 이미 이렇게 되어 있음
- `max-height` 스크롤은 향후 설정 항목 추가에 대한 안전장치

---

## ~~Issue #167 — 좁은 창 패널 겹침~~ ✅ 완료

> PR #171로 해결됨 (`fix/167-panel-overlap` → `main` 머지 완료)

---

## 작업 계획

각 이슈를 별도 브랜치에서 작업 후 `feature/ui-improvements-167-170`으로 병합:

| 순서 | 이슈 | 브랜치 | 난이도 | 상태 |
|------|------|--------|--------|------|
| ~~1~~ | ~~#167 패널 겹침~~ | ~~`fix/167-panel-overlap`~~ | ~~중~~ | ✅ 완료 (PR #171) |
| ~~2~~ | ~~#168 설정 컴팩트~~ | ~~`fix/168-settings-compact`~~ | ~~중~~ | ✅ 완료 (PR #177) |
| 3 | #169 캡처 모드 | `feature/ui-improvements-167-170` | 중 | ✅ 완료 |
| ~~4~~ | ~~#170 날짜 표시~~ | ~~`feature/170-date-display`~~ | ~~중~~ | ✅ 완료 (PR #182) |
