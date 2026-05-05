# Issue tracker: GitHub

Repo: **`jhlee0409/claude-code-history-viewer`**.
Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue (human)**: `gh issue view <number> --comments` for plain-text reading.
- **Read an issue (machine-parsable)**: `gh issue view <number> --json number,title,body,comments,labels --jq '{title, body, labels: [.labels[].name], comments: [.comments[].body]}'`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Branch policy for related PRs

When a skill creates or proposes a PR linked to an issue, **the base branch MUST be `develop`, never `main`**. See `CLAUDE.md` → "Branch Strategy" — `main` is release-only and only receives merges from `develop` at release time. PRs targeted at `main` will fail review.

## Comment language (repo convention)

- **Default for `gh issue comment` / `gh pr comment` is English**, regardless of issue/PR body language. This keeps the public review record consistent across contributors.
- **Exception for close-comments**: when explicitly closing an issue **as a courtesy to the reporter**, match the issue body's language (e.g. close a Chinese-body issue with a Chinese close-comment).

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
