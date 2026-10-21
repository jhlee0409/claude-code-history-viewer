# Session token recording contract (SX0b)

`SessionTokenStats.token_usage_recording` is additive metadata; it never changes
existing numeric totals, pricing, row selection, deduplication or error behavior.
The same serialized shape is returned by desktop IPC, HTTP and project token
pagination. Older payloads without the member mean `unknown` indefinitely.
External strict decoders may need to allow the additive key; external consumers
cannot be enumerated from this repository.

## Observation set

The initial supported source is **native Claude only**. Coverage concerns its
five normalized token classes: input, output, cache creation, cache read and
reasoning, on every row accepted by that request's existing mode/date policy.
Evidence is captured before numeric defaults and dedup growth. It does not
establish complete provider history, billing, turns, or successful scanning of
unreadable/skipped rows and descendants.

- `absent`: no valid numeric counter evidence on accepted rows.
- `recorded`: every accepted row explicitly covers all five classes, including
  explicit zero. A cache-write aggregate can also be covered by both explicitly
  numeric nested TTL counters; one missing TTL is not an observed zero.
- `partial`: at least one numeric counter, but at least one accepted row lacks
  one of the five classes. The existing numeric subtotal, **including zero**,
  remains data. This does not say an assistant response was lost.
- `unknown`: original evidence cannot be established. All non-Claude normalized
  paths, including positive totals and Antigravity's special branch, initially
  return this state. Missing metadata is also unknown.

Ordinary user + fully recorded assistant sessions are `partial`, because the
user row lacks counters. `recorded` is intentionally rare; do not label it
“complete”. Enabling another provider requires raw absent/zero/partial format
fixtures and its own documented recordable-class denominator, not inheritance
of Claude's five-class denominator or a capability flag.

## Presentation boundary

This is **session-total metadata, not per-field presence**. It cannot justify
calling every zero component a recorded zero, nor model-level or cross-session
coverage. A usage object, model, cost, message count and a numeric total of zero
are not evidence of token recording.

A downstream presentation slice must show absent as localized no-record copy;
keep recorded totals numeric; keep partial subtotals (including zero) numeric
with an accepted-row-counter-coverage qualification; and explain unknown rather
than inventing absence or authoritative recorded zero. Unknown future runtime
strings must fall back to unknown. Pending, failed, no accepted messages and
absent recording remain distinct. Billing/conversation data remain separate.

SX0b's backend-contract child does not finish D18: timestamp/model missing-value
presentation and token-total copy/browser/visual evidence remain downstream.
No preference expansion (#574), per-component contract, provider protocol
rewrite, usage-breakdown/AN1 change, request/auth change, or numeric migration
is part of this slice. Rollback can remove the producer field without changing
the numeric schema; consumers must retain omission-to-unknown compatibility.
