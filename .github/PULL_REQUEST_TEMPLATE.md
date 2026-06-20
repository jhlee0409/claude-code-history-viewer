<!--
Thanks for contributing to claude-code-history-viewer! 🙏
Please target the `develop` branch (NOT `main` — main is release-only).
-->

## What & why

<!-- What does this change and why? Link the issue it closes. -->

Closes #

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] New provider (Claude Code / Codex / OpenCode / Kiro / Kimi / Copilot / …)
- [ ] Refactor / perf
- [ ] Docs

## Checklist

- [ ] PR targets **`develop`**, not `main`
- [ ] Added/updated **tests** for the changed behavior (`pnpm vitest run`, and Rust tests if backend)
- [ ] `pnpm exec tsc --build .` and `pnpm lint` pass
- [ ] **i18n**: any new user-facing string is `t()`-wrapped and the key exists in **all 5 languages** (`en, ko, ja, zh-CN, zh-TW`) — verified with `pnpm run i18n:validate`

## If this adds a frontend-callable backend command

- [ ] Registered in **both** the Tauri `generate_handler!` (`src-tauri/src/lib.rs`) **and** the Axum WebUI router (`src-tauri/src/server/mod.rs`) — otherwise `--serve` mode 404s

## If this adds a new provider

- [ ] Followed the existing provider pattern in `src-tauri/src/providers/`
- [ ] Session discovery verified on macOS / Linux / Windows (and WSL if applicable)
- [ ] No leftover identifiers copied from another provider (names, comments, fixtures)

<!--
Note: a maintainer (and possibly the @claude bot) will review. You can mention
@claude in a comment to ask for an automated i18n/parity check.
-->
