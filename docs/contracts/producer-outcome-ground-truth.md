# Producer-grounded tool outcomes (item ①)

Scope: C1–C4 of the format audit, plus the corrected interpretation of Claude
optional error flags on read/search/edit results (U7). This is a frontend interpretation change; no provider
record, backend serializer, raw content, or source envelope is rewritten.

## Ground truth

| Rule | Producer evidence (pinned) / structural observation | Regression |
|---|---|---|
| `tool_result.is_error` is an explicit error flag; arbitrary output starting `Error` is not a failure grammar | [Anthropic SDK cb5fba4, messages.ts:7919–7941](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7919-L7941). Read-only local scan: Bash 3582 results, false 3468, false + error-prefixed output 17, exit aliases 0. | `producerGrounding.test.ts`, C1 |
| Pi/OMP keeps both `isError` booleans; opaque `details` is not a process schema | [pi-mono a922830, bash.ts:400–408](https://github.com/badlogic/pi-mono/blob/a92283056d915c758799fcd904948ff0cb42628c/packages/coding-agent/src/core/tools/bash.ts#L400-L408). Local Pi/OMP toolResult false 18279; 53 have error-prefixed text. | C1 false/true, opaque-provider negative controls |
| OpenCode `completed` only describes lifecycle, including nonzero exit | [b9a39b8, message-v2.ts:209–245](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/message-v2.ts#L209-L245); [bash.ts:249–265](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/bash.ts#L249-L265); [37bb07e, bash.ts:318–333](https://github.com/anomalyco/opencode/blob/37bb07e7a313d7150038061dbba670410eb0469d/packages/opencode/src/tool/bash.ts#L318-L333). Bash `metadata.exit` is the process code; appended abort/timeout suffixes mean interruption. | C2 exit 0/1/2, absent/null/string/false, exact suffixes, sibling conflicts |
| Kilo independently verified, not assumed byte-identical to OpenCode | [Kilo a77843c, bash.ts:527–571](https://github.com/Kilo-Org/kilocode/blob/a77843cbab3006baa4ef7368a5043217a9b6a278/packages/opencode/src/tool/bash.ts#L527-L571): `metadata.exit`, source-appended `<bash_metadata>` abort/timeout text. Newer main 0a9faef has a different tool architecture; these rules claim only the preserved OpenCode-core state shape. | C2 Kilo exit and its own marker grammar; absent exit unknown |
| OpenHands `exit_code:-1` means unavailable, not failure | [3fe4434, commands.py:21–31](https://github.com/All-Hands-AI/OpenHands/blob/3fe4434c22ee2fd92527844a58569034847ef760/openhands/events/observation/commands.py#L21-L31); [bash.py:375–414](https://github.com/All-Hands-AI/OpenHands/blob/3fe4434c22ee2fd92527844a58569034847ef760/openhands/runtime/utils/bash.py#L375-L414), also line 552: default metadata on unavailable PS1 paths. | C3 sentinel/missing, real zero and nonzero controls; Codex -1 unaffected |
| OpenHands block false is backend-synthesized, not recorded producer no-error | [cchv f0e8317, openhands.rs:331–334](https://github.com/jhlee0409/claude-code-history-viewer/blob/f0e8317ab05ba6dc1a3cd54efa5610a0dbca0f40/src-tauri/src/providers/openhands.rs#L331-L334): `observation == "error"`. True retains that positive observation error; false supplies no producer assertion. | C4 nonzero without fabricated conflict, true error retained, genuine sibling-code conflict retained |
| Claude optional `is_error` absent/false is producer no-error, not unknown | [Official Messages API tool handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls): optional flag, set true on execution error; successful example omits it. [SDK `ToolResultBlockParam`, cb5fba419808e3844fa6407e59577ab7ba346b79, messages.ts:5764–5791](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/messages/messages.ts#L5764-L5791), `is_error?: boolean` at line5785. Independently repeated local structural counts below confirm the convention. | U7 correction: Claude Read/Grep/Glob/WebSearch/WebFetch/Edit/MultiEdit/Write absent/false succeeds, true fails; Read folding restored; other-provider missing flag unknown |
| HTTP status is not a producer error flag or process exit | Prior structural scan: WebFetch HTTP403×21/404×8/418×2/500×1 with absent `is_error`. No new HTTP policy is imposed; these remain producer-no-error results. | HTTP200/403/404/418/500 no-error controls; **open question:** should fetched HTTP error pages receive separate UI policy? |

Fixtures use synthetic text and identities. Claude/Pi fixture **shape** comes
from a read-only structural scan, not copied private content. OpenCode/Kilo and
OpenHands fixtures are **source-shaped**; no local stores exist for them.
Repo-authored public-response fixtures are compatibility controls, not producer
source evidence.

## Repeated real-record structural count

Read-only rescan of all `~/.claude/projects/**/*.jsonl`: **111 files**, zero
invalid/unreadable lines. Tool names associated by tool_use id within each file;
only keys/counts retained (`scratch/fg1/evidence/regression/claude-structural.json`).
No content, paths, or user identifiers copied. This file scope differs from the
parent audit’s broader file enumeration; the named-tool result counts agree.

| Tool | is_error absent | false | true |
|---|---:|---:|---:|
| Read | 205 | 0 | 8 |
| WebFetch | 299 | 0 | 12 |
| WebSearch | 318 | 0 | 0 |
| Edit | 136 | 0 | 1 |
| Write | 100 | 0 | 0 |
| Bash | 0 | 3468 | 114 |

Grep/Glob/MultiEdit had no associated results in this rescan; their optional-flag
semantics come from the Anthropic contract, not invented local observations.

## Verdict policy and limits

- No free-text failure heuristic remains. Missing fields follow the producer
  convention, not a universal unknown rule; content remains visible verbatim.
- Recorded true error/API error or nonzero code still fails. Genuine recorded
  code disagreements remain conflicts. Interruption wins lifecycle and keeps
  recorded codes. `stderr` is never a verdict.
- For process tools, a false error flag prevents prose-based failure but does
  not manufacture a numeric exit or verified success. Claude/Pi process rows
  without an exit stay `unknown` (the conservative U11 policy is preserved).
- Claude read/search and Edit/MultiEdit/Write absent/false `is_error` is producer
  no-error, hence `succeeded`; a paired read/search can fold again. This corrects
  FG1 U7, which had removed every omitted-flag success. Undefined provider is the
  existing legacy Claude route. Other providers without that convention need
  explicit no-error evidence; missing flags stay unknown. Edits never fold.
- HTTP status is not an error flag. WebFetch HTTP error-page classification
  remains an **open owner question**, distinct from tool execution failure.
- OpenCode/Kilo metadata.exit and interruption markers are read only for process
  results with source state `completed`; arbitrary tool-extension metadata is
  not interpreted. `status:error` is positive failure; `cancelled` is not an
  upstream ToolState enum and no longer invents interruption.
- Legacy exit aliases, legacy MCP router error union, and API `error_code`
  compatibility paths predate this lane. Their existing behavior is retained;
  this task does not certify the audit's U1–U5 hypothetical producer shapes.
  In particular, Claude WebFetch `error_code` fixtures are not live evidence.
  Anthropic server-tool error blocks are a separate actual SDK schema.

## Accepted reviews and owner wording

#728 CodeRabbit **4360641128** correctly preferred a recorded exit to output text,
but its Claude `exitCode` premise was absent in 3582/3582 local Bash results.
It missed the real `is_error:false` records. #752 **4415170647** correctly warned
against reading ordinary output as failure, but incorrectly equated OpenCode
`completed` with success. The pinned producer source disproves that equation.
Their old expectations are migrated, not hidden or treated as ground truth.

**Proposed D-R4 replacement — owner decision required:**

> Producer-recorded outcome evidence outranks output prose. Process exit codes
> decide when present; explicit recorded error flags and API error codes remain
> error signals. A false producer error flag is not overridden by `Error` text.
> Optional flags use their producer-documented default (Claude absent `is_error`
> is no-error for non-process reads/searches/edits). Process results without
> recorded exit codes stay unknown, even with `is_error:false`. Where no producer
> default establishes an outcome, missing evidence is unknown. Prose alone
> establishes neither success nor failure.
> Provider lifecycle completion is not success, unavailable-code sentinels are
> not exit codes, and synthesized defaults are not recorded producer facts.

The owner-approved amendment file is not edited. Existing D-R4's literal rule
(recorded exit beats Error text, explicit errors still count) remains satisfied;
the replacement makes its missing-field/provenance boundary explicit.
