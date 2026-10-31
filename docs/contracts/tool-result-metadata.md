# Tool-result metadata (TR0 prerequisite)

`load_provider_messages` and `load_provider_messages_paginated` expose the same
additive contract through Tauri IPC and HTTP. This is preservation, **not** a
status/lifecycle/verdict calculation. Existing tool-result rendering, message
ordering and pagination conventions are unchanged.

## Unambiguous source

For a Claude user record containing exactly one `tool_result`, its raw
message-level `toolUseResult` is copied to that exact result block, before the
block is merged into an assistant or retained as a standalone/page-boundary
orphan. The optional field contains arbitrary JSON (`unknown` in TypeScript),
not a selectively normalized structure:

```json
{
  "type": "tool_result",
  "tool_use_id": "call_1",
  "content": "original output\n",
  "is_error": false,
  "toolUseResult": {"stdout": "", "stderr": "warning\n", "exitCode": 0, "interrupted": false},
  "toolUseResultSource": {
    "messageUuid": "source-user-record",
    "sessionId": "source-session",
    "contentIndex": 0,
    "association": "single_result"
  }
}
```

`content`, `is_error`, IDs and unknown block/payload fields are not normalized.
ANSI escapes, whitespace and LF characters inside JSON strings remain exact.
Present `null`, `false`, `0`, `""` and absent metadata are distinct. Missing source
metadata adds no fields. Neither stderr nor output prose creates an exit code:
the E15 `{stdout:"", stderr:"fatal: not a git repository (or any of the parent
directories): .git", interrupted:false}` remains without an exit code. Conflicting
recorded signals such as `is_error:false` and `exitCode:2` both survive.

## Ambiguous source

A user record with several result blocks provides no trustworthy per-result
mapping for its enclosing `toolUseResult`. The raw payload is retained **once**,
in the first result block's provenance envelope:

```json
{
  "toolUseResultSource": {
    "messageUuid": "multi-result-record",
    "sessionId": "source-session",
    "contentIndex": 1,
    "association": "unassigned",
    "resultContentIndices": [1, 2],
    "unassignedToolUseResult": {"stdout": "not attributable to either result"}
  }
}
```

This payload is source-message evidence, **not evidence for the block carrying
the envelope or any of its calls**. Do not use it to decide individual outcomes.
No positional/keyed/provider-specific mapping is invented, even if IDs happen
to resemble keys inside the payload. The same unassigned form preserves an
outer payload when a single result already has an inline `toolUseResult`; that
inline field is never overwritten. The provenance property is reserved for this
API; pre-existing source-block properties are retained unchanged.

## Provenance and compatibility

`messageUuid`, `sessionId` and `contentIndex` identify the **source result
record**, not a verified tool-call origin. Result-to-assistant placement follows
the existing legacy ID lookup. Duplicate call IDs, compaction/replay and mixed
sessions can make that placement ambiguous; never equate placement with call
identity. Metadata is taken only from the enclosing source record and is never
looked up from another message/session or cached by tool ID.

Claude pagination still slices in pre-merge index space and merges only within
the returned window. An orphan receives its own metadata without loading an
older page. Other providers still materialize, merge and slice in post-merge
space.

## Codex structured output (TRbe bounded slice)

For Codex `function_call_output` and `custom_tool_call_output`, when `output`
is a JSON string decoding to an object with its own `output` property, the
**entire decoded wrapper** is preserved as the result block's `toolUseResult`.
The legacy normalized `content` remains that inner `output`, including null or
empty output. Wrapper fields such as `metadata.exit_code` and interruption
signals, unknown fields and all JSON value distinctions are retained without
renaming or deriving a verdict. This is decoded JSON preservation, not a copy
of the wrapper's original JSON encoding/whitespace.

`toolUseResultSource` uses the source output item's ID (or the existing
`codex-N` fallback UUID), current rollout session ID and `contentIndex: 0` — the
single normalized result's position **before either merge**, not a byte offset,
raw JSONL line number, or its final assistant content position. The payload is
attached before Codex's provider-local merge; duplicate call IDs, replay and
out-of-order results never replace another result's metadata. Existing legacy
call placement is unchanged and is not proof of a unique originating call.

