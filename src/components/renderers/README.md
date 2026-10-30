# Renderer patterns and ownership

All providers enter the same transcript route. A provider name is not a UI
pattern, and a system event is not a tool invocation.

## Five patterns

| Pattern | Families and current implementation | Contract |
| --- | --- | --- |
| **ToolRow** | Paired calls (`UnifiedToolExecutionRenderer` and `unifiedCards/*`), unmatched/legacy calls (`ToolUseRenderer`), server/MCP calls, orphan results (`ClaudeToolResultItem`, `ResultRow`), heuristic result-only heads (`RecordedResult`) | One neutral head, recorded tool name when present; otherwise an honest result-category label, never an invented call or ID. Outcome comes only from `toolOutcome`. `aria-expanded` and `aria-controls` link to the detail. |
| **OutputBlock** | Plain strings, terminal streams, code/bash execution, generic execution streams and unknown JSON (`FallbackRenderer`) | Preserve whitespace/ANSI, ordered content parts and distinct streams. Long output has a reachable show-all control. A neutral `stderr` label is danger-styled only for a failed verdict. Exit/interruption/error facts belong to the owning ToolRow, once. |
| **DiffView** | Existing Edit/Write displays and file-edit body | Input/Result zones retain labels, input rule, result hairline and tool kind. StructuredPatch/MultiEdit/apply_patch/text-editor, Recent Edits filters and restore previews share DiffView; split/word/six-method advanced comparison is available from its `…` menu. |
| **Notice** | Slash commands/local output/caveats, task notifications, `opencode_step`, system messages | These are recorded notices, not implicit tool calls. Existing bodies remain until **TR4** adopts the Notice pattern. A Pi/OMP `sourceExecution` envelope stays independent of assistant tool use/results. |
| **Checklist** | Todo/update_plan, task results/operations, agent-task and progress groups | Keep recorded item order/status/body. **TR4** owns checklist state glyphs/prose/animation cleanup; TR1c adopts shared buttons and result heads only. |

`DetailZone kind="input"` labels what was supplied and has the neutral input
rule. `kind="result"` labels what came back. The ToolRow owns its bottom
hairline, outcome facts and copy-tool-ID action. Nested legacy bodies under an
already-open result owner do not create a second outcome head.

## Explicit families outside a new tool body

- **Server result lists:** `web_search_tool_result`, `tool_search_tool_result`,
  `web_fetch_tool_result`, `mcp_tool_result`, `advisor_tool_result`,
  `code_execution_tool_result`, `bash_code_execution_tool_result` and
  `text_editor_code_execution_tool_result` keep their existing list/document/
  operation bodies. `ServerToolUseRenderer` pairs them; `ResultRow` supplies a
  standalone ToolRow when the call is absent. Never discard a list because it
  is not plain terminal output.
- **Media and document families:** `image`, `document`, `search_result`,
  `container_upload`, redacted thinking and citations retain their existing
  body/fallback rendering. Images must not exceed intrinsic dimensions.
  These are not fabricated tool results. `ToolResultCard` remains bounded to
  Document/SearchResult/ContainerUpload/RedactedThinking, and
  `shared/RendererHeader` remains only behind that non-tool card and system
  notices. Their final removal belongs to the semantic body owner, not a
  cosmetic rename or forced ToolRow conversion. Citation wiring is TR4.
- **Unsupported/unknown shapes:** the content dispatcher's existing unknown
  block fallback and the result router's `FallbackRenderer` remain distinct.
  Unknown result objects are honest JSON with show-all; no field is silently
  dropped to make a card fit. Unsupported image/document source kinds retain
  the existing renderer's own unsupported/fallback behavior; this is not a
  claim of newly added media support.
- **Page-boundary/orphan results:** keep the recorded result and indicate the
  absent/earlier-page call; do not manufacture a completed invocation.
- **Provider fixture gaps:** the public dispatcher inventory and normalized
  fixtures are in `src/test/fixtures/tr1c/README.md` and the provider contract
  test. A missing raw-positive fixture is a coverage gap, **not** an
  unsupported-provider declaration or a success certificate.

