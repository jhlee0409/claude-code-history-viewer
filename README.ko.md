# Claude Code History Viewer

`~/.claude`에 저장된 Claude Code 대화 기록을 탐색하는 데스크톱 앱.

![Version](https://img.shields.io/badge/Version-1.0.0--beta.4-orange.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> ⚠️ **Beta** - 불안정하거나 변경될 수 있음

## 스크린샷

<p align="center">
  <img width="49%" alt="Main Interface 1" src="https://github.com/user-attachments/assets/45719832-324c-40c3-8dfe-5c70ddffc0a9" />
  <img width="49%" alt="Main Interface 2" src="https://github.com/user-attachments/assets/bb9fbc9d-9d78-4a95-a2ab-a1b1b763f515" />
</p>

<img width="720" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/77dc026c-8901-47d1-a8ca-e5235b97e945" />

## 기능

- **대화 탐색**: 프로젝트/세션별 대화 기록 탐색
- **검색**: 전체 대화에서 메시지 검색
- **통계**: 토큰 사용량 분석 및 API 비용 계산
- **다국어**: 영어, 한국어, 일본어, 중국어
- **최근 편집**: 파일 수정 내역 확인 및 복원
- **기타**: 자동 업데이트, 폴더 변경, 피드백

## 설치

[Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)에서 플랫폼에 맞는 설치 파일 다운로드.

## 소스에서 빌드

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
pnpm install
pnpm tauri:build
```

**요구사항**: Node.js 18+, pnpm, Rust toolchain

## 데이터 프라이버시

로컬에서만 실행. 서버로 데이터 전송 없음.

## 라이선스

MIT
