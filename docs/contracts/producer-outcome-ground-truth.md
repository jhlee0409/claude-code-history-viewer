# Producer-grounded tool outcomes (item ①)

Scope: C1–C4 of the format audit, plus the corrected interpretation of Claude
optional error flags on read/search/edit results (U7). This is a frontend interpretation change; no provider
record, backend serializer, raw content, or source envelope is rewritten.

## Ground truth

| Rule | Producer evidence (pinned) / structural observation | Regression |
|---|---|---|
| `tool_result.is_error` is an explicit error flag; arbitrary output starting `Error` is not a failure grammar | [Anthropic SDK cb5fba4, messages.ts:7919–7941](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7919-L7941). Read-only local scan: Bash 3582 results, false 3468, false + error-prefixed output 17, exit aliases 0. | `producerGrounding.test.ts`, C1 |
| Pi/OMP mapped block `is_error` preserves booleans (absent producer flag defaults false in pi.rs); opaque `details` is not a process schema | [pi-mono a922830 agent-loop.ts:841–863](https://github.com/badlogic/pi-mono/blob/a92283056d915c758799fcd904948ff0cb42628c/packages/agent/src/agent-loop.ts#L841-L863); viewer `pi.rs:1085–1115` maps the producer flag, defaulting absent to false. OMP installed 17.3.7 has distinct edit/write paths (below); do not infer bash success or OMP write success from false. Local false18279/error-prefix53 are structural counts, not semantic certification. | C1 false/true, opaque-provider negative controls |
| OpenCode **bash** `completed` only describes lifecycle, including nonzero exit | [b9a39b8, message-v2.ts:209–245](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/message-v2.ts#L209-L245); [bash.ts:249–265](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/bash.ts#L249-L265); [37bb07e, bash.ts:318–333](https://github.com/anomalyco/opencode/blob/37bb07e7a313d7150038061dbba670410eb0469d/packages/opencode/src/tool/bash.ts#L318-L333). Bash `metadata.exit` is the process code; appended abort/timeout suffixes mean interruption. | C2 exit 0/1/2, absent/null/string/false, exact suffixes, sibling conflicts |
| Kilo independently verified, not assumed byte-identical to OpenCode | [Kilo a77843c, bash.ts:527–571](https://github.com/Kilo-Org/kilocode/blob/a77843cbab3006baa4ef7368a5043217a9b6a278/packages/opencode/src/tool/bash.ts#L527-L571): `metadata.exit`, source-appended `<bash_metadata>` abort/timeout text. Current main 0a9faeff retains the core state and exit mapping; its `<shell_metadata>` grammar is independently verified below. | C2 Kilo exit and its own marker grammar; absent exit unknown |
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

## Round-1 source verification

- **OpenCode/Kilo named built-in completed = no-error**: backend-delivered Read/Glob/Edit/Write/WebFetch, plus OpenCode-only list; normal returns become
  `completed`, thrown failures become `error`: [OpenCode b9a39b8 prompt.ts:1115–1160](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L1115-L1160),
  independently [Kilo 0a9faeff processor.ts:271–310](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/session/processor.ts#L271-L310).
  Read/Glob/WebFetch regain success and folding; Edit/Write succeed but never
  fold. Ambiguous Grep stays unknown (round-3 trade-off below). Bash completion
  still needs `metadata.exit` (C2).
- **Current Kilo bash interruption**: [shell.ts:687–723](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/shell.ts#L687-L723)
  appends `<shell_metadata>` abort/timeout notes. [command-timeout.ts:32–41](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/kilocode/command-timeout.ts#L32-L41)
  adds environment-timeout wording and an optional multiline deployment message.
  [shell/id.ts:14–16](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/shell/id.ts#L14-L16)
  retains ToolID `bash`. This grammar is Kilo-only, not inferred for OpenCode.
- **Pi exact edit/write false = no-error**: pi-mono a922830
  [edit.ts:159–211](https://github.com/badlogic/pi-mono/blob/a92283056d915c758799fcd904948ff0cb42628c/packages/coding-agent/src/core/tools/edit.ts#L159-L211),
  [write.ts:67–89](https://github.com/badlogic/pi-mono/blob/a92283056d915c758799fcd904948ff0cb42628c/packages/coding-agent/src/core/tools/write.ts#L67-L89),
  [agent-loop.ts:841–863](https://github.com/badlogic/pi-mono/blob/a92283056d915c758799fcd904948ff0cb42628c/packages/agent/src/agent-loop.ts#L841-L863): failures reject → true.
  Historical v0.6.0/v0.7.9/v0.8.0 edit/write also reject failures.
- **OMP exact edit only**: independently opened installed `@oh-my-pi/pi-coding-agent`
  **17.3.7** `src/edit/index.ts:191,254,341,363` sets true on per-file errors.
  This is installed-version evidence, not a commit pin. **OMP write stays unknown**:
  `src/tools/write.ts:1128–1176` forwards `xd://` inner `isError`; the real-record
  scan found 1/1006 false writes with an Error prefix and `details.xdev`.
  Counts alone do not certify success; Pi write is not the OMP fork.
- **Pi bash false stays unknown**: a922830 flags nonzero exits, but released
  [v0.7.9@6bed5a91 bash.ts:152–169](https://github.com/badlogic/pi-mono/blob/6bed5a91/packages/coding-agent/src/tools/bash.ts#L152-L169)
  and [v0.6.0@00d82865 bash.ts:82–99](https://github.com/badlogic/pi-mono/blob/00d82865/packages/coding-agent/src/tools/bash.ts#L82-L99)
  resolve nonzero/timeout as normal results. That era's
  [agent-loop.ts@bc01ed5e:196–209](https://github.com/badlogic/pi-mono/blob/bc01ed5e/packages/ai/src/agent/agent-loop.ts#L196-L209)
  then records false. No version-discriminating field reaches this frontend.
  OMP bash also stays unknown; its implementation differs.

### Producer IDs and backend-delivered completion allowlist

All paths below are under `packages/opencode/src/`; links are pinned to
`b9a39b816c92592e824c68cdc9a48acf7717e2a2`.

| Exact ID | Failure path / producer source |
|---|---|
| `read` | [tool/read.ts:31–90](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/read.ts#L31-L90): throws missing/unreadable/binary |
| `grep` | [tool/grep.ts:16–48](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/grep.ts#L16-L48): throws invalid pattern/process failure; no-match returns normally |
| `glob` | [tool/glob.ts:19–56](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/glob.ts#L19-L56): awaits Ripgrep iterator; missing directory throws in [file/ripgrep.ts:206–224](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/file/ripgrep.ts#L206-L224); optional mtime fallback is not a tool error |
| `list` | [tool/ls.ts:37–109](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/ls.ts#L37-L109): ToolID list, same rejecting iterator |
| `edit` | [tool/edit.ts:31–74](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/edit.ts#L31-L74), [:605–639](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/edit.ts#L605-L639): invalid/missing/mismatched edit throws |
| `write` | [tool/write.ts:20–45](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/write.ts#L20-L45): throws scope/read-time/permission errors; awaits Bun.write |
| `webfetch` | [tool/webfetch.ts:23–88](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/webfetch.ts#L23-L88): throws URL/HTTP/size errors |

The frontend does **not** receive those raw IDs. Viewer
[opencode.rs:1461–1511](https://github.com/jhlee0409/claude-code-history-viewer/blob/f0e8317ab05ba6dc1a3cd54efa5610a0dbca0f40/src-tauri/src/providers/opencode.rs#L1461-L1511)
emits only `type/id/name/input` for the call and attaches only `part.state` to
the result. Neither carries raw `part.tool`; TS `ToolUseContent` likewise has
no original-name field. Kilo uses this loader ([kilo.rs:181](https://github.com/jhlee0409/claude-code-history-viewer/blob/f0e8317ab05ba6dc1a3cd54efa5610a0dbca0f40/src-tauri/src/providers/kilo.rs#L181)).
The [name mapping at opencode.rs:1675–1691](https://github.com/jhlee0409/claude-code-history-viewer/blob/f0e8317ab05ba6dc1a3cd54efa5610a0dbca0f40/src-tauri/src/providers/opencode.rs#L1675-L1691)
produces `Read/Glob/Edit/Write/WebFetch` from `read/glob/edit/write/webfetch`;
`list` passes through unchanged. Those exact delivered names gate completion
at normalization **and** final verdict; lowercase raw IDs are not accepted.

Kilo 0a9faeff has no built-in list: [tool registry:274–335](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L274-L335)
and the pinned tool directory contain no list/ls module. Therefore `list` is
**OpenCode-only**; no historical Kilo list/MCP exception is claimed.

**Owner-delegated frontend-only trade-off:** built-in `grep` and MCP `grep_*`
both become `Grep`. Completion-only `Grep` stays **unknown** for both providers,
so built-in grep loses success/folding versus develop until item ② preserves
raw IDs. This avoids certifying a dropped MCP error as success. Other unlisted
MCP/plugin/unknown names and aliases such as `read_file` also stay unknown.
A plugin literally named `Read` (or another allowed delivered name) is still
indistinguishable: this is a bounded delivered-name policy, not proof of raw
built-in identity. Explicit block false on read/search retains its separate
rule below; the backend does not emit false for these completed MCP results.
OpenCode
[prompt.ts:598–644](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L598-L644)
drops MCP isError, while [AI SDK 5.0.8@718e5291 mcp-client.ts:287–307](https://github.com/vercel/ai/blob/718e5291/packages/ai/src/tool/mcp/mcp-client.ts#L287-L307)
returns those errors without throwing. Thus MCP errors can be completed.

### Open backend provenance work — plan item ② (not redesigned here)

The viewer still treats block `is_error:false` as no-error for read/search on
Gemini, Cursor, zcode, goose, crush, zed, antigravity and cline_sdk even where the
backend synthesized that value. At develop f0e8317, see
`src-tauri/src/providers/{gemini.rs:685,cursor.rs:1115,zcode.rs:471,goose.rs:421–447,crush.rs:505,zed.rs:365,antigravity.rs:359,cline_sdk.rs:501}`.
Pi/OMP is also affected: `pi.rs:1090–1093` defaults missing `isError` to false
and attaches no `toolUseResult`. Tests use that backend-shaped block, not an
invented Pi metadata envelope. The real OMP scan found 0 absent flags, which
limits observed impact, not the provenance gap. Only OpenHands has the
provenance correction in this PR. Preserving raw flags
while carrying their provenance is an **open plan item ②**, not a delivered
universal guarantee. OpenCode/Kilo must also preserve raw `part.tool` alongside
normalized names: built-in grep and MCP grep_* currently collapse to Grep.
Restoring built-in grep success/folding without certifying MCP errors is deferred
to that item ② change. Same-name plugin collisions also need raw identity. Copilot CLI (`copilot_cli.rs:1079–1096`) and Kimi
(`kimi_code.rs:1200`) drop recorded success/false before the frontend; their
unflagged read/search rows now become unknown and cannot fold. Codex unflagged
read/search (e.g. web_search without an outcome flag/code) likewise becomes
unknown rather than assumed successful. No backend or producer-schema repair
for those providers is claimed.

## Verdict policy and limits

- No free-text failure heuristic remains. Missing fields follow the producer
  convention, not a universal unknown rule; content remains visible verbatim.
- Recorded true error/API error or nonzero code still fails. Genuine recorded
  code disagreements remain conflicts. Interruption wins lifecycle and keeps
  recorded codes. `stderr` is never a verdict.
- Every process tool without a recorded exit stays unknown, including Claude,
  Pi and OMP bash. A no-error flag never manufactures an exit or success;
  historical Pi false records include nonzero exits/timeouts.
- Claude read/search and Edit/MultiEdit/Write absent/false `is_error` is producer
  no-error, hence `succeeded`; a paired read/search can fold again. This corrects
  FG1 U7, which had removed every omitted-flag success. Undefined provider is the
  existing legacy Claude route. Other providers' read/search rows need explicit
  no-error evidence or the grounded completed-state convention. Other-family
  success is limited to paired Claude Edit/MultiEdit/Write (case-insensitive),
  Pi exact edit/write, OMP exact edit, and OpenCode/Kilo exact delivered names
  Read/Glob/Edit/Write/WebFetch (plus OpenCode-only list) with explicit false or
  name-gated completed no-error results. Grep completion alone stays unknown.
  Completion needs a paired allowed delivered name; explicit
  false read/search does not require a paired call (but orphans never fold).
  Read/search family rows can also succeed on explicit block false, for any
  provider except the OpenHands synthesized-false correction. No other
  other-family tool succeeds on false alone. Opaque tools stay unknown; edits
  and list (other-family) never fold.
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
**bash** `completed` with success. The pinned producer source disproves that
bash equation, not the non-process no-error convention.
Their old expectations are migrated, not hidden or treated as ground truth.

**Proposed D-R4 replacement — owner decision required:**

> Producer-recorded outcome evidence outranks output prose; prose alone establishes neither success nor failure. Interruption decides the lifecycle first. A normalized error flag or API error code fails the row; disagreement with a recorded exit is a conflict. Otherwise a recorded exit code decides. Process results without a recorded exit stay unknown even with a no-error flag; unavailable OpenHands -1 is not an exit code. For non-process results without positive errors or exits, success requires every result to have normalized no-error: explicit false, or Claude/legacy absent block is_error. Read/search accepts this no-error for any provider except the OpenHands synthesized-false correction. Other-family success additionally needs a paired Claude Edit/MultiEdit/Write (case-insensitive), Pi exact edit/write, OMP exact edit, or an allowed OpenCode/Kilo delivered name. OpenCode/Kilo status:completed supplies normalized false only for paired Read/Glob/Edit/Write/WebFetch and OpenCode-only list; status:error supplies true. Grep completion stays unknown because built-in grep and MCP grep_* collapse to that name; built-in grep success/folding is deferred to backend item ②. Opaque tools do not succeed on completion alone. Synthesized defaults are not producer evidence: this is the item ② target, not a claim that all backend defaults have been corrected here. Missing evidence without one of these conventions is unknown.

This round-3 proposal matches the implementation's explicit-false read/search
rule and named edit/core paths; it is **not owner-approved D-R4 policy**. The
frontend-only Grep trade-off was delegated by the owner, not a new backend
identity guarantee. No Pi bash exception is proposed. Only OpenHands implements
the synthesized-false provenance correction here; the other gaps remain item ②.

The owner-approved amendment file is not edited. Existing D-R4's literal rule
(recorded exit beats Error text, explicit errors still count) remains satisfied;
the replacement makes its missing-field/provenance boundary explicit.
