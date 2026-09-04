# Spec: ompi-schema-drift

- Status: Active — review remediation
- Created: 2026-09-04

## Problem / goal

Original ask: “1번 부터 차근차근 진행 하면서 혹시 로그, 세션구조가 공문 혹은 사람들이 분석해놓게 있는지도 웹리서치해봐줘”

The shared Pi/oh-my-pi parser treats only `message` records as visible. Current
oh-my-pi session v3 also stores an authoritative mutable title, compaction and
branch boundaries, displayable custom messages, and standalone model usage.
Skipped tree entries remain in `parentId` chains, so preserving raw parents
orphaned roughly half of sampled messages and forced the frontend to discard
branch structure. String user content and `developer` messages are also
mis-normalized.

## What "done" looks like

- Current oh-my-pi titles replace stale header/first-prompt summaries.
- Visible transcript records preserve their nearest visible ancestor across
  hidden metadata and render compaction summaries.
- Displayable custom messages are visible; hidden custom messages remain hidden.
- String user content and developer-role content are retained and correctly
  attributed.
- Standalone `model_usage` records contribute to billing stats without appearing
  as transcript cards or conversation-only usage.
- Pi `session_info.name` remains supported by the shared parser.
- Legacy Pi v1 entries receive stable in-memory IDs and parent links; v2
  `hookMessage` roles follow the v3 `custom` semantics.

## Scope

- **In:** `pi.rs`/`ompi.rs` normalization, Pi v1/v2 compatibility, Pi/OMP
  title precedence, visible compaction/branch/custom entries, parent repair,
  stats-only auxiliary usage, compact-boundary rendering, focused Rust/React
  regression coverage.
- **Out:** editing Pi/OMP source logs, decoding OMP blob-backed images, rendering
  extension-specific opaque `custom` state, service-tier history visualization.

## Acceptance

- Focused Rust tests exercise an OMP v3 fixture containing title slot/header/
  title-change drift, hidden ancestry records, compaction, branch summary,
  displayable and hidden custom messages, developer and string user messages,
  and standalone model usage.
- Focused React test proves a compact boundary stays collapsed with its summary
  preview and before/after token counts, then exposes the trigger and full
  summary when expanded.
- A real installed OMP session with those record classes loads through the
  production provider and desktop app without orphaned visible parents.
- Pi v1 fixtures load the full transcript and stats path without writing a
  migrated source file.

## Risks / open questions

- OMP image blocks may use `blob:sha256:*`; this slice preserves an explicit
  placeholder rather than reading and base64-encoding external blob storage.
- Unknown future records remain ancestry bridges and are otherwise ignored.
- Review follow-ups remain for parser peak memory, visible compaction warnings,
  collapsed search matches, inline developer/custom images, and the duplicated
  TypeScript compact-metadata contract.
