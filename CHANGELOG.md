# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## Version 1.0.0-beta.4 (2025-12-21)

### Added

- 📊 **Global Aggregated Dashboard**: View aggregated statistics across all projects in a single dashboard (#21)
- ⏱️ **Accurate Session Time Calculation**: Session duration now calculated precisely from message timestamps
- 💰 **Accurate Pricing Information**: Token usage cost calculation with accurate pricing model
- 🐧 **Linux Build Support**: Added comprehensive Linux build support with cross-platform automation (#6)
- ✅ **Unit Tests**: Added Vitest unit tests for tauri.conf.json validation and importability (#5)
- 🔄 **Update Check Caching**: Added update check result caching utility and force update check feature

### Changed

- 🌐 **Default Language**: Changed default language from Korean to English for better international accessibility
- ⚡ **Search Performance**: Optimized search performance for large JSONL files with improved indexing (#23)
- 📦 **JSONL Loading Optimization**: Analyzed and optimized batch size for better loading performance (#20)
- 🪟 **Windows Build**: Easier toolchain setup and build process on Windows (#17)
- 🔧 **Build System**: Enhanced build system with multi-package-manager support using $npm_execpath (#4)
- 🔄 **Update System**: Restructured update system for better reliability

### Fixed

- 🌐 **Complete i18n Coverage**: Removed all hardcoded Korean text that was ignoring language settings (#11)
  - Date formatting in session list now displays in selected language
  - Message count in conversation header displays in proper language
  - Settings dropdown "Update Settings" button internationalized
  - Update Settings modal fully internationalized (15+ elements)
  - First-launch introduction modal displays in user's system language (14 elements)
- 🔧 **Auto Language Detection**: App automatically detects and displays in user's system language on first launch
- 🔄 **App Update Version Management**: Fixed version comparison logic for proper update detection (#22)
- 🔐 **Security Patches**: Applied critical security patches and code quality improvements
- 🔑 **Tauri Signing**: Improved Tauri signing key handling and release workflow stability
- 🎨 **Component Optimization**: Optimized theme handling with useCallback for better performance
- 📝 **Internationalization Scope**: 50+ text strings internationalized across all 5 supported languages (en, ko, ja, zh-CN, zh-TW)

---

## Version 1.0.0-beta.3 (2025-07-03)

### Added

- 🌐 **다국어 지원**: 5개 언어 완전 지원 (한국어, 영어, 일본어, 중국어 간체/번체)
- 📧 **피드백 시스템**: 버그 신고, 기능 요청 등 카테고리별 피드백 제출 및 GitHub 연동
- 🛠️ **언어 선택 메뉴**: 설정에서 실시간 언어 변경 가능
- ⚡ **성능 모니터링**: 개발 모드에서 파일 로딩 시간 측정

### Changed

- ⚡ **파일 읽기 성능 개선**: 파일 크기 추정 방식으로 변경되어 대용량 파일 처리 속도 향상
- 🔧 **라이브러리 정리**: 실제 사용하는 syntax highlighting 라이브러리로 통일
- 🖥️ **플랫폼 명확화**: macOS 전용 최적화 및 Universal Binary 지원
- 📝 **README 간소화**: 46% 분량 감소로 핵심 기능 중심 재구성

### Fixed

- 🔧 **타입 안정성**: 메시지 구조체 정확도 개선
- 📝 **문서 정확성**: 실제 구현과 일치하도록 README 수정
- 🚀 **메모리 사용량**: 불필요한 메모리 할당 제거로 성능 개선

### Removed

- 🛠️ **미사용 컴포넌트**: 코드베이스 정리로 번들 크기 감소
- 📝 **불정확한 기능 설명**: README에서 미구현 기능 설명 제거

---

## Version 1.0.0-beta.2 (2025-07-02)

### 🆕 새로운 기능

- **📊 Analytics Dashboard**: 사용 패턴, 토큰 사용량, 활동 히트맵 등 종합 분석 대시보드 추가
- **🔄 자동 업데이트 시스템**: 우선순위별 업데이트 알림 (중요/권장/선택) 및 자동 체크 기능
- **💭 Thinking Content 표시**: Claude의 사고 과정을 포맷팅하여 표시하는 기능 추가

### 🚀 성능 개선

- **⚡ 페이지네이션 도입**: 대용량 세션도 빠른 초기 로딩 지원 (100개 단위 로딩)
- **📦 미사용 라이브러리 제거**: 번들 크기 최적화로 로딩 속도 개선

### 🔧 기술적 변경사항

- HeadlessUI → Radix UI로 UI 라이브러리 변경
- @tanstack/react-query 제거 (미사용)
- Lucide React 아이콘 라이브러리 채택

---

## Version 1.0.0.beta.1 (2025-06-30)

### 🎉 주요 기능

- **📁 프로젝트/세션 탐색**: Claude Code의 모든 프로젝트와 대화 세션을 계층적 트리 구조로 탐색
- **🔍 전체 텍스트 검색**: 모든 대화 내용에서 빠른 검색 가능
- **🎨 구문 강조**: 모든 프로그래밍 언어의 코드 블록에 대한 문법 강조 표시
- **📊 토큰 사용량 통계**: 프로젝트별, 세션별 토큰 사용량 분석 및 시각화
- **⚡ 높은 성능**: Rust 백엔드와 가상 스크롤링으로 대용량 대화 기록도 빠르게 처리
- **🌑 다크 모드 지원**: 다크모드, 라이트모드, 시스템모드를 지원합니다.

### 🚀 최근 개선사항

#### 렌더링 및 UI 개선

- **Diff 뷰어 개선**: 파일 변경사항을 라인 단위로 비교하도록 개선하여 가독성 향상
- **파일 편집 렌더링 최적화**: FileEditRenderer를 활용한 효율적인 파일 편집 결과 표시
- **Markdown 렌더링**: 명령어 출력 내용을 Markdown으로 렌더링하여 가독성 개선
- **세션 관리 개선**: 세션 경로 직접 사용 및 마지막 수정 시간 추가로 세션 정보 관리 강화
- **Sidechain 메시지 필터링**: 불필요한 sidechain 메시지를 제외하여 사용자 경험 개선

#### 성능 최적화

- `prism-react-renderer`로 코드 하이라이팅 엔진을 교체하여 렌더링 성능 대폭 개선
- Vite 번들 최적화로 초기 로딩 시간 단축
- 라이브러리별 청크 분할로 캐싱 효율성 향상
- 가상 스크롤링으로 대용량 메시지 목록 처리 최적화

#### UI/UX 개선

- ErrorBoundary 컴포넌트 추가로 안정성 향상
- Radix UI 드롭다운 메뉴 도입으로 접근성 개선
- 폴더 선택 UI 개선 및 오류 메시지 명확화
- 색상 상수화로 테마 일관성 유지
- 메시지 뷰어 스크롤 동작 최적화
- 세션 새로고침 기능 추가

#### 기능 추가

- 이미지 렌더링 지원
- Assistant 메시지 메타데이터 표시
- 세션 요약 정보 표시
- 빈 메시지 처리 로직 구현
- 무한 스크롤 페이지네이션
- Claude 폴더 경로 자동 저장

### 🛠️ 기술 스택

#### Frontend

- React 19.1.0 + TypeScript
- Tailwind CSS + @headlessui/react
- Zustand (상태 관리)
- @tanstack/react-query (데이터 fetching)
- prism-react-renderer (코드 하이라이팅)

#### Backend

- Tauri 2.6.1 (Rust)
- tokio (비동기 런타임)
- serde (직렬화)

### 📋 시스템 요구사항

- macOS 10.15+, Windows 10+, 또는 Linux
- Claude Code가 설치되어 있고 사용 기록이 있어야 함 (`~/.claude` 디렉토리)

### 🐛 알려진 이슈

- 매우 큰 세션 파일(100MB+)의 경우 초기 로딩이 느릴 수 있음

### 🔜 향후 계획

- 대화 내보내기 기능 (PDF, Markdown)
- 고급 필터링 옵션
- 메시지 북마크 기능
- 통계 차트 시각화 개선

---

이 도구는 Claude Code 사용자들이 자신의 대화 기록을 효과적으로 관리하고 검색할 수 있도록 돕기 위해 만들어졌습니다.
문제 발생 시 GitHub Issues에서 보고해 주세요.
