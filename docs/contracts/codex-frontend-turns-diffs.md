# Codex frontend cycles and FileChange (②a2)

This slice consumes the additive ②a transport. It does not change Rust, raw
records, pagination, provider flags, or search indexing. Failed/declined
FileChange evidence now reaches the existing outcome adapter (D-R4 precedence).

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
  attribution: a matching producer cycle with its `task_started` progress row
  loaded, contextual user input, and no classified human input is a **no-input
  context-cycle structural fallback**, not proof of a goal trigger. Of the 278
  reviewed local cycles, 21 (76 tools) have no goal context. A context tag without
  the loaded start marker never activates this fallback; copied `started` evidence
  on a later message does not prove a loaded start. Partial windows (including a
  human turn tail with later injected context) stay unknown; a producer-ID change still
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

## Round-1 provenance and status decisions

- Heartbeat recognition deliberately keeps the reader's host-kind requirement:
  [`heartbeat.rs:31–46,62–72`](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/history/src/heartbeat.rs#L31-L72)
  classifies an unmarked envelope as `User`, not `Heartbeat`. The 14 unmarked
  local envelopes therefore remain human under the owner's conditional decision.
  In the review inventory this was 192 → 206 numbered prompts; the final 179-file
  recount is 209 → 223 (+14), with no lost develop human prompts.
- Host marking is written by
  [`session/mod.rs:5354–5365`](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/session/mod.rs#L5354-L5365),
  from per-input origin (not the active turn's trigger):
  [`session/turn_input.rs:346`](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/session/turn_input.rs#L346).
  The reader/writer change was introduced by
  [`e7f11981`](https://github.com/openai/codex/commit/e7f119819ab29ba99a377a436453d0fef83f8a5d).
  Both tagged 0.161.0 (`979011409de0a60b52f179721948e65531d26144`) and
  0.164.0 (the main pin) contain the reader; the 0.148.0-alpha.9 tag
  (`9392c3fa5bcda342b5b96a1a04d67b2f781617c2`) has no heartbeat reader module
  or host-marking branch in `session/mod.rs`. All 34 local envelopes declare
  0.148.0-alpha.9, including the 20 host-marked ones: a recorded version string
  is not proof that the corresponding upstream tag emitted all their metadata.
  The external scheduler emitter is not present in this source checkout.
- `automation_heartbeat_scheduled` is a per-submission origin at
  [`heartbeat.rs:23–29`](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/history/src/heartbeat.rs#L23-L29),
  not permission to relabel every steered input in that turn. A missing-host-kind
  message therefore stays human even if the active turn has that trigger.
- FileChange status is a closed snake-case enum
  [`protocol.rs:3881–3887`](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/protocol.rs#L3881-L3887).
  [`tools/events.rs:298–347`](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/tools/events.rs#L298-L347)
  preserves intended changes on failure/decline. Both standalone and paired Result
  sections show their localized status. Only an exactly associated event supplies
  explicit failure to `toolOutcome`; completed never manufactures success.
  Existing D-R4 interruption-first and exit/error conflict rules are preserved.
  Legacy `patch_apply_end.success` supplies completed/failed; absence stays unknown.
- The store's normal system-message filter hides progress. It now carries the
  actual loaded Codex start row on only the first retained row (`codexLoadedStart`,
  frontend-only view metadata, never provider evidence). This preserves the marker
  for model/outline/user-only export without rendering it; cropping past the carrier
  or reloading a partial window loses the marker. Start validation requires the
  backend `waiting_for_task` / `started` / matching task ID, so a task-complete
  progress row with copied `turn.started` cannot impersonate the start.
- Real projection also exposed date-divider splits and a second heartbeat outline
  boundary inside an already automated cycle. Date separators remain physical
  chunks of one logical model turn; the outline shares one automated boundary
  per known producer cycle. No canonical human ordinals are invented.

### Remaining non-blocking limits

Literal allowlisted wrapper text remains indistinguishable from injected context
when a complete producer start is loaded; the bounded fix only preserves unknown
partial/no-start cases. Producer-ID transitions can still form unknown prelude
outline groups (conservative, no prompt loss). The pure model is not yet wired to
the app virtualizer. Existing 390px floating-control overlap is unchanged and is
not certified away by these captures. Local FileChange records are completed-only;
failed/declined and matched-call routes are producer-shaped synthetic evidence.

## Verification receipts

The delivery report and comparison page carry executed gate counts, the real
backend structural recount, source-build checksum, and exact-RGBA comparisons.
Synthetic fixture shapes are regression controls, not extra producer evidence.
