# Plan

1. Reproduce classification and renderer failures with focused Vitest tests.
2. Restrict standalone classification and remove raw substring extraction from
   the message renderer; use the same whole-value rule for text-block helpers.
3. Run focused and neighboring renderer tests, TypeScript build, and ESLint.
4. Independently review the patch and record browser verification separately
   from DOM tests.
