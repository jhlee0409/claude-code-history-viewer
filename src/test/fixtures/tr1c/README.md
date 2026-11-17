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

All **31 current dispatcher IDs** have observed, nonempty message responses.
Only **24 IDs / 78 blocks** are tool-result-positive. These are actual server
responses over repository-authored parser fixtures, not live user histories or
independent production captures. The original eight response objects above are
unchanged; the added 23 contribute 76 messages and 18 tool-result blocks.

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
