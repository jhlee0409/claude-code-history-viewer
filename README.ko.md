<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**AI 코딩 어시스턴트를 위한 통합 히스토리 뷰어.**

**Claude Code**, **Codex CLI**, **OpenCode**의 대화 기록을 탐색, 검색, 분석하세요 — 데스크톱 앱 또는 헤드리스 서버로. 100% 오프라인.

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
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

## 빠른 시작

**데스크톱 앱** — 다운로드하고 실행:

| 플랫폼 | 다운로드 |
|----------|----------|
| macOS (Universal) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

**Homebrew** (macOS):

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

**헤드리스 서버** — 브라우저에서 접근:

```bash
brew install jhlee0409/tap/cchv-server   # 또는: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

Docker, VPS, systemd 설정은 [서버 모드](#서버-모드-webui)를 참고하세요.

---

## 왜 만들었나

AI 코딩 어시스턴트는 수천 개의 대화 메시지를 생성하지만, 도구 간에 히스토리를 돌아볼 방법을 제공하지 않습니다. CCHV가 이를 해결합니다.

**세 가지 어시스턴트. 하나의 뷰어.** Claude Code, Codex CLI, OpenCode 세션을 자유롭게 전환하고 — 토큰 사용량을 비교하고, 프로바이더 간 검색하고, 워크플로를 하나의 인터페이스에서 분석하세요.

| 프로바이더 | 데이터 위치 | 제공 내용 |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | 전체 대화 기록, 도구 사용, 사고 과정, 비용 |
| **Codex CLI** | `~/.codex/sessions/` | 에이전트 응답이 포함된 세션 롤아웃 |
| **OpenCode** | `~/.local/share/opencode/` | 대화 세션 및 도구 결과 |

벤더 종속 없음. 클라우드 의존 없음. 로컬 대화 파일을 아름답게 렌더링합니다.

## 목차

- [주요 기능](#주요-기능)
- [설치](#설치)
- [소스에서 빌드](#소스에서-빌드)
- [서버 모드 (WebUI)](#서버-모드-webui)
- [사용법](#사용법)
- [접근성](#접근성)
- [기술 스택](#기술-스택)
- [데이터 프라이버시](#데이터-프라이버시)
- [문제 해결](#문제-해결)
- [기여하기](#기여하기)
- [라이선스](#라이선스)

## 주요 기능

### 핵심

| 기능 | 설명 |
|---------|-------------|
| **멀티 프로바이더** | **Claude Code**, **Codex CLI**, **OpenCode** 대화를 통합 뷰어로 탐색 — 프로바이더별 필터링, 도구 간 비교 |
| **대화 브라우저** | 프로젝트/세션별 대화 탐색 (워크트리 그룹핑 지원) |
| **글로벌 검색** | 모든 프로바이더의 대화에서 즉시 검색 |
| **분석 대시보드** | 듀얼 모드 토큰 통계 (빌링 vs 대화), 비용 브레이크다운, 프로바이더 분포 차트 |
| **세션 보드** | 멀티 세션 시각 분석 (픽셀 뷰, 속성 브러싱, 액티비티 타임라인) |
| **설정 관리자** | 스코프 기반 Claude Code 설정 편집기 (MCP 서버 관리 포함) |
| **메시지 네비게이터** | 우측 접이식 TOC로 긴 대화 빠르게 탐색 |
| **실시간 모니터링** | 세션 파일 변경 실시간 감지 및 즉시 업데이트 |

### v1.6.0 신규

| 기능 | 설명 |
|---------|-------------|
| **WebUI 서버 모드** | `--serve`로 헤드리스 웹 서버 실행 — 브라우저에서 접근, VPS/Docker 배포 |
| **스크린샷 캡처** | 범위 선택, 미리보기 모달, 다중 선택 내보내기가 포함된 긴 스크린샷 |
| **아카이브 관리** | 세션 아카이브 생성, 탐색, 이름 변경, 내보내기 (파일별 다운로드) |
| **접근성** | 완전한 키보드 내비게이션, 스크린 리더 지원, 폰트 스케일링, 고대비 모드 |
| **모바일 UI** | 390px 뷰포트 지원, 하단 탭 바 |
| **외부 링크** | 모든 링크가 WebView 대신 시스템 브라우저에서 열림 |

### 기타

| 기능 | 설명 |
|---------|-------------|
| **세션 컨텍스트 메뉴** | 세션 ID 복사, 재개 명령 복사, 파일 경로 복사; 네이티브 이름 변경 및 검색 연동 |
| **ANSI 색상 렌더링** | 터미널 출력을 원본 ANSI 색상으로 표시 |
| **다국어 지원** | 영어, 한국어, 일본어, 중국어 (간체 및 번체) |
| **최근 편집** | 파일 수정 내역 확인 및 복원 |
| **자동 업데이트** | 내장 업데이터 (건너뛰기/연기 옵션 포함) |

## 설치

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

또는 전체 Cask 경로로 바로 설치:

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

`No Cask with this name exists` 오류가 나오면 위의 전체 경로 명령을 사용하세요.

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

## 서버 모드 (WebUI)

데스크톱 환경 없이 헤드리스 HTTP 서버로 실행 — VPS, 원격 서버, Docker에 적합합니다. 서버 바이너리가 프론트엔드를 포함하고 있어 **파일 하나면 충분합니다**.

> **서버 배포가 처음이신가요?** 로컬 테스트, VPS 설정, Docker 등을 단계별로 안내하는 [서버 모드 가이드](docs/server-guide.md) ([한국어](docs/server-guide.ko.md))를 참고하세요.

### 빠른 설치

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# 또는 원라인 스크립트
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

### 서버 시작

```bash
cchv-server --serve
```

출력:

```
🔑 Auth token: b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
   Open in browser: http://192.168.1.10:3727?token=b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
