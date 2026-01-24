# Claude Code History Viewer

`~/.claude`에 저장된 Claude Code 대화 기록을 탐색하는 데스크톱 앱.

🌐 [웹사이트](https://jhlee0409.github.io/claude-code-history-viewer/) | 📦 [다운로드](https://github.com/jhlee0409/claude-code-history-viewer/releases)

![Version](https://img.shields.io/badge/Version-1.1.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> 

## 스크린샷

<p align="center">
  <img width="49%" alt="대화 기록" src="https://github.com/user-attachments/assets/9a18304d-3f08-4563-a0e6-dd6e6dfd227e" />
  <img width="49%" alt="분석 대시보드" src="https://github.com/user-attachments/assets/0f869344-4a7c-4f1f-9de3-701af10fc255" />
</p>
<p align="center">
  <img width="49%" alt="토큰 통계" src="https://github.com/user-attachments/assets/d30f3709-1afb-4f76-8f06-1033a3cb7f4a" />
  <img width="49%" alt="최근 편집" src="https://github.com/user-attachments/assets/8c9fbff3-55dd-4cfc-a135-ddeb719f3057" />
</p>

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

## 사용법

1. 앱 실행
2. `~/.claude` 폴더에서 대화 데이터 자동 스캔
3. 좌측 사이드바에서 프로젝트 탐색
4. 세션 클릭하여 메시지 확인
5. 탭으로 메시지, 통계, 토큰 분석, 최근 편집 전환

## 데이터 프라이버시

로컬에서만 실행. 대화 데이터는 서버로 전송되지 않습니다.

익명 사용 통계(앱 실행, 기능 사용)는 앱 개선을 위해 [Aptabase](https://aptabase.com/)를 통해 수집됩니다. 대화 내용이나 개인정보는 추적되지 않습니다.

## 문제 해결

**"Claude 데이터를 찾을 수 없음"**: `~/.claude` 폴더와 대화 기록이 있는지 확인.

**성능 문제**: 대용량 대화 기록은 초기 로딩이 느릴 수 있음. 가상 스크롤링으로 처리.

**업데이트 오류**: 자동 업데이트 실패 시 [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases)에서 수동 다운로드.

## 기술 스택

- **백엔드**: Rust + Tauri v2
- **프론트엔드**: React 19, TypeScript, Tailwind CSS, Zustand
- **빌드**: Vite, just

## 라이선스

MIT License - [LICENSE](LICENSE) 참조.

---

[이슈 등록](https://github.com/jhlee0409/claude-code-history-viewer/issues)으로 질문이나 버그 리포트.
