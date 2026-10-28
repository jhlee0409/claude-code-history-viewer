# Provider-family evidence scope (TRbe continuation)

This is a bounded preservation change, not provider-wide outcome support or a
status/verdict engine. Fixtures are isolated schema-shaped raw records, not a
capture of a user's complete installation. A reader accepting a value does not
prove that every upstream version emits it.

| Family/store | Source preserved | Deliberate boundary |
|---|---|---|
| OpenHands classic event directory | Observation `extras`, including explicit null/scalars/unknown JSON | No new V1 SDK reader. `extras.metadata.exit_code` is demonstrated by the existing reader fixture; no exit or interruption field is synthesized. Chat/action extras are not broadcast to observations. |
| OpenCode JSON + SQLite | Exact emitted tool part `state` | Existing emitted-result statuses remain completed/error/cancelled. Running/missing/null state creates no new result. A `cancelled` robustness control exercises the already-supported reader status; this does **not** claim a universally emitted upstream cancellation enum. No exit-code key was invented. |
| Kilo OpenCode-core SQLite | Same exact part `state`, using Kilo's actual public store routing | Legacy Cline-family Kilo is a different reader, not covered here. Kilo has no historical directory-JSON store; none is invented. |
| Pi + OMP shared version-3 core | Exact `toolResult` message, including optional arbitrary `details` and original `isError` | `details` is opaque extension JSON, not a standard exit-code schema. No session-level or assistant-turn status is copied into results. |
| Pi + OMP standalone local shell | Exact `bashExecution` message under `sourceExecution` on the original system message | Local `!` execution is not an assistant tool call. Keep string content and subtype; do not create synthetic tool/result blocks or infer status from rendered prose. |

## Ownership and compatibility

OpenHands attaches before shared display merging; Pi before transcript ancestry
remapping/shared merging; OpenCode before appending the exact normalized result.
The existing call placement algorithm is unchanged. Source UUID/session/position
is evidence ownership, not a guarantee that duplicate call IDs identify the
correct caller. Tests retain parallel/out-of-order results, replayed calls,
identical output and orphans; Pi also crosses a real compaction record.

OpenCode `contentIndex` is the normalized result block's position **before**
shared merging. `partIndex` is the zero-based index in the loader's ordered,
successfully decoded parts (JSON filename order / SQLite id order), not a JSONL
line, database rowid, or final display position. Skipped unreadable/invalid parts
are not counted. `messageUuid` is the loader's owning message ID and `sessionId`
is the source session ID; Kilo rebranding does not rewrite these source IDs.

Whole-response legacy baselines are recorded before each family's implementation:
OpenHands/OpenCode on `5a4817e6` plus test scaffolding, Pi/OMP on `6573074d`
(OpenHands/OpenCode changes do not touch Pi). Native non-paginated and eight
pagination windows, discovery, twenty filtered search rows and session token
stats per store case are deep-compared. Only declared additions at actual
message/result positions are stripped; sandbox-root prefixes are substituted.
Pi fixture file mtime is fixed. No errors/counts/flags/content fields are erased.

Metadata-only search initially broke each family's full-response baseline.
Matching now excludes the two additive result properties while returning those
properties intact. Standalone execution metadata is not in searched content.

The public Rust Tauri command functions and a real TCP read-only Axum endpoint
are compared. This is **not** evidence of a live desktop WebView/IPC invocation.
UI types/adapters/renderers are unchanged; TR1c must explicitly consume these
real shapes, including the distinct standalone `sourceExecution` envelope.

## Source shape reference

Pi's upstream declarations at revision
[`a92283056d915c758799fcd904948ff0cb42628c`](https://github.com/badlogic/pi-mono/tree/a92283056d915c758799fcd904948ff0cb42628c)
explicitly separate `ToolResultMessage` (`packages/ai/src/types.ts`, optional
JSON `details`) from `BashExecutionMessage`
(`packages/coding-agent/src/core/messages.ts`, recorded `exitCode`, `cancelled`,
`truncated`). Retrieval URLs, declaration excerpts and content hashes are retained
in `scratch/trbe/pi-upstream-source.json`. These declarations establish field
ownership, not that arbitrary extension details use an exit-code schema.

## Untouched provider inventory

The complete public dispatcher inventory and per-provider remaining reasons live
in `scratch/trbe/remaining.md` and `provider-scope-part2.json`. Providers not given
a raw-positive/native/HTTP/parity tracer bullet are **unverified**, not declared
unsupported. Cline SDK `session.exit_code` belongs to its session process, and
Kimi compensation prose is not raw per-tool interruption evidence. No value from
either is broadcast by this change.