Plain output strings, JSON strings without an `output` property, and
already-object output retain their previous content representation and do not
gain `toolUseResult`/`toolUseResultSource`. Already-object metadata is already
present in `content`; it is not duplicated into that envelope. The additive
plain-header contract below preserves evidence independently.
No missing exit code or interruption flag is synthesized. Open Interpreter
shares this parser and receives the same preservation, retaining its own
provider tag and history-root guard. Codex/Open Interpreter search matches the
legacy display fields only, excluding these additive envelopes from matching
while retaining them on returned results. This avoids new hidden-metadata
search hits. The Codex slice alone is not proof for other provider pathways.

Old responses without these optional properties remain valid. Consumers must
handle absent/unassigned/unknown data without inventing success, failure,
interruption or process status. The API adapter passes the entire JSON through
in both transports. This prerequisite does not implement TR0 UI, outcome
normalization, grouping eligibility, raw-history access, or new permissions.

## OpenHands / OpenCode-Kilo / Pi-OMP continuation

- **OpenHands classic** observation `extras` becomes that observation result's
  `toolUseResult`; missing extras adds neither field. Provenance identifies the
  observation UUID/session and its sole normalized result (`contentIndex:0`).
- **OpenCode / Kilo core** emitted tool results retain the exact part `state`
  in `toolUseResult`. Provenance identifies the owning message/session,
  normalized pre-merge result `contentIndex`, and ordered decoded `partIndex`.
  No exit-code field or result for running/missing/null state is invented.
- **Pi / OMP** `toolResult` retains its complete raw nested `message` (including
  optional opaque `details`) in `toolUseResult`. Provenance is source entry
  ID/session, `contentIndex:0`, `association:"single_result"`.

Pi/OMP `bashExecution` is a distinct local execution, not an assistant tool
result. Its existing string `content`, system type and `bash_execution` subtype
remain unchanged. Only that source message receives this optional **message**
property (absent on all other messages):

```json
{
  "sourceExecution": {
    "messageUuid": "source-entry-id",
    "sessionId": "source-session",
    "association": "local_execution",
    "message": {
      "role": "bashExecution",
      "command": "true",
      "output": "",
      "exitCode": 0,
      "cancelled": false,
      "truncated": false,
      "timestamp": 1759276800000
    }
  }
}
```

The nested message is the recorded JSON, not a reconstructed schema. Missing,
explicit null, false, zero and unknown properties stay distinct. It is never
broadcast to an assistant call or session siblings. No `toolUseResult` is
fabricated for a local execution. Legacy responses without `sourceExecution`
remain valid. No frontend type/adapter/UI change is included.

See [provider scope and verification boundaries](provider-result-evidence-scope.md)
for store coverage, source index semantics, full-response baselines and remaining
unverified pathways. This remains partial TRbe, not all-provider certification.

## Codex producer preservation ②a

All existing content, flags, IDs, message order and pagination are unchanged.
Only the following optional locations are added; stripping **only** these
locations reproduces complete develop responses (`5e65489a`).

- A result's `codexOutput` holds `{raw, sourceMessageUuid, exitCode?}` when the
  legacy normalizer removed a plain `\nOutput:\n` wrapper. `raw` is the exact
  original string, including whitespace and header. `exitCode` is present only
  for an integer in the producer header with its wall-time line; stdout after
  the first delimiter is never inspected. Unknown/malformed headers stay raw
  without a code. Zero and negative integers survive. This does not read the
  producer's internal, unserialized `success` flag. `toolOutcome` consumes the
  delivered code for Codex/Open Interpreter; no code is inferred in the UI.
- A message's `codexEvidence.turn` contains the recorded `started` event and/or
  `context` payload. A new start clears stale context; a different, null or
  absent context turn ID does not inherit the preceding start. Complete/abort
  events close the active turn. No turn ID is generated, no prior/next turn is
  retroactively assigned. A merged result keeps its **own** turn in that result
  block's `codexEvidence`, independent of the legacy call-ID placement.
