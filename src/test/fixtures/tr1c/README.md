# TR1c observed public-message fixtures

`public-results.json` contains actual JSON responses from both
`load_provider_messages` and `load_provider_messages_paginated` (offset 0,
limit 500). It is not a handwritten mock API payload.

- Frontend worktree base: `7fe48e147da92363cbbf65a946069f572e894811`.
- Backend source: parity `git diff 859124ef 7fe48e14 -- src-tauri Cargo.lock`
  is empty. Reused #749 server SHA-256:
  `f1a80556c9f4da2e5d2fd441a7ec72e3b68b37a6b29390b9bd500d1598b74ad3`.
- Dataset SHA-256 (31-ID combined bundle):
  `d119baa5b622cd1ee38be8fc86e1bd49f8c2b2d86b1f82b195934b7287231c0b`.
  The 32nd ID, `hermes`, was captured later from its own pinned server; see
  [Hermes addition](#hermes-addition). The 33rd, `qoder`, likewise; see
  [Qoder addition](#qoder-addition).
- Isolated HOME under the owning worktree's ignored `scratch/tr1c/raw-home`.
  Absolute fixture paths in responses are retained, not user-history paths.

## Source and normalization recipe

Read the committed raw fixtures under `src-tauri/tests/fixtures/`:

| Dispatcher IDs | Raw source | Store / public route |
|---|---|---|
| claude | tool-result-metadata.jsonl | `.claude/projects/fixture/evidence.jsonl` |
| codex, openinterpreter | tool-result-metadata-codex-structured.jsonl | each provider's own `sessions/rollout-evidence.jsonl` |
| openhands | tool-result-evidence-openhands.json | `.openhands/sessions/evidence/events/{ordinal}.json` |
| opencode | tool-result-evidence-opencode.json | default `.local/share/opencode/storage/{session,message,part}` JSON store |
| kilo | same OpenCode-core parts | default `.local/share/kilo/kilo.db`, the schema/seed in `providers/kilo.rs::test_support::create_db` and `commands/provider_evidence_tests.rs::opencode_fixture` |
| pi, ompi | tool-result-evidence-pi.jsonl | `.pi/agent/sessions/--fixture--` / `.omp/agent/sessions/--fixture--` |

Set up these exact source stores (the same seed as the Rust evidence tests),
start the pinned server with isolated HOME and `--serve --no-auth --no-watch`,
POST the two command names under `/api/` with `{provider, sessionPath,
offset:0, limit:500}` and retain decoded responses unmodified. The owning task's
`scratch/tr1c/{setup-fixtures.py,normalize.mjs,sessions.json}` and per-command
HTTP receipts preserve this run. Native/IPC execution was not repeated here.

## Added public-provider inventory

All **33 current dispatcher IDs** have observed, nonempty message responses.
Only **26 IDs / 80 blocks** are tool-result-positive. These are actual server
responses over repository-authored parser fixtures, not live user histories or
independent production captures. The original eight response objects above are
unchanged; the added 25 contribute 85 messages and 20 tool-result blocks.

`added-provider-inventory.json` records each added ID's message/call/result
counts, source file:line and exact source-slice SHA-256, shared-family/storage
limitations, fallback and result-gap reason, and a canonical response SHA-256
(recursively sorted object keys, original array order, UTF-8 JSON without spaces).
The contract pins these hashes, values, identities and pagination totals; the
component suite pins opened message text in recorded order and exact output
bytes. Read/search outcomes retain the shared family rule; a process result
without source exit evidence remains unknown, not successful.

| Added result-positive IDs | Native source fixture / storage |
|---|---|
| amazonq, kiro | Amazon Q literal in native Q/Kiro SQLite envelopes; shared fixture, not independent Kiro upstream capture |
| cline | Independent parser literals composed as ui_messages |
| codebuddy | Independent JSONL cases; includes intentional orphan toolu_y |
| copilot | CLI event literals |
| crush, goose | Native SQLite rows with unmodified content literals |
| cursor | Native composer/bubble SQLite envelope; no missing timestamp repaired |
| forgecode | Native conversation/context SQLite envelope; unmatched result ID kept |
| gemini, qwen | Native JSONL headers and parser records |
| grok, vibe | Native session directories and parser records |
| hermes | Native `state.db` sessions/messages rows (OpenAI-style `tool_calls` + `role = 'tool'` result) |
| qoder | Committed Claude Code-format transcript `tests/fixtures/qoder/cli-session-1.1.84.jsonl` (tool_use + `is_error` tool_result) |
| kimi | Committed sessions/project-hash/session-1 files |
| zcode, zed | Native SQLite parts/thread records; Zed uses test-supported JSON layout |

The seven no-result controls are **not certified tool-result support**:

| ID | Observed fallback / gap |
|---|---|
| aider | Markdown text and edit prose only, not an execution result |
| antigravity | CLI planner/search call plus text, no result; desktop RPC branch not certified |
| continue | SESSION_A toolCallStates does not supply a result record |
| cursor-agent | Raw id-less result/command output flattened to assistant text by the public parser; not repaired |
| llm | Native SQL prompt/answer text only |
| pearai | Same Continue-family SESSION_A limitation, not independent evidence |
| trae | Native ordinary chat fixture only; no helper tool-plan injected |

### Hermes addition

Captured after the 31-ID bundle, with the same recipe, for #665:

- Backend source: commit `173d55dd` (`src-tauri` at that commit); debug
  `cargo build --features webui-server` server SHA-256
  `b55d62d8f72025d858132fb1063c74fcb4495b342fcdd185857d092a0d5b5242`.
- Store: a fresh isolated HOME with `HERMES_HOME` unset, so the default root
  `~/.hermes/state.db`. Seeded verbatim from `providers/hermes.rs` tests:
  `MODERN_SCHEMA` (schema v30+ column subset), `insert_session` and
  `seed_tool_session` rows (user prompt, assistant reasoning + `terminal`
  `tool_calls`, `tool` result row, final answer). Not a live Hermes Agent
  capture.
- Session path `hermes://default::dir:/work/app#s-tools`, served with
  `--serve --no-auth --no-watch --host 127.0.0.1`. Decoded HTTP bodies:
  `load_provider_messages` SHA-256
  `7c98630dfc8e9dae84db470489e1cd758c807cd5e1e4a3619f4bdfb98d379f76`,
  `load_provider_messages_paginated` SHA-256
  `2a578fcf7f15c915033c927580ab601e9868727dba3dce3db22d486fc283392b`.
  They were added to `public-results.json` unmodified (the file keeps its
  two-space JSON layout); the inventory row records the source slices.
- The four stored rows come back as three messages: the public loader folds
  the `tool` row's result into the assistant message that made the call.
  Hermes stores no tool error flag, so `is_error` is the parser's `false`; the
  `exit_code` stays inside the raw tool text and the process verdict is
  `unknown`.

### Qoder addition

Captured after the Hermes addition, with the same recipe, for #339:

- Backend source: worktree `feat/provider-qoder` on `c74795be` plus the
  provider; debug `cargo build --features webui-server` in a private target
  directory, server SHA-256
  `566d24c997bd2331604e4b23e9b67e022647d6a9633bfe8cf146b5beba456cbf`.
- Store: a fresh isolated HOME (`scratch/`, `QODER_CONFIG_DIR` unset), so the
  default `~/.qoder/projects`, holding the committed fixture verbatim at
  `-Users-dev-work-qoder-demo/5a4669b0-9c94-4e9a-a6fb-c1967797bb56.jsonl`.
  The fixture mirrors a sanitized Qoder CLI 1.1.84 transcript
  (junhoyeo/tokscale#1609); it is not a live Qoder capture.
- Served with `--serve --no-auth --no-watch --host 127.0.0.1`. Decoded HTTP
  bodies: `load_provider_messages` SHA-256
  `98c8789e959d1b1301946841bb29268c98d67cb3a785fb4c8e5af9f41bcfaf6a`,
  `load_provider_messages_paginated` SHA-256
  `0e6abbd167ba7526b97e948f5578d1e2e0c05f4887a92fe537ab4273e94d0504`, added
  unmodified (two-space layout).
- Seven transcript messages come back as six: the public loader folds the
  tool_result into the assistant message that made the call. The result's
  `is_error: true` is Qoder's own flag, so the process verdict is `failed`;
  Qoder records no exit code.

### CodeBuddy nondeterminism, not equality

Both exact API responses remain in the bundle. Only message index 1,
UUID `codebuddy-fcr-3` (orphan `toolu_y`), differs: full timestamp
`2026-10-29T13:36:11.398384+00:00`, paginated timestamp
`2026-10-29T13:36:11.399743+00:00`. Its source literal has no timestamp;
`providers/codebuddy.rs` generates the fallback at load time. The test pins this
single field difference and compares every other message field, including all
other timestamps. Strict full/page equality is **false** for CodeBuddy, not
silently manufactured. A fresh isolated normalization reproduces only this
same per-command timestamp difference; it does not rewrite the captured bundle.

### Reproduction and provenance

The collection's `scratch/tr1c/fixture-expansion/` contains `catalog.py`,
`prepare.py`, `normalize.mjs`, `verify-report.py`, full HTTP receipts, source
catalog, materialized-store hashes and response receipt hashes. Candidate bundle
SHA-256 is `7687ef7b6e053d823715e61e2b656232c4ee73f96a3fb74857311ed4d7c759fe`;
`candidate-result-positive.json` is its exact 16-ID subset, not extra data.
All 46 decoded receipt hashes were checked before integration.

To reproduce without overwriting historical receipts, copy those four scripts
to a **new sibling directory** under `scratch/tr1c/` (their relative imports and
root discovery require that depth). `normalize.mjs` resolves output relative to
its own script location, not a hard-coded collection path. From the worktree:

```sh
python3 scratch/tr1c/<new-dir>/catalog.py
FIXTURE_HOME_NAME=raw-home python3 scratch/tr1c/<new-dir>/prepare.py
env -u NODE_ENV node scratch/tr1c/<new-dir>/normalize.mjs
python3 scratch/tr1c/<new-dir>/verify-report.py
```

Use Node 22 and a fresh direct-child HOME; prepare refuses an existing HOME.
Part3 exercised all four scripts in `part3-reproduction/`, using the pinned
server above after backend parity. All 23 full/page responses matched the
original capture except the two expected values of that one CodeBuddy fallback
timestamp. Absolute native storage identifiers and array order were retained.
This is HTTP/public-contract evidence, not native IPC or all-provider visual QA.

The matrix in `tr1c.preservation.test.tsx` mutates normalized blocks for
component-state ordering controls; those mutations are not HTTP observations.
Pi `sourceExecution` remains a separate system-message envelope, not a synthesized
tool call/result or a standard schema for opaque `details`.

### Cursor ACP addition

Captured for #576 with the same recipe:

- Server: `cargo build --features webui-server` of the `feat/provider-cursor-acp`
  working tree (SHA-256 `5e6c1fc5aa4cd5ec01e87b44d216e6c77dcd63d30bb25828f11f31e3f653066c`).
- Store: a fresh isolated HOME holding `~/.cursor/acp-sessions/00000000-0000-4000-8000-00000000000a/`
  (`meta.json` cwd `/work/app`, `store.db`) seeded as `providers/cursor_acp.rs`
  `seed_tool_session` does (system prompt, `<user_info>` context, prompt,
  reasoning + `Glob` call, `tool` result, answer; turn and tool-step records for
  the times). Not a live Cursor ACP capture.
- Session path `cursor-acp:///work/app#00000000-0000-4000-8000-00000000000a`,
  served with `--serve --no-auth --no-watch --host 127.0.0.1`. Decoded HTTP
  bodies: `load_provider_messages` SHA-256
  `49f9aede36d31b21211b59a77366dc7307d0cfd20b3365ebd5d2678356fc26f5`,
  `load_provider_messages_paginated` SHA-256
  `564b5797f153dbf294e54eee32382ca5b8658eb00589cbe585a37f5a23d99c20`.
- Five stored messages come back as four: the `<user_info>` context is dropped
  and the public loader folds the tool result into the assistant message that
  made the call. No exit code is stored, so the process verdict is `unknown`.
