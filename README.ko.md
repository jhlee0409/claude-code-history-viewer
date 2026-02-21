<div align="center">

# Claude Code History Viewer

**Claude Code 대화 기록을 탐색, 검색, 분석하세요 — 완전한 오프라인.**

Claude Code, Codex CLI, OpenCode의 대화 기록을 분석, 세션 보드, 실시간 모니터링과 함께 탐색하는 데스크톱 앱.

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Downloads](https://img.shields.io/github/downloads/jhlee0409/claude-code-history-viewer/total?color=green)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Stars](https://img.shields.io/github/stars/jhlee0409/claude-code-history-viewer?style=flat&color=yellow)](https://github.com/jhlee0409/claude-code-history-viewer/stargazers)
[![License](https://img.shields.io/github/license/jhlee0409/claude-code-history-viewer)](LICENSE)
[![Rust Tests](https://img.shields.io/github/actions/workflow/status/jhlee0409/claude-code-history-viewer/rust-tests.yml?label=Rust%20Tests)](https://github.com/jhlee0409/claude-code-history-viewer/actions/workflows/rust-tests.yml)
[![Last Commit](https://img.shields.io/github/last-commit/jhlee0409/claude-code-history-viewer)](https://github.com/jhlee0409/claude-code-history-viewer/commits/main)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[웹사이트](https://jhlee0409.github.io/claude-code-history-viewer/) · [다운로드](https://github.com/jhlee0409/claude-code-history-viewer/releases) · [버그 제보](https://github.com/jhlee0409/claude-code-history-viewer/issues)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

</div>

---

<p align="center">
  <img width="49%" alt="Conversation History" src="https://github.com/user-attachments/assets/9a18304d-3f08-4563-a0e6-dd6e6dfd227e" />
  <img width="49%" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/0f869344-4a7c-4f1f-9de3-701af10fc255" />
</p>
<p align="center">
  <img width="49%" alt="Token Statistics" src="https://github.com/user-attachments/assets/d30f3709-1afb-4f76-8f06-1033a3cb7f4a" />
  <img width="49%" alt="Recent Edits" src="https://github.com/user-attachments/assets/8c9fbff3-55dd-4cfc-a135-ddeb719f3057" />
</p>

## 목차

- [주요 기능](#주요-기능)
- [설치](#설치)
- [소스에서 빌드](#소스에서-빌드)
- [사용법](#사용법)
- [기술 스택](#기술-스택)
- [데이터 프라이버시](#데이터-프라이버시)
- [문제 해결](#문제-해결)
- [기여하기](#기여하기)
- [라이선스](#라이선스)

## 주요 기능

| 기능 | 설명 |
|---------|-------------|
| **멀티 프로바이더** | Claude Code, Codex CLI, OpenCode 대화를 통합 뷰어로 탐색 |
| **대화 브라우저** | 프로젝트/세션별 대화 탐색 (워크트리 그룹핑 지원) |
| **글로벌 검색** | 모든 대화에서 즉시 검색 |
| **분석 대시보드** | 프로바이더별 토큰 사용량 통계 및 API 비용 계산 |
| **세션 보드** | 멀티 세션 시각 분석 (픽셀 뷰, 속성 브러싱, 액티비티 타임라인) |
| **설정 관리자** | 스코프 기반 Claude Code 설정 편집기 (MCP 서버 관리 포함) |
| **메시지 네비게이터** | 우측 접이식 TOC로 긴 대화 빠르게 탐색 |
| **실시간 모니터링** | 세션 파일 변경 실시간 감지 및 즉시 업데이트 |
| **세션 컨텍스트 메뉴** | 세션 ID 복사, 재개 명령 복사, 파일 경로 복사; 네이티브 이름 변경 및 검색 연동 |
| **ANSI 색상 렌더링** | 터미널 출력을 원본 ANSI 색상으로 표시 |
| **다국어 지원** | 영어, 한국어, 일본어, 중국어 (간체 및 번체) |
| **최근 편집** | 파일 수정 내역 확인 및 복원 |
| **자동 업데이트** | 내장 업데이터 (건너뛰기/연기 옵션 포함) |

## 설치

플랫폼에 맞는 최신 릴리즈를 다운로드하세요:

| 플랫폼 | 다운로드 |
|----------|----------|
| macOS (Universal) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

업그레이드:

```bash
brew upgrade --cask claude-code-history-viewer
```

제거:

```bash
brew uninstall --cask claude-code-history-viewer
```

> **기존 수동 설치(.dmg)에서 전환하시나요?**
> 충돌을 방지하려면 기존 앱을 먼저 삭제한 후 Homebrew로 설치하세요.
> 설치 방식은 **하나만** 사용하세요 — 수동 설치와 Homebrew를 함께 사용하지 마세요.
> ```bash
> # 수동 설치된 앱을 먼저 삭제
> rm -rf "/Applications/Claude Code History Viewer.app"
> # Homebrew로 설치
> brew tap jhlee0409/tap
> brew install --cask claude-code-history-viewer
> ```

## 소스에서 빌드

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer

# 방법 1: just 사용 (권장)
brew install just    # 또는: cargo install just
just setup
just dev             # 개발 모드
just tauri-build     # 프로덕션 빌드

# 방법 2: pnpm 직접 사용
pnpm install
pnpm tauri:dev       # 개발 모드
pnpm tauri:build     # 프로덕션 빌드
```

**요구사항**: Node.js 18+, pnpm, Rust toolchain

## 사용법

1. 앱 실행
2. 지원하는 모든 프로바이더 (Claude Code, Codex CLI, OpenCode)에서 대화 데이터 자동 스캔
3. 좌측 사이드바에서 프로젝트 탐색 — 탭 바로 프로바이더별 필터링
4. 세션 클릭하여 메시지 확인
5. 탭으로 메시지, 분석, 토큰 통계, 최근 편집, 세션 보드 전환

## 기술 스택

| 레이어 | 기술 |
|-------|------------|
| **백엔드** | ![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white) ![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?logo=tauri&logoColor=white) |
| **프론트엔드** | ![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) |
| **상태 관리** | ![Zustand](https://img.shields.io/badge/Zustand-433E38?logo=react&logoColor=white) |
| **빌드** | ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) |
| **다국어** | ![i18next](https://img.shields.io/badge/i18next-26A69A?logo=i18next&logoColor=white) 5개 언어 |

## 데이터 프라이버시

**100% 오프라인.** 대화 데이터는 어떤 서버로도 전송되지 않습니다. 분석도, 추적도, 원격 측정도 없습니다.

모든 데이터는 사용자의 기기에만 저장됩니다.

## 문제 해결

| 문제 | 해결 방법 |
|---------|----------|
| "Claude 데이터를 찾을 수 없음" | `~/.claude` 폴더가 존재하고 대화 기록이 있는지 확인 |
| 성능 문제 | 대용량 대화 기록은 초기 로딩이 느릴 수 있음 — 앱은 가상 스크롤링 사용 |
| 업데이트 오류 | 자동 업데이트 실패 시 [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)에서 수동 다운로드 |

## 기여하기

기여를 환영합니다! 시작 방법:

1. 저장소 포크
2. 기능 브랜치 생성 (`git checkout -b feat/my-feature`)
3. 커밋 전 체크 실행:
   ```bash
   pnpm tsc --build .        # TypeScript
   pnpm vitest run            # 테스트
   pnpm lint                  # 린트
   ```
4. 변경 사항 커밋 (`git commit -m 'feat: add my feature'`)
5. 브랜치에 푸시 (`git push origin feat/my-feature`)
6. Pull Request 생성

전체 사용 가능한 명령어 목록은 [개발 명령어](CLAUDE.md#development-commands)를 참조하세요.

## 라이선스

[MIT](LICENSE) — 개인 및 상업적 사용 모두 무료.

---

<div align="center">

이 프로젝트가 도움이 되었다면 스타를 고려해주세요!

[![Star History Chart](https://api.star-history.com/svg?repos=jhlee0409/claude-code-history-viewer&type=Date)](https://star-history.com/#jhlee0409/claude-code-history-viewer&Date)

</div>