- `codexEvidence.contentItems` is an ordered array of `{type?:unknown}` for
  **every** original message content item, before the legacy converter drops
  or renames anything. Its length is the source cardinality. `{}` and
  `{type:null}` differ. `contentItemKinds`, if present, copies the source
  `internal_chat_message_metadata_passthrough.content_item_kinds` value exactly,
  including null/false/zero/empty values.
  Existing responses without these fields still need a legacy fallback.
- `codexEvidence.fileChanges` contains `{sourceLine,record}` entries for
  `item_completed` FileChange and `patch_apply_begin/updated/end`. The complete
  decoded source event survives, including update `unified_diff`, null/absent `move_path`,
  add/delete `content`, statuses, IDs, unknown fields and timestamp. sourceLine
  is the zero-based non-empty JSONL line slot used by `find_line_ranges`
  (blank empty lines are excluded; invalid non-empty lines retain their slot). The nearest preceding normalized
  message is a **transport carrier, not a tool-call association**; a leading
  event waits for the first normalized message. No matching by equal text or
  tool ID is invented. A rollout with no legacy normalized messages has no
  carrier and still returns the legacy empty response; supporting event-only
  rollouts requires a separate session-level envelope contract.

C6 keeps output arrays unchanged in Rust. The existing result renderer and
`resultContent` adapter interpret `input_text` as text and `input_image` as an
image in recorded order. HTTP(S) and allowlisted image data URLs use the existing
image renderer; file references/unsupported schemes and unknown items remain
recorded JSON. No file lookup, arbitrary URL execution or raw-record rewrite is
introduced. Both paired and orphan result routes share this renderer.

FileChange data is delivered for DiffView consumption; this PR does not add a
new diff panel or fabricate an apply_patch tool call for code-mode exec. Turn
identity and original item kinds are available, but grouping and heartbeat
classification consumption are follow-up **②a2**, not delivered UI behavior.
The owner chose separate automated goal-continuation turns; existing grouping
remains unchanged until that wiring lands. Search still matches legacy display
fields only, not hidden evidence, in both shared rollout providers.

### Pinned producer evidence

| Interpretation | Source | Regression |
|---|---|---|
| Plain exit header, not stdout | [788b9d7 tools/mod.rs:91–116](https://github.com/openai/codex/blob/788b9d7bf6e37f735647b7f84b556c2a807df4d8/codex-rs/core/src/tools/mod.rs#L91-L116), [context.rs:548–567](https://github.com/openai/codex/blob/788b9d7bf6e37f735647b7f84b556c2a807df4d8/codex-rs/core/src/tools/context.rs#L548-L567); current 0.164 [context.rs:524–574](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/tools/context.rs#L524-L574) | `codex_plain_exit_header_preserves_source_evidence`, `codexEvidence.test.tsx` |
| Text/image output items; success not serialized | [models.rs:2245–2262,2340–2355](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/models.rs#L2245-L2262) | public fixture identity + renderer route |
| Original message content type and nested host kinds | [models.rs:881–935](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/models.rs#L881-L935), [993–1013](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/models.rs#L993-L1013), [1062–1082](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/models.rs#L1062-L1082) | `codex_preservation_content_item_types` |
| FileChange update/add/delete | [protocol.rs:3838–3878,4342–4355](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/protocol.rs#L4342-L4355), [items.rs:418–429](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/items.rs#L418-L429) | `codex_preservation_file_changes` |
| Rollout turn start/context and item completion | [protocol.rs:1517–1520,2063–2075,2302–2323,3428–3433](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/protocol.rs#L3428-L3433) | `codex_preservation_turn_identity`, public + loopback HTTP |

A read-only **executed Rust parser** rescan of 138 local rollouts delivered
54/54 plain exit codes (5 nonzero), 204/204 FileChange events and 2,182 message
kind envelopes, with zero user messages missing their kind envelope. Only
structural counts were retained. A separate raw recount found 2,137 exec outputs,
2,134 array outputs and 179 images in those exec arrays. The earlier audit's
55 headers / 1,898 array outputs / 58 images are not silently reused as current
counts; the exact reason for that difference is unconfirmed.
