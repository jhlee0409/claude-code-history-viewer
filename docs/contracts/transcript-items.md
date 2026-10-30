# Pure transcript item contract (TR3 child 1)

`buildTranscriptItems(flattened, membership, options)` consumes the **existing** `flattenMessageTree` result. It is not connected to `useMessageVirtualization` in this child. No existing render, navigation or capture path changes.

## Inputs and ownership

- `TurnMembership` is a read-only map of message UUID to ordinal or null. Missing and null both mean unknown. Every row gets its own lookup; no row inherits a numbered membership from the preceding display row.
- `turnStartUuids` optionally projects the turn index's ordinal to canonical start UUID. It outranks loaded-row heuristics. Lookup hits alone contain no start UUID, so without this metadata a partial turn's ID is provisional (`turn:<first-loaded-uuid>`). Its **block IDs do not change** when membership or start metadata arrives. This resolves the difference between EV1a's index and lookup response shapes without adding a backend requirement.
- Known memberships group only contiguous display segments. Unknown memberships use unnumbered temporary groups, divided by `isTurnStart`. An assistant-first segment is partial. The predicate excludes metadata, generated caveats/output, result-only records and main-view sidechains; subagent user prompts start turns. A slash-command invocation is a user turn, unlike its generated output (consistent with the existing prompt classifier). EV1a must use the same predicate table, including attachment-plus-result forks.
- Ordering, command/stdout merging, rootless-page recovery, task/progress/operation grouping, date dividers and capture placeholders remain owned by flattening. Existing content pairing remains owned by `contentEntries`. Blocks retain position-free renderer source data; consumers must not derive new item positions from an old `originalIndex`.
- Result evidence is read only through `toolOutcome`, including the legacy single-call envelope adapter. Fallback/media/unknown values and grouped-row metadata stay available to the existing renderers.

## Output

`items` contains turn fragments plus unchanged-source divider/hidden items. Turns contain a source-ordered block list and a summary of calls, distinct recorded file targets, failed verdicts and unknown/unverified verdicts. Results paired into a call are source-position aliases, not extra calls.

A fragment has at most 24 display blocks; with `viewportHeight` and `estimateBlockHeight` it also splits before a block that would exceed three viewports. An individually oversized block remains indivisible. The first fragment owns `turnStart`; every fragment has part/parts and loaded-feed `posinset`. `setsize` is fragment count only when `complete` is explicitly true, otherwise -1. These fields are **not DOM/a11y integration**.

Only consecutive read/search calls whose adapter returns completed/succeeded fold, and only within one fragment of one turn. All other blocks break the run. The call ID is its original `${uuid}#${contentIndex}`; a run is `run:<first-block-id>`; a fragment is `<turn-id>:<first-block-id>`. Paired-result IDs also resolve to their call.

## Targets and expansion

`itemIndexForTarget(model, {messageUuid, contentIndex?} | {blockId})` is the sole public target resolver. It uses direct lookup maps, defaults to the message's first block, returns null when unavailable, and returns the owning displayed block plus the IDs required to reveal a folded run. It never mutates a model. `revealTargets` applies that same entry for search, anchors, focus and selection; capture mode opens every run. Hidden UUIDs are unavailable until the existing hide path restores them.

Expansion is retained by **all source block IDs** in a run. Pass the previous model to preserve expansion across splits/merges. An explicitly supplied empty `expandedBlockIds` closes previous expansion. Capture's all-open projection is temporary: it does not add run members to the retained set, so exiting capture with only `previous` restores the prior expansion. Explicit IDs and `revealTargets` (including result aliases) remain retained; outside capture, an expanded run propagates retention to all its members.

## Incremental ownership

Pass immutable message/group inputs and `previous` for incremental extraction. The row cache uses message UUID plus a structural renderer signature, excluding only top-level `originalIndex`. It includes merged command content, group entries/registries and outcome evidence, not the object references recreated by flattening. Unchanged renderer sources reuse block objects; unchanged turn segments reuse turn objects and their summaries by identity, including when preceding pages shift positional indexes. Changed content or group data invalidates blocks; membership/start metadata changes invalidate affected turns even when source blocks remain reusable. Input/signature scans are linear in loaded source data and lookup scans in loaded blocks; this is not a constant-time append claim. Fragment coordinates/lookup positions and expansion projections are rebuilt without mutating the previous model.

Provisional turn IDs and their fragment IDs are **not durable anchors**. Later wiring must restore scroll, focus, search, capture and history through block/source IDs, preserve pixel offsets separately, and re-resolve after canonical metadata arrives. Persisting turn IDs would require a canonical-only or explicit migration policy.

## Remaining children

1. Wire virtualization, block anchors, search, minimap, capture and ensure-loaded through the target entry; extend the import guard to those real consumers. Apply reveal before scroll/measurement, and preserve anchor pixel offset in the virtualizer.
2. Render the ledger and finish feed/article semantics, focus pinning/fallback, keyboard behavior, localized titles and turn headers. Measure the envelope's production/live performance budgets and full accessibility evidence then.

This child does not claim D1–D3 ledger completion, D22 feed accessibility, runtime anchor correctness for item virtualization, or the TR3 live performance budgets. Those surfaces do not exist yet.
