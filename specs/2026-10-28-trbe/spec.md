# TRbe — raw per-result outcome evidence

Approved amendment 5 prerequisite. Preserve source-record outcome evidence before provider-local display merging; never infer outcomes from prose. Add only `toolUseResult` and `toolUseResultSource` on the exact source result. Existing content, flags, ordering, pagination and authorization remain unchanged.

First bounded slice: Codex function/custom JSON-string wrappers with `output`. Preserve the decoded wrapper including unknown fields, explicit null/false/zero/empty. Source UUID/session and normalized pre-merge content index identify ownership, not call identity. Plain text/already-object output keep existing representation. Public native paginated/non-paginated responses and read-only HTTP must agree; complete legacy responses must equal recorded base after stripping only those additive result fields.

Further providers (OpenHands, OpenCode/Kilo, Pi/OMP) require separate actual raw-fixture RED→GREEN and consumer/transport verification. They are not certified by a Codex fix. UI and sibling lanes are excluded.
