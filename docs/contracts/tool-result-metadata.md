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

Plain output strings (including `Process exited ...` prose), JSON strings
without an `output` property, and already-object output retain their previous
content representation and do not gain these fields. Already-object metadata
is already present in `content`; it is not duplicated into a new envelope.
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
