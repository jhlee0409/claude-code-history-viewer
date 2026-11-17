# Context: claude-subagent-usage-rollup

## 0. Resume here
<!-- The live working-set state, so a fresh session (or a post-compaction self)
     can resume without re-narration. Write it with `/harness-kit:handoff` at a
     stopping point; a fresh session continues from it with `/harness-kit:pickup`. -->
<!-- resume:start -->
- **Original ask (verbatim):** "추천순으로 진행" — #577 Stage 1, Claude part (see spec.md).
- **Phase / N of M:** 5/6 done; 6 = open PR.
- **Files touched:** src-tauri/src/commands/stats.rs (SessionTokenAccum, extract_session_token_stats_sync roll-up, scan_session_token_accum, claude_session_heads, session_comparison_with_subagents, tests), src-tauri/src/commands/stats/cache.rs (compose_session_token_accum, merge helpers pub(super)).
- **Next command:** open PR against develop (Refs #577).
- **In-flight decisions:** `get_session_token_stats` untouched (roll-up lives in extract_session_token_stats_sync) to avoid conflicting with #578; no `subagent_stats` field; orphan subagent files stay items; subagent rows count toward message_count under billing_total.
<!-- resume:end -->

## Working notes
- CodeRabbit (PR #594): get_project_stats_summary still counted files as sessions → billing total_sessions 5 vs list 3. Fixed: session count / active dates / duration keyed by owning transcript (totals still from every file). Rechecked on coin-bot + omniverse-autopublisher: summary sessions & tokens == token list in both modes.
- Real-data check (2026-09-28): coin-bot session 4749bfb6 with 11 subagent files → WebUI session billing 111,307,462 == Python (main 73,608,323 + subagents 37,699,139); conversation 73,608,323; project total == Σ items in both modes; items 2 (was 13 with subagent files listed).
<!-- Grounding: the real files/data you examined, decisions made, dead ends hit.
     This is what keeps the work from drifting off the original ask. -->