👁 File watcher active: /home/user/.claude/projects
🚀 WebUI server running at http://0.0.0.0:3727
```

브라우저에서 URL을 열면 토큰이 자동으로 저장됩니다.

### 사전 빌드 바이너리

| 플랫폼 | 에셋 |
|----------|-------|
| Linux x64 | `cchv-server-linux-x64.tar.gz` |
| Linux ARM64 | `cchv-server-linux-arm64.tar.gz` |
| macOS ARM | `cchv-server-macos-arm64.tar.gz` |
| macOS x64 | `cchv-server-macos-x64.tar.gz` |

[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)에서 다운로드하세요.

**CLI 옵션:**

| 플래그 | 기본값 | 설명 |
|------|---------|-------------|
| `--serve` | — | **필수.** 데스크톱 앱 대신 HTTP 서버 시작 |
| `--port <number>` | `3727` | 서버 포트 |
| `--host <address>` | `0.0.0.0` | 바인드 주소 (로컬 전용: `127.0.0.1`) |
| `--token <value>` | 자동 (uuid v4) | 커스텀 인증 토큰 |
| `--no-auth` | — | 인증 비활성화 (공개 네트워크에서 비권장) |
| `--dist <path>` | 내장 | 내장 프론트엔드 대신 외부 `dist/` 디렉토리 사용 |

### 인증

모든 `/api/*` 엔드포인트는 Bearer 토큰 인증으로 보호됩니다. 토큰은 서버 시작 시 자동 생성되며 stderr에 출력됩니다.

- **브라우저 접근**: 시작 시 출력된 `?token=...` URL 사용. 토큰은 `localStorage`에 자동 저장.
- **API 접근**: `Authorization: Bearer <token>` 헤더 포함.
- **커스텀 토큰**: `--token my-secret-token`으로 직접 설정.
- **비활성화**: `--no-auth`로 인증 건너뛰기 (신뢰할 수 있는 네트워크에서만).

### 실시간 업데이트

서버는 `~/.claude/projects/`의 파일 변경을 감지하고 SSE(Server-Sent Events)를 통해 브라우저에 업데이트를 전송합니다. 다른 터미널에서 Claude Code를 사용하면 뷰어가 자동으로 업데이트됩니다 — 수동 새로고침 불필요.

### Docker

```bash
docker compose up -d
```

시작 후 토큰 확인:

```bash
docker compose logs webui
# 🔑 Auth token: ... ← 이 URL을 브라우저에 붙여넣기
```

`docker-compose.yml`은 `~/.claude`, `~/.codex`, `~/.local/share/opencode`를 읽기 전용 볼륨으로 마운트합니다.

### systemd 서비스

Linux에서 지속적인 서버 운영을 위해 제공된 systemd 템플릿을 사용하세요:

```bash
sudo cp contrib/cchv.service /etc/systemd/system/
sudo systemctl edit --full cchv.service   # User=를 사용자 이름으로 설정
sudo systemctl enable --now cchv.service
```

### 소스에서 빌드 (서버 전용)

```bash
just serve-build           # 프론트엔드 빌드 + 서버 바이너리에 임베드
just serve-build-run       # 빌드 후 실행 (임베디드 에셋)

# 또는 개발 모드로 실행 (외부 dist/):
just serve-dev             # 프론트엔드 빌드 + --dist로 서버 실행
```

### 헬스 체크

```
GET /health
→ { "status": "ok" }
```

## 사용법

1. 앱 실행
2. 지원하는 모든 프로바이더 (Claude Code, Codex CLI, OpenCode)에서 대화 데이터 자동 스캔
3. 좌측 사이드바에서 프로젝트 탐색 — 탭 바로 프로바이더별 필터링
4. 세션 클릭하여 메시지 확인
5. 탭으로 메시지, 분석, 토큰 통계, 최근 편집, 세션 보드 전환

## 접근성

키보드 전용, 저시력, 스크린 리더 사용자를 위한 접근성 기능을 제공합니다.

- 키보드 우선 내비게이션:
  - 프로젝트 탐색기, 메인 콘텐츠, 메시지 내비게이터, 설정으로 건너뛰기 링크
  - `ArrowUp/ArrowDown/Home/End`로 프로젝트 트리 탐색, 타자 검색, `*`로 형제 그룹 펼치기
  - `ArrowUp/ArrowDown/Home/End`와 `Enter`로 메시지 내비게이터 탐색 및 포커스된 메시지 열기
- 시각 접근성:
  - 글로벌 폰트 크기 조절 (`90%`, `100%`, `110%`, `120%`, `130%`)
  - 설정에서 고대비 모드 토글
- 스크린 리더 지원:
  - 랜드마크 및 트리/리스트 시맨틱 (`navigation`, `tree`, `treeitem`, `group`, `listbox`, `option`)
  - 상태/로딩 및 프로젝트 트리 탐색/선택 변경에 대한 라이브 알림
  - `aria-describedby`를 통한 인라인 키보드 도움말 설명

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
