# Backend outcome evidence (item ③b)

This extends the historical frontend-only [outcome contract](producer-outcome-ground-truth.md).
The owner-approved D-R4 scope for this change is: prose never decides; interruption
first; error flag/code, then recorded exit; process flags do not manufacture exits.
Only the named producer conventions below establish non-process no-error.

## Wire contract

- OpenCode and Kilo `tool_use.rawToolName` is the exact producer `part.tool` value,
  alongside the existing capitalized `name`. The shared loader preserves both.
  An absent source name is null rather than an invented raw ID.
- `tool_result.is_error_source: "derived"` marks viewer-computed error comparisons.
  A derived false cannot establish producer no-error. A derived true retains the
  existing positive error mapping. The raw source record is not rewritten.
- Pi/OMP, Crush and Zed copy the original error field if present, including
  null/false/true/non-boolean values, and omit it if absent. No missing false default.
- Copilot maps an explicit boolean `success` to `is_error: !success`; missing or
  malformed success does not produce a boolean. Kimi Code preserves both boolean
  values of `isError`, without defaulting absence.
- Existing older OpenHands responses retain the frontend provider-specific guard.
  Older cached Pi responses cannot retroactively recover lost provenance; reload
  sessions through the updated backend. No cache migration is claimed.

## Ground truth (pinned producer source, not viewer fixtures)

