# Issue #77: Codex / OpenCode Support

## Worktree
- **Path**: `../claude-code-history-viewer-77`
- **Branch**: `feature/codex-opencode-support`
- **Base**: `main` (ad120dc)

## Issue
https://github.com/jhlee0409/claude-code-history-viewer/issues/77

## Research Summary

### OpenAI Codex CLI
- **Storage**: `~/.codex/sessions/YYYY/MM/DD/rollout-{ts}-{SESSION_ID}.jsonl`
- **Format**: JSONL (Claude와 유사)
- **Structure**: `{ timestamp, type, payload }` per line
  - `event_msg` (user_message, token_count)
  - `response_item` (assistant)
  - `session_start`, `session_meta`
- **Config**: `~/.codex/config.toml`
- **Difficulty**: 중 (JSONL 포맷 재사용 가능)

### OpenCode (opencode-ai/opencode)
- **Storage**: `~/.local/share/opencode/storage/`
- **Format**: 개별 JSON 파일 (분산 구조)
  - `session/{hash}/ses_{id}.json`
  - `message/ses_{id}/msg_{id}.json`
  - `part/msg_{id}/prt_{id}.json`
  - `tool-output/tool_{id}`
- **Config**: `~/.opencode.json`
- **Difficulty**: 상 (분산 JSON, 다수 파일 I/O)

## Implementation Notes
- Codex CLI 먼저 구현 권장 (JSONL 포맷 유사)
- 백엔드: 도구별 파서 모듈 분리 (`claude/`, `codex/`, `opencode/`)
- 통합 메시지 모델: 어댑터 패턴으로 공통 구조 변환
- 프론트엔드: 프로젝트 트리에서 도구별 아이콘/라벨 구분
