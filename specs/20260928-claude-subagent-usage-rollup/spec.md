# Spec: claude-subagent-usage-rollup

- Status: Implemented (PR pending)
- Created: 2026-09-28
- Issue: #577 (Stage 1, Claude part). Design: https://github.com/jhlee0409/claude-code-history-viewer/issues/577#issuecomment-5857353699

## Problem / goal
Original ask (maintainer, 2026-09-28): "577 509 구체화 한번 해보자" → "UIUX 고려해서 한번더 검토" → "진행" → "추천순으로 진행" (recommended order: #591 merge → #577 Stage 1 our part (Claude, Z Code) → release).

#577: a session's token/cost stats omit the subagent runs it spawned, so the true cost of one originating session is understated. Decided policy (`docs/specs/token-stats-consistency-plan.md`): subagent usage is sidechain usage — counted under `billing_total`, excluded under `conversation_only`.

For Claude Code, subagent transcripts live in `<project>/<sessionId>/subagents/agent-*.jsonl` (and `subagents/workflows/<run>/agent-*.jsonl`), with `isSidechain: true` and the parent's `sessionId`. Today:
- `get_session_token_stats` reads only `<sessionId>.jsonl` → subagents missing from the session.
- `get_project_token_stats` / `get_session_comparison` walk the project recursively and list each subagent file as its own "session" item.
- Project / global totals already include them (recursive walk).

## What "done" looks like
In `billing_total`, a Claude session's stats = its own file + all its subagent files; in `conversation_only`, its own file only. Per-session lists (project token stats, session comparison) no longer show subagent files as separate items — their usage lives in the parent item — so Σ(session items) == project total in both modes. Project/global totals are numerically unchanged.

## Scope
- **In:** Claude session token stats roll-up; project token stats + session comparison item lists; a merge-able intermediate for session token stats shared by the cached (`compose_session_token`) and full-scan (`scan_session_token_stats`) paths.
- **Out:** `subagent_stats` field / "of which subagents" UI line (owned by #578); OpenCode/Kilo (#578); Z Code (#593); Stage 2 session-list grouping; `message_count` semantics beyond the note below.

## Acceptance
1. Fixture project with a parent session + 2 subagent files (one flat, one under `workflows/`): `get_session_token_stats` billing == parent + both subagents; conversation_only == parent only (unchanged from today).
2. Same fixture: Σ `get_project_token_stats` items == `get_project_stats_summary` total, in both modes; the subagent files are not items of their own.
3. Date filter: a subagent run entirely outside the range contributes nothing.
4. Cache equivalence tests (composed == scanned) still pass for the shared intermediate.
5. Real data: on this machine's `~/.claude/projects/-Users-jack-client-claude-code-history-viewer/<session>/subagents/`, WebUI `get_session_token_stats` (both modes) and `get_project_token_stats` match an independent Python sum (max-per-`message.id` usage, as in #575).
6. Full gate: `cargo test -- --test-threads=1`, clippy `-D warnings`, fmt.

## Risks / open questions
- **message_count:** subagent rows count toward the parent's `message_count` under `billing_total`, same as inline sidechain rows already do. State it in the PR.
- **Orphan subagent files** (parent `<id>.jsonl` gone, e.g. Claude Code cleanup): keep them as their own item so Σ session still equals the project total.
- **Conflict surface with #578:** keep the `get_session_token_stats` hunk to one call; don't touch `models/stats.rs`.
- Visible side effect: the Token Stats per-session list loses subagent-file rows — call out in PR/release notes.
