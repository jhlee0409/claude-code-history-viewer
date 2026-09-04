# Context: ompi-schema-drift

## 0. Resume here

<!-- resume:start -->
- **Original ask (verbatim):** “1번 부터 차근차근 진행 하면서 혹시 로그, 세션구조가 공문 혹은 사람들이 분석해놓게 있는지도 웹리서치해봐줘”
- **Phase / N of M:** Review remediation complete / 5 of 5
- **Files touched:** `src-tauri/src/providers/pi.rs`,
  `src-tauri/src/providers/ompi.rs`, `src-tauri/src/commands/stats.rs`,
  `src/components/messageRenderer/SystemMessageRenderer.tsx`,
  `src/components/MessageViewer/components/ClaudeMessageNode.tsx`,
  `src/utils/searchIndex.ts`, `src/utils/searchWorker.ts`,
  `src/types/core/message.ts`, `src/types/message.types.ts`,
  `src/types/index.ts`, `src/test/SystemMessageRenderer.test.tsx`,
  `src/utils/searchIndex.test.ts`, and this spec triplet.
- **Next action:** None; all five review findings are remediated and verified.
- **Current decisions:** Physical OMP title slot wins; then title change, Pi
  session name, header title, first user text. Only `display:true` custom
  messages render. Hidden records bridge visible parents. Auxiliary model calls
  load only for billing stats. Pi v1/v2 migration occurs in memory and never
  edits source logs. Parsing retains messages plus an ancestry index, not every
  record's `serde_json::Value`. Compaction warnings remain separate metadata
  and visible on collapsed boundaries; hidden summary search matches open the
  boundary ephemerally without changing its persisted expansion state. Inline
  developer and displayed custom content stays as Claude-style text/image
  blocks; only external `blob:` image references degrade to placeholders.
  `CompactMetadata` is the single TypeScript contract for parser output,
  compatibility message types, and rendering.
<!-- resume:end -->

## Working notes

- Installed OMP is `18.1.9`; current local sessions use version 3 JSONL under
  `~/.omp/agent/sessions`.
- Five recent sessions contained 1,566 messages. Of visible-entry parents, 694
  pointed at skipped `custom` records and 23 at other skipped metadata; keeping
  raw parents therefore breaks the normalized tree.
- Observed current OMP-only records include fixed `title`, `title_change`,
  `model_usage`, `compaction`, `branch_summary`, `custom_message`,
  `service_tier_change`, `session_init`, `credential_pin`, and `ttsr_injection`.
- Official sources:
  - https://github.com/can1357/oh-my-pi/blob/main/docs/session.md
  - https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-entries.ts
  - https://pi.dev/docs/latest/session-format
  - https://pi.dev/docs/latest/sessions
- Independent analyses:
  - https://github.com/obra/episodic-memory/issues/148
  - https://github.com/jms830/pi-omp-session-sync
- Shared parser: `src-tauri/src/providers/pi.rs`; OMP registration:
  `src-tauri/src/providers/ompi.rs`; stats dispatch:
  `src-tauri/src/commands/stats.rs`; compact UI:
  `src/components/messageRenderer/SystemMessageRenderer.tsx`.

## Verification evidence

- Installed OMP production-provider smoke:
  `title=Research OMP/pi log and session structure documentation`,
  `visible=467`, `orphans=0`, `compactions=1`, `custom=4`,
  `auxiliary_usage=3`.
- Desktop smoke showed the same authoritative title and a collapsed compaction
  row with `248,137 → 83,914 tokens`; expansion exposed `Trigger: remote` and
  the full summary.
- Focused Rust regressions: 9 Pi parser tests, 1 OMP provider test, and 1 stats
  policy test passed. Focused React test passed. TypeScript project build passed.
- Review remediation #1 reproduced legacy Pi v1 loading at 0 visible messages,
  then passed with 3 visible messages after deterministic in-memory ID/parent
  synthesis and `hookMessage` normalization. Scoped Clippy passed.
- Review remediation #2 replaced full-session JSON DOM materialization with an
  append-order stream and nearest-visible-ancestor index. Pi and OMP parser
  suites, scoped Clippy, and rustfmt passed. The active 5 MB production session
  loaded 951 visible records with zero orphans at 26,279,936-byte peak RSS.
- Review remediation #3 keeps official `compaction.warning` separate from the
  summary, indexes it on both main and worker search paths, and renders it on
  the collapsed boundary. The focused frontend suites passed 20 tests;
  TypeScript typecheck, scoped ESLint, 10 Pi tests, 1 OMP test, Clippy, and
  rustfmt passed.
- Desktop fixture smoke confirmed the collapsed warning, auto-expansion for
  `OMP_HIDDEN_SEARCH_SENTINEL` on the summary's second line, and re-collapse
  after clearing search. The temporary fixture was removed.
- Review remediation #4 routes developer, custom-role, and standalone
  `custom_message` content through `content_blocks()` and renders resulting
  arrays with `ClaudeContentArrayRenderer`. The focused React suite passed 5
  tests; TypeScript typecheck, scoped ESLint, 11 Pi tests, 1 OMP test, Clippy,
  and rustfmt passed.
- Desktop fixture smoke displayed all three inline base64 images with their
  associated text. The temporary fixture was removed.
- Review remediation #5 exports one `CompactMetadata` interface containing
  `trigger`, `preTokens`, `postTokens`, and `warning`; canonical and deprecated
  compatibility message contracts plus `SystemMessageRenderer` all consume it.
  The missing export first failed forced typecheck with `TS2305`, then passed.
- Rust serialization now asserts the exact camelCase `compactMetadata` payload.
  The focused React suite passed 5 tests; forced TypeScript build, scoped
  ESLint, 11 Pi tests, 1 OMP test, Clippy, and rustfmt passed.
