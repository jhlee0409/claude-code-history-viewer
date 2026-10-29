# TR1c observed public-message fixtures

`public-results.json` contains actual JSON responses from both
`load_provider_messages` and `load_provider_messages_paginated` (offset 0,
limit 500). It is not a handwritten mock API payload.

- Frontend worktree base: `7fe48e147da92363cbbf65a946069f572e894811`.
- Backend source: parity `git diff 859124ef 7fe48e14 -- src-tauri Cargo.lock`
  is empty. Reused #749 server SHA-256:
  `f1a80556c9f4da2e5d2fd441a7ec72e3b68b37a6b29390b9bd500d1598b74ad3`.
- Dataset SHA-256: `5b192235aae478b717ef3b4bfdbee386ea277972f09016a65529d0137a27d97a`.
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

Only eight dispatcher IDs have this raw-positive normalized matrix. The test
pins the other 23 IDs as explicit fixture gaps, not unsupported providers.
The matrix in `tr1c.preservation.test.tsx` mutates these normalized blocks for
component-state ordering controls; those mutations are not claimed as HTTP
observations. Pi `sourceExecution` remains a separate system-message envelope,
not a synthesized tool call/result or a standard schema for opaque `details`.
