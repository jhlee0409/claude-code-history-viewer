# Bounded implementation and evidence

1. Add failing consumer-role/source guard tests; run and preserve assertion receipts before implementation.
2. Reuse existing OKLCH/WCAG/CIEDE2000 math; add independently pinned Machado matrices and Sharma reference pairs. Keep a single JS implementation usable by Node 20 CI and Node 22 local commands.
3. Measure legacy, Okabe-Ito and theme-aligned alternatives; freeze only a measured passing candidate. Preserve full matrices and unrounded thresholds.
4. Remove only zero-reference legacy declarations; retain referenced component styles and tokens.
5. Prune fixed fingerprint entries only (no accepted additions or new exemptions). Run full typecheck, lint, one-shot frontend suite, production frontend build, i18n validation and numeric CLI, recording command/exit/base+tree/head.
6. Commit one logical implementation unit through executable Husky hooks after gates pass. Parent later runs capture matrix and cross-family visual review.

Authoritative outcomes and any incomplete gate: scratch/f1c/report.md. Existing approved plan is the scope authority; these files document this bounded slice, not a new owner decision.