| Rule | Producer source | Regression |
|---|---|---|
| OpenCode exact built-in `grep`, normal return vs throw | [OpenCode b9a39b8 grep.ts:16–48](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/grep.ts#L16-L48); [prompt.ts:1115–1160](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L1115-L1160) | Rust raw-name matrix; renderer built-in/MCP/alias negatives |
| Kilo independently defines exact `grep`, maps returns to completed and errors to error | [Kilo 0a9faeff grep.ts:22–76](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/grep.ts#L22-L76); [processor.ts:271–310](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/session/processor.ts#L271-L310) | Shared Rust loader; real Kilo renderer route |
| Existing bounded built-in list remains Read/Glob/Edit/Write/WebFetch, plus OpenCode-only list; new Grep success requires raw `grep` | [Existing source table](producer-outcome-ground-truth.md#producer-ids-and-backend-delivered-completion-allowlist), OpenCode b9a39b8; [Kilo registry:274–335](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L274-L335) | Existing provenance suite; new raw identity tests |
| Pi writes boolean `isError`; viewer must not fill missing flags | [pi-mono a922830 agent-loop.ts:841–863](https://github.com/badlogic/pi-mono/blob/a92283056d915c758799fcd904948ff0cb42628c/packages/agent/src/agent-loop.ts#L841-L863) | Pi missing/null/string/false/true matrix; shared OMP loader |
| Copilot completion has explicit success boolean | [Copilot SDK 68de1a7a session-events.ts:9938–9951](https://github.com/github/copilot-sdk/blob/68de1a7afe4bc9e7435d185825043bd9dc9c47cf/nodejs/src/generated/session-events.ts#L9938-L9951) | Copilot absent/true/false converter; renderer flag matrix |
| Kimi Code optional result flag survives replay | [Kimi Code a2afdbc7 loopEventFold.ts:66–73](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/agent/contextMemory/loopEventFold.ts#L66-L73), [:192–205](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/agent/contextMemory/loopEventFold.ts#L192-L205) | Full journal fold with absent/false/true; renderer flag matrix |
| Gemini **explicit** `status:success` establishes no-error, not absent or arbitrary status | [Gemini CLI 6814e00d chatRecordingTypes.ts:54–60](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/core/src/services/chatRecordingTypes.ts#L54-L60); [tool-executor.ts:150–163](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/core/src/scheduler/tool-executor.ts#L150-L163), [:480–520](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/core/src/scheduler/tool-executor.ts#L480-L520) | Missing-status Rust regression; existing explicit success tests; unchanged real verdicts |

Raw IDs, when present, must agree with the expected display mapping. MCP `grep_*`,
case aliases, unknown names, Kilo list, and missing-identity Grep stay unknown on
completion alone. Legacy responses without raw identity retain the prior bounded
Read/Glob/Edit/Write/WebFetch (and OpenCode list) policy; this change does not claim
raw identity for old payloads. No broader tool registry is newly certified.

## Provider-default audit

Audit baseline: `4464440587d2555a16b90a1b8e9ae3e3b939efd9`. All 42 Rust files under
`src-tauri/src/providers/` were inventoried, including shared adapters. Source
lines below refer to that immutable baseline (unless labelled new).

| Provider / baseline location | Finding / handling |
|---|---|
| Pi/OMP `pi.rs:1090–1093,1113` | Missing `isError` default false; now exact optional copy. |
| Crush `crush.rs:505,510` | Missing `is_error` default false; now exact optional copy. |
| Zed `zed.rs:365,370` | Missing `is_error` default false; now exact optional copy. |
| Gemini `gemini.rs:676–685` | Missing status default success and comparison false; removed status default, mark non-success false derived. Explicit success remains producer evidence (pinned above). |
| Cursor `cursor.rs:1089–1092,1115` | Missing status default completed and comparison false; removed default, mark comparison derived. No new success convention asserted. |
| Goose `goose.rs:421–447` | Missing/non-error status produces false, even opaque MCP results; mark derived. No new MCP success convention asserted. |
| Z Code `zcode.rs:465–471` | Every non-failed/error status, including absent, produces false; mark derived. |
| OpenHands `openhands.rs:331–334` | Observation comparison false is not recorded no-error; mark derived, retaining positive error mapping and legacy frontend guard. |
| ForgeCode `forgecode.rs:890,1472–1479` | `extract_bool` uses `any()`, silently false for absent/unrecognized aliases; mark derived unless a boolean alias is present. Existing positive mappings retained. |
| Antigravity `antigravity.rs:354–359` | Hardcoded false on a **tool_use**, not a result; removed needless synthesized flag. No verdict change. |
| Copilot CLI `copilot_cli.rs:1079,1092–1095` | Missing success default true was not emitted as false, but explicit true was dropped; now map only explicit booleans. |
| Kimi Code `kimi_code.rs:863,946,1200–1202` | Parsing preserves optional booleans, serialization dropped false; now emit both. `:1009` interruption recovery is an existing synthetic **true**, not a fabricated success; unchanged. |
| OpenCode/Kilo `opencode.rs:1499–1500,1531`; `kilo.rs:181` | Positive error only; no synthesized false. `step-finish` completed fallback is presentation text, not tool state/outcome evidence. Raw name now preserved. |
| CodeBuddy `codebuddy.rs:620,628–629` | Error-status comparison emitted only when true; no synthesized false delivered. Unchanged. |
| Cline SDK `cline_sdk.rs:501` | **Test fixture**, not production synthesis. Production preserves Claude-style blocks; no fix needed. |
| Codex `codex.rs:1625,1648` | Application progress statuses started/completed are not tool-result status evidence. Recorded exits are separately parsed/authenticated; unchanged. |
| Remaining files | No synthesized tool-result is_error/status/exit defaults found: aider, amazon_q, antigravity_cli, antigravity_state_sync, claude, cline, codex/evidence, continue_dev, copilot, cursor_agent, grok, kimi (legacy), kiro, llm, mod, openinterpreter, pearai, q_conversation, qwen, result_evidence, scan_report, trae, vibe, vscode. Fork adapters use the shared loaders audited above. No provider creates a tool-result `-1` exit default. |

Conservative derived-false handling is a provenance repair, not certification of
undocumented provider status conventions. Original flags/content remain data.

## Read-only local evidence

The actual backend discovery/session/message loaders ran before and after against
local records, then a counts/keys-only projection was judged by the actual frontend
`toolOutcome`. Calls are associated within each session; no private output, paths,
identities, or prompts are retained in the receipts. This is a backend-loader
probe, not an HTTP-route smoke test.

| Provider | Sessions | succeeded before → after | failed | unknown | interrupted |
|---|---:|---:|---:|---:|---:|
| OMP | 28 | 6399 → 6399 | 427 → 427 | 7906 → 7906 | 0 → 0 |
| Gemini | 16 | 146 → 146 | 17 → 17 | 80 → 80 | 0 → 0 |
| Cursor | 170 | 0 → 0 | 0 → 0 | 3254 → 3254 | 0 → 0 |
| Zed | 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

No changed verdicts, including by-tool distributions and row-by-row comparison
of all 18,229 results using the baseline frontend against the baseline backend
projection and the new frontend against the new backend projection. Zero existing
success/failure regressions. All loaders returned zero errors. Zed's real DB contains zero
threads (read-only SQL count). Gemini source records have explicit success 226 and
error 17; no absent status. Pi has no local sessions; OMP is not presented as Pi.
OpenCode, Kilo, Copilot CLI, Kimi legacy and Kimi Code have no local session records
(Kimi Code root contains only config). Their new semantics rely only on the pinned
source above, not invented record counts. Z Code, Goose, Crush and OpenHands have
no local stores in the inspected default locations.

RED receipts were real Rust assertion failures (nine initial cases, plus Kimi and
ForgeCode) and twelve actual renderer AssertionErrors on baseline code. A first
Rust run had a test-call argument compile error, corrected before recording RED;
it is not counted as behavioral RED. The opt-in read probe initially hit the
intentional missing-CCHV_TEST_HOME guard, then ran read-only with an explicit home;
normal suite runs do not receive that override.
