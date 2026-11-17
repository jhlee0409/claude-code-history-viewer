# Context

- Base: `develop` at `63efbb446248886b3f3d57216bc3865a646c3009`.
- The failure occurs in `messageUtils.ts` and `MessageContentDisplay.tsx`.
- The change deliberately stops automatically extracting bare image URLs from
  surrounding prose. Explicit Markdown image syntax and structured image blocks
  remain available for inline images.
## Verification

- Before the implementation: the two new suites failed 26 of 37 tests against
  the base, covering false classification, code/Markdown corruption, copy,
  search, and whitespace handling.
- After the implementation: the two new suites and the neighboring body-step
  and content-array suites passed all 50 tests (Vitest 4.1.11, two workers).
- TypeScript project build and ESLint over `src` passed.
- The production diff was independently reviewed during implementation.
- A real Chrome 156 smoke test passed at 1280x900 and 390x844: prose and code
  preserved, Markdown images/links and structured images rendered, all five
  images loaded, copy returned the complete original text, search retained the
  URL, and the browser console was clean. This is browser verification, not a
  native Tauri WebView launch.
