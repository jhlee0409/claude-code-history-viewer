# Codex frontend cycles and FileChange (②a2)

This slice consumes the additive ②a transport. It does not change Rust, raw
records, pagination, provider flags, search indexing, or outcome verdicts.

## Ground truth

All Codex links below pin `6aaac694803004a63c6f393d153c96d22521a6b9`.

| Interpretation | Producer source | Regression |
|---|---|---|
| An idle goal continuation starts a fresh turn from a ResponseItem, with `turn_trigger: "goal"` | [ext/goal/src/runtime.rs:480–502](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/ext/goal/src/runtime.rs#L480-L502); [protocol/src/turn_input.rs:79–96](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/turn_input.rs#L79-L96) | `codexTurns.test.ts` |
| Turn IDs identify cycles; root IDs identify lineage, not a new cycle. Started attribution is optional for older histories | [protocol.rs:2303–2323](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/protocol.rs#L2303-L2323), [3428–3433](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/protocol.rs#L3428-L3433) | same; absent/null/mismatched identity and assistant-only partial controls |
| FileChange update has unified_diff and optional move_path; add/delete carry content | [protocol.rs:4342–4355](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/protocol.rs#L4342-L4355) | `codexFileChanges.test.tsx` |
| FileChangeItem.id is the producer call ID, not the nearest normalized carrier's ID | [tools/events.rs:601–620](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/tools/events.rs#L601-L620); [items.rs:418–429](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/items.rs#L418-L429) | same, plus targeted raw JSONL → HTTP → WebKit evidence |
| Heartbeat requires a single source InputText and exactly the host kind user.heartbeat; text envelope grammar and byte budget also apply | [history/src/heartbeat.rs:31–110](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/history/src/heartbeat.rs#L31-L110) | `heartbeatBoundary.test.ts`, including dropped source siblings |

## Boundaries and compatibility

- The owner chose separate **automated** goal-continuation cycles. The loaded
  sequence projection is shared by the pure transcript model and legacy outline.
  It correlates exact `sessionId` + `turn_id`, validates started/context identity,
  and never uses `root_turn_id` as a boundary or generates prompt ordinals.
- New records can identify goal provenance explicitly. Older records lack
  attribution: a matching producer cycle containing contextual user input and
  no classified human input is a **structural fallback**, not proof of a goal
  trigger. A context tag without identity never starts an automated cycle.
  Assistant-only partial windows remain unknown; a producer-ID change still
  separates their tools from the preceding human turn.
- Automated cycles own their activity/tools, reuse the existing five-locale
  automated header, do not contribute to human numbering, and are excluded from
  the human-only display/export filter. All-messages retains source records.
- Canonical index membership remains authoritative. Missing canonical starts
  are unknown/partial, not invented numbered prompts. The pure model is still
  not the application's virtualizer (the existing TR3 integration boundary).
- With delivered `contentItems`, both exact cardinality/type and host kinds are
  required for heartbeat recognition. A malformed/present kind or a dropped
  original audio/image/unknown sibling cannot be ignored. Only **old responses
  without original evidence** retain the documented grammar-only fallback.
- FileChange matching is exact and conservative: one loaded call with the ID,
  and a matching delivered turn when the event has one. Duplicate/mismatched/
  absent calls remain separate producer events at their carrier. Code-mode
  inner patch IDs are not outer exec IDs; no fake apply_patch call is created.
- On matching Default-path tool rows, producer FileChange is the diff view;
  apply_patch input remains the complete searchable raw Input zone. Unmatched
  FileChange events get an explicitly producer-named FileChange section, not a
  proximity-based tool association. The raw transport envelope is unchanged.
- Unified hunk coordinates are used only when recorded and count-valid; malformed
  hunks stay raw. apply_patch anchors and add/delete contents have blank gutters.
  No hunk slice is advertised as an entire after-file.

## Verification receipts

The delivery report and comparison page carry executed gate counts, the real
backend structural recount, source-build checksum, and exact-RGBA comparisons.
Synthetic fixture shapes are regression controls, not extra producer evidence.
