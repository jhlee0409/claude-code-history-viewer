# Headless / frontend export parity

The headless HTML path consumes raw JSONL `message.content`; frontend HTML,
Markdown and text export consume the same blocks after loading. Raw `--format
json` intentionally remains a lossless transcript export, not a redacted report.

## Producer ground truth

Pinned Anthropic TypeScript SDK commit:
[`cb5fba419808e3844fa6407e59577ab7ba346b79`](https://github.com/anthropics/anthropic-sdk-typescript/tree/cb5fba419808e3844fa6407e59577ab7ba346b79).
The raw source was downloaded and the following line anchors checked.

| Rule | Producer source | Shared corpus / tests |
|---|---|---|
| C8 create, view, str_replace and errors retain their actual discriminated fields, including false/null; no invented operation/path | [`messages.ts:7085–7192`](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7085-L7192) | `export-parity.json`: create, view text/image/pdf, nullable coordinates, all editor error codes |
| C9 result is an object with tool_references; error is a separate variant | [8010–8057](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L8010-L8057), references [7899–7912](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7899-L7912) | references empty/nonempty, error |
| C10 plain advisor text is prose; redacted advice is opaque, never decrypted or emitted as prose | [360–405, 470–484](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L360-L405) | plain/redacted × stop reason controls, ciphertext negative control |
| Exact max_tokens adds a separate truncation notice on either advisor variant | [449–457](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L449-L457) | both variants, empty text, absent/null/unknown/error controls |
| Exact refusal on either advisor variant adds a declined notice; no verdict is inferred from prose | SDK's open string refers to top-level reasons [6965–6973](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L6965-L6973); Claude Code binary below | both variants; error variants do not acquire a notice |
| C11 server web search retains the frontend's title-summary policy (first five results), safely escaped rather than executable links | [8868–8892, 9070–9095](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L8868-L8892) | title, empty, error, five-result cap; missing-title/dangerous-URL case is explicitly legacy compatibility |

C8/C9 are intentionally **readable escaped JSON**, matching the frontend. That is
faithful preservation, not a raw-JSON failure. JSON member order is not a producer
semantic. Unknown advisor/error variants retain the same JSON fallback as TS.

### Closed-producer refusal evidence

Rechecked local Claude Code **2.1.285**, SHA-256
`51f09bd1e021d9fa8a1864c179799bd37cb39962a937935c5cf6823398e86db4`.
The executable contains several copies/string-table matches: use the actual
JavaScript implementation, not the first string-table occurrence.

- Byte **181510409**, `j0r`: accepts only `advisor_result` or
  `advisor_redacted_result`, reads string `stop_reason`, checks the known reason
  list, otherwise returns `unknown`.
- Byte **181510643**, `khe(e)`: `j0r(e) === "refusal"`.
- Byte **202269540**, inside `Wa`: the `khe(l)` branch renders
  **“Advisor declined to advise on this request”**. `Flt` optionally exposes
  plaintext refusal text in verbose mode, never encrypted output.

Exports retain existing plaintext and add the explicit notice (language-neutral
English, as with existing export labels). This change does not alter app UI pixels
or app outcome classification. No max_tokens/refusal semantics are assigned to
error/unknown variants or guessed from absent fields.

## Verification contract

`src-tauri/tests/fixtures/export-parity.json` is synthetic data shaped from the
producer evidence above, **not producer evidence itself**. It is shared by:

- Rust `export::tests::server_tool_export_parity_*`: exact extracted text/kind and
  escaped HTML block rendering.
- Vitest `src/test/export/headlessParity.test.ts`: actual TS extraction and HTML
  `.content` text, plus multiline Markdown result quoting (including CRLF and
  blank lines).
- `node scripts/export-parity.mjs /absolute/debug/binary`: writes synthetic JSONL,
  executes the real `--export --format html` CLI, invokes the actual TS HTML
  exporter through Vite SSR, and compares every message's `.content.textContent`.
  JSON blocks are parsed, recursively key-sorted and serialized before comparison;
  all keys, values, false/null and array order remain significant. Other blocks
  collapse whitespace and trim it. Headers, metadata and engine-specific markup
  are outside this block comparison. Assert corpus cardinality on both outputs.

The harness uses private Hermes scratch and deletes its synthetic exports in a
`finally` block. Real-history verification keeps only keys/counts and binary
checksums; session paths and exported content never enter this repository.

## Scope and explicit residuals

- All 18 explicit TS content-type branches have a Rust counterpart after this
  change; full file:line mapping and before/after measurements are in the task
  report. C8/C9 were lossy placeholders and advisor was an unknown-type label.
- Empty server-search titles and empty web-fetch URLs now select the same generic
  placeholders as TS; these are explicitly compatibility controls, not locally
  observed producer values.
- Raw HTML inside Markdown is now escaped to visible text in Rust too, matching
  TS rather than silently dropping tags. Other comrak/Marked syntax and URL-policy
  differences are not a claim of byte-identical general Markdown rendering.
- C11 **client** `WebSearch` metadata batches/commentary are a different route
  from SDK `web_search_tool_result`: neither shared exporter interprets
  `toolUseResult.results`. Both retain the ordinary tool_result text policy.
  No new producer interpretation or clickable-link policy is introduced here.
- Ordinary `tool_result` arrays (including client ToolSearch references) keep the
  shared `[Tool result]` placeholder. Rich ordinary-result export is a separate
  feature, not a Rust-only missing content branch.
- Frontend content-type toggles and `includeSidechain` options have no CLI flags.
  Headless export retains its documented default sidechain exclusion. Rust also
  excludes raw `ai-title` metadata (not a frontend message content type).
- Existing Rust Unicode-scalar truncation vs JS UTF-16 truncation and object-member
  display order can differ; the safe Rust truncation behavior is unchanged.
