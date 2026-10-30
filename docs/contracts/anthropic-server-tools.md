# Anthropic server-tool results

## Producer evidence

Pinned producer: [`anthropics/anthropic-sdk-typescript@cb5fba419808e3844fa6407e59577ab7ba346b79`](https://github.com/anthropics/anthropic-sdk-typescript/tree/cb5fba419808e3844fa6407e59577ab7ba346b79). SDK source was fetched as raw text and the line ranges below rechecked, not inferred from repository fixtures.

| Interpretation | Ground truth | Regression |
|---|---|---|
| Editor create is `{type: text_editor_code_execution_create_result, is_file_update}` | [messages.ts:7085–7089](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7085-L7089) | `anthropicServerTools.test.tsx` C8 create |
| Editor str_replace has nullable `lines`, `old_start`, `new_start`, `old_lines`, `new_lines` | [7097–7109](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7097-L7109) | C8 recorded coordinates / null coordinates |
| View has `content`, `file_type`, nullable `num_lines`, `start_line`, `total_lines` | [7180–7192](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7180-L7192) | C8 paired and orphan view |
| Editor error has `error_code`, nullable `error_message`; `permission_denied` is not in the enum | [7154–7165](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7154-L7165) | C8 error text + failed ToolRow |
| Tool search returns an object containing `tool_references`, not an array of definitions | [8010–8057](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L8010-L8057) | C9 paired/orphan references; error text |
| Redacted advisor is opaque encrypted output, not missing advice | [360–405](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L360-L405), [470–476](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L470-L476) | C10 paired/orphan redacted; ciphertext not shown/indexed/exported as prose |
| Claude WebSearch is batches of links plus commentary | GROUNDED_BINARY_SCHEMA + real data: Claude Code 2.1.285 `Pn`/`Dn`/`Ln`, below | C11 legacy router and unified card |

### Round-1 producer recheck

- `file_not_found` belongs to the [SDK error enum, 7154–7165](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7154-L7165). The shared error map reuses the existing five-locale `toolError.fileNotFound` translation. Of six previously orphaned keys, this one is now used; the other five were removed after literal and dynamic `t()` reference inspection, and types regenerated.
- `is_file_update:true` means the file already existed ([official code-execution response fields](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool#text-editor-operations), Create); SDK 7085–7089 supplies the boolean. The renderer says Update File for true and Create File for false.
- Real server tool names are [6894–6902](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L6894-L6902): `tool_search_tool_regex` and `tool_search_tool_bm25`. Tests exercise both names, paired and orphan; the HTTP fixture uses regex.
- Plain advisor `text` is specified at [387–405](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L387-L405). TS text/HTML export emits it as text (HTML escaped), not JSON. Redacted output remains opaque. The worker regression drives the actual build/search message protocol, with ciphertext negative control.

### Claude Code binary schema and legacy compatibility

Local producer `~/.local/share/claude/versions/2.1.285`, SHA-256 `51f09bd1e021d9fa8a1864c179799bd37cb39962a937935c5cf6823398e86db4`: byte **190231056** contains `Pn` (batch `{tool_use_id,content:[{title,url}]}`), `Dn` (`results: array(union(Pn,string))`, description “Search results and/or text commentary from the model”), and `Ln` (pushes batch objects and text commentary). This is **GROUNDED_BINARY_SCHEMA + GROUNDED_REAL_DATA**, not real-data-only. Schema and builder do not prescribe serialized-JSON link strings.

Round-1 read-only recount: **318 records, 324 batches, 2,965 links, 323 strings, 0 JSON-string URL items**. Thus CodeRabbit 4427583909 identifies a valid *legacy compatibility inconsistency*, not an observed producer-emitted shape. The legacy renderer now normalizes its compatibility JSON-string objects once and counts the nonempty URL items it actually renders, respecting direct-item precedence. Plain/malformed/no-URL commentary is not counted. Shared `webSearchLinks` and the unified producer path are unchanged.

`Ln` at byte **190231485** also appends `Web search error: <error_code>` strings; byte **190233877** emits a search-budget refusal as string-only results. “0 results” counts links accurately but does not independently mark those outcomes failed. **Pre-existing follow-up:** preserve producer error provenance in a dedicated outcome contract rather than infer failure from arbitrary commentary. No new text heuristic is added in this frontend slice. Reproducible aggregate recount and binary excerpts are retained under `scratch/fg3/fix1/`.

### Diff boundary

The SDK types specify string rows, **not a guaranteed row grammar**. Only rows already compatible with the existing unified-hunk component (space/`+`/`-` prefixes, matching non-null side counts) get that view. The original record remains available as JSON in all cases. Unsupported rows never get guessed changes. No `old_content`/`new_content`, `operation`, `path` or `success` schema is inferred. Numbered gutters start only at a recorded non-null safe coordinate; missing/null coordinates remain blank. Reconstructed sides are fragments, not full files. Copy preserves recorded rows, not an invented complete file.

### Real local structural recount

Read-only scan of `~/.claude/projects/**/*.jsonl`: **111 files, 29,432 records**. Only keys/types/counts were retained:

- Advisor: **79/79** inner objects are `advisor_redacted_result`, with exactly `encrypted_content,type` keys. They omit the response-only `stop_reason`; the frontend therefore permits it to be absent (SDK request/round-trip form also makes it optional).
- Text editor and tool search: **0 local records**. Their coverage is specification-shaped synthetic data, not real-history coverage.
- WebSearch metadata: **318** objects with string `query` and array `results`; **313/318** are exactly `[{tool_use_id, content:[links]}, commentary-string]`.
- Across all results: **324 batches**, **2,965 link entries**, every entry has exactly `title,url` keys and a string URL. Commentary is never a link. All batches are counted, not merely the first batch or outer array length.

## Actual frontend boundary

Viewer source pinned to base `9c95b48c06256759774962934dd519ff038927a0`:

1. `src-tauri/src/providers/claude.rs:4–16` discovers Claude's store; unlike normalizing providers, it does not rename these content blocks.
2. [`commands/session/load.rs:1823–1835`](https://github.com/jhlee0409/claude-code-history-viewer/blob/9c95b48c06256759774962934dd519ff038927a0/src-tauri/src/commands/session/load.rs#L1823-L1835) copies `message.content` and `toolUseResult` without reshaping their inner values.
3. [`commands/multi_provider.rs:1236–1297`](https://github.com/jhlee0409/claude-code-history-viewer/blob/9c95b48c06256759774962934dd519ff038927a0/src-tauri/src/commands/multi_provider.rs#L1236-L1297) preserves assistant server blocks and attaches Claude's sole user `tool_result` metadata to the inline result before pairing. Thus the WebSearch unified card reads that result's own `toolUseResult.results`, not arbitrary sibling metadata.
4. `src/types/core/tool.ts` and legacy `src/types/tool.types.ts` model the SDK discriminants. `ClaudeContentArrayRenderer → ServerToolUseRenderer → ServerResult` (paired) and `StandaloneServerResult → ServerResult` (orphan) reach the same bodies. `ToolExecutionResultRouter → WebSearchRenderer` is the legacy metadata route; `WebSearchCard` is the unified route.
5. `scripts/ui-capture/test/anthropicServerTools.test.mjs` plants synthetic producer-shaped raw JSONL, loads it through the parity-verified HTTP backend and opens the production renderer in WebKit. Component tests exercise paired and orphan routes; authored fixtures alone are not producer evidence.

Errors use the existing `toolOutcome.normalizeResult` API `error_code` convention; bodies do not invent independent success/failure flags. Create `is_file_update:false` is data, not failure. Redacted advisor stays neutral, without decrypting or inspecting the blob.

## Sibling consumers and scope

- Search: shared SDK plaintext extraction is used by both `searchIndex.ts` and `searchWorker.ts`, and by server-row reveal/highlighting. It reads diff rows, tool names and error messages; never ciphertext. Old extraction remains compatibility-only, not evidence for a legacy producer schema.
- Frontend export: `contentExtractor.ts` preserves editor/tool-search records as escaped JSON and explicitly labels encrypted advisor results. `htmlExporter.ts` consumes those blocks and already escapes non-text content; no second parser is needed. Regression tests exercise both text extraction and HTML output.
- Prior tests containing the invented editor `{operation,path,success}` shape are compatibility controls only. A recorded legacy `path` stays searchable in raw JSON; it is no longer presented as a dedicated SDK path field with an ellipsis. The existing search-hit preservation assertions remain in force.
- **Follow-up:** Claude Code client `ToolSearch` has **98 `tool_reference` items inside ordinary `tool_result.content` arrays**, not C9 server result objects. Dedicated ordinary-result reference rendering is a separate route and is not claimed here.
- **Follow-up, deliberately not edited:** `src-tauri/src/export.rs:227–245` still reads nonexistent editor `operation/path`, emits a generic tool-search placeholder, and has no explicit advisor-redacted branch. The headless export needs a separate Rust parity change and Rust gates. This frontend-only task ran no Cargo.