## Legacy result router source-shape map

`ClaudeMessageNode` (desktop and phone) can send message-owned `toolUseResult`
to `ToolExecutionResultRouter`. Nested results reach it through `ResultBlock`
and `ContentArrayRenderer`. These shape routes predate TR1c; a heuristic is
not evidence that every provider emits that shape.

| Recorded shape | Body / head after TR1c | Boundary |
| --- | --- | --- |
| array of content blocks | `ContentArrayRenderer` | Original block order, nested tools and media retained |
| `Error: ` string / ordinary string / JSONL history | `ErrorRenderer` / `StringRenderer` / `ClaudeSessionHistoryRenderer` | Existing error/history/prose bodies retained |
| `mcp_tool_call` or server + method/function | `MCPRenderer` / RecordedResult | Existing parameters and result/error preserved |
| codebase_context / files_analyzed / context_window aliases | `CodebaseContextRenderer` / RecordedResult | Existing stats and file disclosure preserved |
| terminal_stream or command + output + stream fields | `TerminalStreamRenderer` / RecordedResult + OutputBlock | Adapter verdict; stderr alone is not failure |
| git_workflow / git command / diff / commit | `GitWorkflowRenderer` / RecordedResult | Bare `status` is **not** Git evidence (TR1b); existing file/diff bodies preserved |
| query + nonempty results | `WebSearchRenderer` / RecordedResult | Ordered existing search-result body |
| oldTodos/newTodos; task/tasks; success + taskId | `TodoUpdateRenderer` / `TaskResultRenderer` / RecordedResult | Checklist bodies remain TR4-owned |
| filenames + numFiles | `FileListRenderer` / RecordedResult | Existing ordered paths retained |
| file object; filePath + edit fields; structuredPatch | `FileContent`; `FileEditRenderer`; `StructuredPatchRenderer` | File bodies retained; diff bodies share DiffView |
| async agentId + isAsync/completed | Existing MessageViewer grouping | Router deliberately delegates; do not silently remove the owning group |
| stdout/stderr/interruption/image/file metadata | `LegacyExecutionResult` / RecordedResult + OutputBlock | Shared adapter; unused fields, false/null/zero retained as JSON |
| any other object | `FallbackRenderer` / RecordedResult + OutputBlock | Every recorded JSON key/value/array position retained, with show-all |

## Adding or changing a renderer

1. Trace the real source producer, public response, dispatcher and desktop/
   phone caller. Do not use gallery reachability or a text grep as runtime
   proof. Keep provider identity explicit (`ResultProviderContext`).
2. Write a characterization of the previous body and a failing contract test
   before editing. Keep mixed text/media in recorded order; do not bucket all
   text before attachments or suppress text merely because streams exist.
3. Reuse these patterns, `Button` (including icon-sized variants), PathText and
   existing formatters. Preserve native type, accessible name, disabled/ref/
   event/Slot semantics; do not replace an action with a styled div. Link
   every disclosure to a persistent target with a unique React ID.
4. Read result evidence only through `toolOutcome`; never infer completion
   from results.length, stderr, session status or output prose. Preserve
   missing/null/false/zero distinctions and unconsumed recorded fields.
5. Add translations to all locale namespaces when needed, regenerate types,
   run typecheck/lint/i18n/token guards and full required-browser tests against
   the exact production bundle. Capture visual evidence separately; passing
   source tests is not a gallery/phone overflow certificate.

## Deletion inventory

Compiler-resolved declarations/imports/JSX references proved these had no
production consumer: `RendererCard`, `ToolUseCard`, `QueueOperationRenderer`,
`SummaryMessageRenderer`, `AssistantMessageDetails`. Their unused barrel
exports are removed. `AgentToolRenderer` was already absent; no new deletion
is claimed. RendererCard's barrel made its module import-reachable but did
not make its exported component callable. The non-tool card/header exceptions
above are intentional bounded gaps, not a second tool-head system.
