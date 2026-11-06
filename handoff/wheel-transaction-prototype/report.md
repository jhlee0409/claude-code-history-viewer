# Transcript wheel transaction — source prototype

## Outcome

Observed source/unit prototype, not visual acceptance. Decision `transcript-wheel-offset-owner`: the installed public offset-observer/scroll-writer extension points can stage the logical destination, commit real measured rows with the existing anchor policy, then release the physical offset. This supports further bounded UI testing; it does not support merge/release or a no-blank/raster claim.

Branch/worktree: `prototype/transcript-wheel-transaction`, `/Users/jack/client/cchv-wheel-prototype`; base `d4361075504c356a650d6c4e9a4a28282f3586d4`. Budget: 55 tool-call checkpoint, generated artifacts ≤20MB, source/unit only. Kept as a disposable branch for parent review; no cleanup/discard claim.

## Installed-source contract and implementation

Read installed React adapter **3.14.10** and virtual-core **3.17.8** manifests and source, the real viewer/hook, and the complete `trace-attribution/report.md`, especially 82–93. `scrollToOffset` invokes the physical writer before range replacement; it is not the transaction acknowledgement. No off-DOM premeasure, rangeExtractor override, private method invocation, overscan increase or full render was needed.

- `observeElementOffset` wraps the ordinary observer unchanged and retains its public delivery callback. Owned input delivers a logical offset while the transaction is active.
- `scrollToFn` withholds physical writes only during that synchronous transaction. Core still decides and folds `resizeItem` anchor corrections into its logical offset; there is no second anchor formula or correction replay.
- One outer `flushSync` commits the destination and existing mount-layout measurements. During the transaction the adapter uses non-reentrant notifications, then its ordinary callback is restored in `finally`.
- The acknowledgement walks actual connected mounted row boxes in scroll-content coordinates and checks continuous coverage. Existing `scrollMargin` supplies the known non-list prefix bound. Missing coverage fails closed: cancel the input, restore logical offset, release no physical write. This may drop an input instead of showing uncovered content.
- The resulting corrected destination is released once, with instant behavior, not through a new programmatic reconcile loop. Subpixel logical/physical release pairing retains fractional input across integer scrollTop read-back. The prior core intended-write echo is consumed before a new user delta, avoiding the installed core's 1.5px echo reconciliation swallowing that delta.
- Only the resolved transcript viewport gets a nonpassive bubble listener; no window/global wheel interception. Reentrant eligible input is canceled without a second transaction. The boundary is explicitly enabled by the prototype constant.

## RED → GREEN receipts

Terminal-observed slices, each implemented only after its named failure:

1. Base real-hook fixture (500 synthetic tall-estimate messages; mixed actual 40/53/66px rows and zero-height rows; target 3795.779541015625 beyond old overscan) failed `coverageBeforeRelease (including native default): expected false to be true`. JSDOM has no wheel default, so the base-only fallback models physical native advancement when uncanceled; the oracle uses actual mounted boxes, not cached virtual estimates. With ownership, every physical-write observation reports already-committed coverage. No rAF was advanced.
2. Nested scroll consumer failed `expected true to be false` for defaultPrevented; fixed with composed-path scroll consumption and overscroll containment checks.
3. Fractional input failed final release **0.25 vs expected 5**; first repair exposed **4.75 vs 5** due outstanding core echo; corrected logical/physical pairing and echo delivery passed 20 × 0.25px with alt/meta modifiers under integer physical rounding.
4. Reentrant input failed `defaultPrevented false vs true`; now canceled without another release.

Compatibility/negative controls cover ctrl zoom, shift/horizontal, zero/noncancelable events, prior cancellation, outside events, top/bottom chaining, pixel/line/page normalization, disabled boundary, enabled keyboard and direct/programmatic offset commands, UUID message-jump delegation, and failed coverage. A store-style programmatic command deliberately retains its prior uncovered immediate-write behavior: the prototype does not claim to solve non-wheel paths. Full-store/anchor/tail/filter/10k-stack preservation remains bounded by the existing source suite, not a new UI certification.

Direction reversals: observed **8 inputs, 8 owned inputs, 8 physical releases, 8 explicitly dispatched scroll events, 3 corrected inputs**. These are actual dispatched DOM events and physical writer observations in JSDOM, not an estimate from render counts or native browser event-coalescing evidence. All releases had coverage and there were no console.error calls in this hook fixture. Intentional core corrections remain nonzero; no global monotonicity/zero-adjustment claim.

## Final verification

`bash handoff/wheel-transaction-prototype/verify-source.sh`, Node **22.18.0**, `env -u NODE_ENV`:

- Source-only Vitest: **378 files / 9,863 tests passed**, exit0, 65.80s. New wheel file contributes 18 cases.
- `eslint src`: exit0.
- TypeScript app and Vite-config projects: exit0 using separate `tsc -p ... --incremental --tsBuildInfoFile scratch/...` paths, no emit.
- `git diff --check`: exit0.

Exact logs and per-stage exits: `scratch/wheel-verification/`; initial full-pass failure retained at `scratch/wheel-verification-first/`. Initial pass had two new-test failures (bottom overscroll edge, geometry spy self-recursion) and one related unhandled error. Both were fixed without weakening assertions; second full pass is green. Existing suites can emit their existing expected-error/act warning output; the exit0 does not imply entirely silent logs.

The unit-only config explicitly excludes `scripts/**/*.test.mjs`, uses native config loading and a worktree-local cache, and invokes no browser or build plugin. Early targeted commands used the default Vite config and `tsc -b`; these incidentally wrote generated Vitest/tsbuildinfo caches through the shared node_modules symlink. This did not install/edit dependency packages, but did violate the intended read-only cache boundary. No shared cache was deleted/restored. Later/final commands avoid that path. Attempting the original config with `--configLoader runner` failed at `__dirname is not defined` before tests; the dedicated unit config resolves this without editing product Vite configuration.

## Evidence limits and costs

The historical H1 frame856 remains positive: committed bounds55..2010 vs compositor viewport3795..4466, main-thread scroll +99.942ms and next commit +113.783ms. The two existing height fixes remain partial. Original FIRST performance FAIL and all historical visible-blank evidence are preserved unchanged.

There was **no production build, browser, trace, Cargo, pixel test, native Tauri/WebKit validation or performance qualification**. DOM commit acknowledgement is not activated layer/raster readiness. Browser-native scroll anchoring/clamping during the synchronous commit, actual event coalescing/inertial feel, selected text behavior and non-wheel interaction during a transaction remain for real UI testing. The fixture supplies layout geometry; it is a real hook/core/React test, not actual browser layout.

Tradeoffs: main-thread wheel latency and loss of compositor-asynchronous scrolling; all owned momentum/inertia packets become synchronous instant transactions. Line mode uses computed line-height (font-size ×1.2 /16 fallback), page mode uses viewport clientHeight. Any horizontal delta and shift-wheel remain native, including diagonal trackpad packets. Ctrl zoom remains on the existing path; alt/meta are not stripped and their vertical packet is owned. Edge chaining is retained, but nested overscroll and selection still require native engines. Existing source header/scrollMargin bounds are trusted; arbitrary new non-list content is not independently certified.

## Handoff

Parent: independent source review bound to the local head, then only after disk ≥10GiB is observed arrange the original bounded wheel/pixel/frame-ID test, real nested/zoom/keyboard/selection/scrollbar controls, and performance/preservation qualification. No source result replaces those observations. Prototype code may be referenced on this isolated branch; no production promotion is approved. No push/PR/comment/merge was performed.
