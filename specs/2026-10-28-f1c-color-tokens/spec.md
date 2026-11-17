# F1c identity, syntax and data roles

Approved scope: handoff plan-v3 §4.1 and lines 692–697, v3.1 amendments, scratch/f1c/brief.md. Base d63f524d4fa7bac4988c0abb28ef01a63abb8503.

- Own index.css token declarations, providers.ts, agentStyles.ts, prismStyles.ts plus regression/measurement infrastructure.
- Define provider/agent roles in four themes, preserving labels, distinct agent icons, matching and canonical fallback.
- Prism style output uses semantic code/foreground/surface roles, not dependency colour literals. Existing callers remain unchanged.
- Freeze four categorical colours only after card contrast >=3 and every pair's normal/Machado full-severity protanopia, deuteranopia, tritanopia CIEDE2000 >=10. Supply scalar/prior/grid/axis roles without changing chart consumers.
- Delete only demonstrably unused legacy declarations. Do not delete live glass/noise/glow roles or structural input/result zones.
- No Rust builds, capture matrix, push, PR, merge or other worktree changes. Parent owns visual acceptance and independent cross-family review.

Numeric token tests are not a claim of rendered, keyboard, screen-reader or full WCAG compliance.
