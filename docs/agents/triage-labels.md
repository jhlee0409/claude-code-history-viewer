# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Repo-specific labels (out of canonical set — don't conflate)

The repo also uses the following labels for project-specific workflows. They are **narrower or orthogonal** to the canonical triage roles above; do not substitute them.

- `needs-spec` — queued for implementation spec analysis (narrower than `needs-triage`)
- `spec-ready` — implementation spec PR created (narrower than `ready-for-human`)
- `naming` — project naming and branding decisions
- `bug`, `enhancement`, `documentation`, `question`, `duplicate`, `invalid`, `good first issue`, `help wanted` — standard GitHub categorization
