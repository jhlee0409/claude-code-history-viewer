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
| Existing bounded built-in list remains Read/Glob/Edit/Write/WebFetch, plus OpenCode-only list; Grep stays unknown, including raw `grep` | [Existing source table](producer-outcome-ground-truth.md#producer-ids-and-backend-delivered-completion-allowlist), OpenCode b9a39b8; [Kilo registry:274–335](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L274-L335) | Existing provenance suite; raw identity and custom-shape renderer tests |
| Pi writes boolean `isError`; viewer must not fill missing flags | [pi-mono a922830 agent-loop.ts:841–863](https://github.com/badlogic/pi-mono/blob/a92283056d915c758799fcd904948ff0cb42628c/packages/agent/src/agent-loop.ts#L841-L863) | Pi missing/null/string/false/true matrix; shared OMP loader |
| Copilot completion has explicit success boolean | [Copilot SDK 68de1a7a session-events.ts:9938–9951](https://github.com/github/copilot-sdk/blob/68de1a7afe4bc9e7435d185825043bd9dc9c47cf/nodejs/src/generated/session-events.ts#L9938-L9951) | Copilot absent/true/false converter; renderer flag matrix |
| Kimi Code optional result flag survives replay | [Kimi Code a2afdbc7 loopEventFold.ts:66–73](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/agent/contextMemory/loopEventFold.ts#L66-L73), [:192–205](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/agent-core-v2/src/agent/contextMemory/loopEventFold.ts#L192-L205) | Full journal fold with absent/false/true; renderer flag matrix |
| Gemini **explicit** `status:success` establishes no-error, not absent or arbitrary status | [Gemini CLI 6814e00d chatRecordingTypes.ts:54–60](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/core/src/services/chatRecordingTypes.ts#L54-L60); [tool-executor.ts:150–163](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/core/src/scheduler/tool-executor.ts#L150-L163), [:480–520](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/core/src/scheduler/tool-executor.ts#L480-L520) | Missing-status Rust regression; existing explicit success tests; unchanged real verdicts |

Raw IDs, when present, must agree with the expected display mapping. MCP `grep_*`,
case aliases, unknown names, Kilo list, and **all Grep** stay unknown on completion
alone. Legacy responses without raw identity retain the prior bounded
Read/Glob/Edit/Write/WebFetch (and OpenCode list) policy. Raw identity is not
built-in provenance; that existing policy has the class limitation below.

## Same-id custom tools: owner decision

**CONTRADICTED:** an exact raw tool ID does not authenticate a built-in.
**Owner decision 2026-11-01: option C.** Keep the existing name-based
Read/Glob/Edit/Write/WebFetch and OpenCode-only list no-error policy, but rule out
stored results matching the default custom-tool wrapper shape. Grep stays unknown.
This is a derived exclusion, not proof that a built-in ran, and not a new producer
flag. The frontend computes it from the already-delivered full `part.state` in
`toolUseResult`; no backend marker, schema change or raw-record rewrite is needed.

- OpenCode: exact empty `title:""` and empty metadata object `{}` → completion
  alone is unknown (`registry.ts:55–59`, linked below).
- Kilo: exact empty `title:""` and a metadata object whose keys are a subset of
  **`truncated`, `outputPath`, `approval`** → completion alone is unknown.
  `registry.ts:216–229` supplies truncation keys for string custom results;
  `tool/tool.ts:133–147` also supplies them for built-ins; `processor.ts:274–277`
  merges permission approval. Neither truncation nor approval proves origin.
- Require actual empty title and object metadata, not absent/null/malformed fields.
  Missing fields retain the bounded compatibility policy; explicit error states
  still fail. Only the completion-derived no-error inference is excluded.
- This exclusion applies per result, at normalization, to both raw-ID and legacy
  delivered-name paths. One genuine sibling cannot certify a custom-shaped result.
  Explicit producer flags and process exits keep their separate existing rules.

### Collision resolution (not merely registry membership)

- OpenCode **b9a39b816c92592e824c68cdc9a48acf7717e2a2** loads config
  `tool/*.{js,ts}` using the file basename for a default export, and plugin
  `tool` keys directly ([registry.ts:25–42](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/registry.ts#L25-L42)).
  Built-ins precede custom entries; `Promise.all` preserves that array order
  ([registry.ts:75–107](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/registry.ts#L75-L107)).
  The session consumes each entry with `tools[item.id] = tool(...)`
  ([prompt.ts:527–538](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L527-L538)).
  **The later same-id custom entry wins**, not the built-in.
- Kilo **0a9faeff69fff8712da184ee5188bb7985c6f057** independently loads
  `{tool,tools}/*.{js,ts}` and plugin keys
  ([registry.ts:244–264](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L244-L264));
  `all()` returns built-ins then custom, and `tools()` filters in that order
  ([registry.ts:343–345](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L343-L345),
  [:389–446](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L389-L446)).
  Session prompt calls `SessionTools.resolve`
  ([prompt.ts:1774–1792](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/session/prompt.ts#L1774-L1792)),
  whose loop assigns `tools[item.id]`
  ([session/tools.ts:176–225](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/session/tools.ts#L176-L225)).
  **The later same-id custom entry wins here too.** The intervening visibility
  pass preserves order and does not deduplicate these IDs
  ([kilocode/tool/registry.ts:424–447](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/kilocode/tool/registry.ts#L424-L447)).
  Kilo has an in-memory `Builtin` symbol
  ([sandbox/network.ts:78–85](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/kilocode/sandbox/network.ts#L78-L85)),
  but it is on the executable tool object, not its stored result. The completion
  writer copies result title/output/attachments and merges result metadata with
  permission `metadata.approval` recorded while running into completion state
  ([processor.ts:271–289](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/session/processor.ts#L271-L289)).

### Stored shapes: candidates, not authentication

All references in this table are pinned to the two immutable commits above,
**not a guarantee for other producer versions**. Each allowlisted built-in return
has either a non-wrapper metadata key or a non-empty webfetch title, so none
succeeds with its provider's default custom shape at these pins. The exclusion
can conservatively make a genuine built-in unknown on other versions. File-relative
titles may be empty at the worktree root; empty title alone is not an exclusion.

| Tool ID | OpenCode success fields / source | Kilo success fields / source |
|---|---|---|
| `read` | relative title; metadata `preview` ([read.ts:28](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/read.ts#L28), [:70–75](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/read.ts#L70-L75), [:115–121](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/read.ts#L115-L121)) | relative title; `preview`, `truncated`, `loaded`; file/directory branches also `display` ([read.ts:211](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/read.ts#L211), [:271–295](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/read.ts#L271-L295), [:332–336](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/read.ts#L332-L336), [:371–387](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/read.ts#L371-L387)) |
| `glob` | relative title; `count`, `truncated` ([glob.ts:56–63](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/glob.ts#L56-L63)) | same keys ([glob.ts:100–107](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/glob.ts#L100-L107)) |
| `grep` | pattern title; `matches`, `truncated`, including zero matches ([grep.ts:38–44](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/grep.ts#L38-L44), [:80–85](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/grep.ts#L80-L85), [:107–114](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/grep.ts#L107-L114)) | same keys; missing/inaccessible paths can return normally, so no-error does not mean a target existed ([grep.ts:34–41](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/grep.ts#L34-L41), [:64–76](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/grep.ts#L64-L76), [:117–126](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/grep.ts#L117-L126)) |
| `list` | relative title; `count`, `truncated` ([ls.ts:101–108](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/ls.ts#L101-L108)) | no built-in; remains unknown |
| `edit` | relative title; `diagnostics`, `diff`, `filediff` ([edit.ts:130–138](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/edit.ts#L130-L138)) | same keys ([edit.ts:230–238](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/edit.ts#L230-L238)) |
| `write` | relative title; `diagnostics`, `filepath`, `exists` ([write.ts:63–70](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/write.ts#L63-L70)) | same keys plus `diff`, `filediff` ([write.ts:104–113](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/write.ts#L104-L113)) |
| `webfetch` | URL/content-type title; metadata `{}` ([webfetch.ts:94–140](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/webfetch.ts#L94-L140)) | URL/content-type title; metadata `{}` ([webfetch.ts:112–155](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/webfetch.ts#L112-L155)) |

OpenCode's `fromPlugin` normally returns `title:""`, `metadata:{}`
([registry.ts:47–63](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/tool/registry.ts#L47-L63)).
However, the session invokes `tool.execute.after` on the result before returning it
([prompt.ts:550–589](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/session/prompt.ts#L550-L589));
`Plugin.trigger` hands the same mutable output to every hook
([plugin/index.ts:53–67](https://github.com/anomalyco/opencode/blob/b9a39b816c92592e824c68cdc9a48acf7717e2a2/packages/opencode/src/plugin/index.ts#L53-L67)).
Thus the shape cannot prove built-in provenance, but the unchanged default
custom shape can rule out a pinned built-in success.

Kilo is a stronger direct counterexample: its wrapper explicitly accepts custom
`result.title` and arbitrary `result.metadata`, then adds `truncated` and possibly
`outputPath` ([registry.ts:215–229](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L215-L229)).
A custom `grep` can return the **exact** built-in `matches:0,truncated:false`
shape. The committed real-renderer regression covers that case.
Kilo's built-in `Tool.wrap` also adds `truncated` (and `outputPath` on truncation)
when the tool did not already supply it
([tool.ts:133–147](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/tool.ts#L133-L147)).
Those wrapper keys cannot positively authenticate a built-in; `approval` is
not authentication either, because custom tools share the ask bridge
([registry.ts:209–214](https://github.com/Kilo-Org/kilocode/blob/0a9faeff69fff8712da184ee5188bb7985c6f057/packages/opencode/src/tool/registry.ts#L209-L214)).
Every built-in-looking candidate in the table is forgeable. **Cannot prove a
built-in ran; can rule out the default custom shape.** Object-returning Kilo
custom tools and OpenCode `tool.execute.after` hooks may still look built-in and
receive name-based success. Option C reduces that exposure; it does not eliminate
false success or recover absent provenance. No persisted derived marker is emitted.

The viewer already passes all of `part.state`, including title and metadata,
through `result_evidence::attach` to the result's own `toolUseResult`
(`providers/opencode.rs`, shared by `kilo.rs`). The public-command state-preservation
and new unstripped raw-ID tests cover JSON/SQLite OpenCode and SQLite Kilo,
full and paginated responses. This is not a backend field-loss problem.

Option C retains success badges and success-gated folding for genuine
allowlisted built-in shapes, while default custom-shaped results remain unknown
and do not fold. Kilo list has no pinned built-in and remains unknown regardless
of shape; Grep remains unknown even with raw `grep` and built-in-looking metadata.
Regression: `opencodeCustomShape.test.tsx` exercises both providers through
`ClaudeContentArrayRenderer`, including error/legacy/malformed/sibling controls.


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

Fix1 reran the counts/flags-only backend-loader comparison against exact develop
`a611a0f099c88d4ec51643237021ec4119cd624c`: 214 sessions, 18,229 results,
zero outcome/reason changes and zero loader errors (OMP 28/14,732; Gemini
16/243; Cursor 170/3,254; Zed 0/0). This is not a new local OpenCode/Kilo
observation or an HTTP smoke. The fix1 regression was first run on `d124ae2e`:
three actual renderer AssertionErrors, then 42/42 focused tests passed after
removing the new raw-grep completion exception.

Fix2 (owner option C) first ran on `3e1b8935d8cc8727bb5a7b834f60d51290c316b6`:
31 regression cases failed with actual renderer/pure-outcome AssertionErrors;
51 controls passed. The completed source-shaped suite also covers folding and
raw immutability. A synthetic SQLite public-command probe then verified exact
stored state through full and paginated responses and the actual renderer:
35 rows per provider per route (140 rendered checks), including default custom,
truncation/approval variants, genuine shapes, errors, Grep and Kilo list.

Fresh read-only backend-loader runs against the same pinned develop and fix2
again loaded 214 sessions / 18,229 results with zero loader errors and zero
outcome/reason changes. No new local OpenCode/Kilo evidence is claimed. Reproduction
scripts, tested diffs and counts-only receipts: `scratch/be2/fix2/`. Temporary
probe registrations and the detached base worktree were removed before gates.
