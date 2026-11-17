# Settings location metadata (SE0a)

`get_all_settings` keeps `user`, `project`, `local`, `managed` as raw JSON strings
or null and adds `metadata`. Both the Tauri command and the existing authenticated
WebUI endpoint return the same structure. No new route or authorization exception
is introduced. The server home is exposed only with that existing settings response.

```ts
{
  user: "{}", project: null, local: null, managed: "{}",
  metadata: {
    serverHome: "/server/home",
    scopes: {
      user: { path: "/server/home/.claude/settings.json", state: "missing", readOnly: false },
      project: { path: null, state: "no_project", readOnly: false },
      local: { path: null, state: "no_project", readOnly: false },
      managed: { path: "/Library/Application Support/ClaudeCode/managed-settings.json", state: "missing", readOnly: true }
    }
  }
}
```

The example is a macOS server, not a portable path template. Never construct these
paths from browser OS, browser home, a selected custom history directory, or the
unrelated `.claude.json` response. `serverHome` is the backend settings home; use it
as `homeDir` in `formatPath(path, { homeDir: metadata.serverHome })` in the future
UI. `kind: "home"` is a formatter result, not an input option; paths outside that
home (for example managed settings) remain absolute.

## Scope states

| state | Meaning | path |
|---|---|---|
| `present` | A regular file was read successfully; even empty, `{}`, invalid JSON, numeric JSON or `null` JSON | exact resolver result |
| `missing` | Filesystem target not found and the nearest existing ancestor is a directory; includes a dangling final symlink | exact resolver result |
| `read_error` | Metadata/read failure, invalid UTF-8, nonregular target, or a non-directory/inaccessible parent (even when the OS reports `NotFound`) | exact resolver result |
| `no_project` | No project was selected (project/local only) | null |
| `unsupported` | Managed settings unsupported on the server platform | null |
| `resolve_error` | Existing path resolver failed (e.g. invalid project path or unavailable home) | null |
| `unknown` | Client fallback for old/malformed metadata; never emitted by the current server | null |

`present` is evidence that a file was read, **not** that any particular setting is
inherited from it. Parse the unchanged raw contents and use the existing settings
merger/precedence to identify actual sources. Do not use `raw !== null`, `raw !==
"{}"`, or a scope's presence alone as a setting-source heuristic. Missing files
still have legacy contents `"{}"`; unavailable scopes/read failures may be null.

The `path` is the existing resolver's read/save target spelling. Existing project
roots canonicalize; nonexistent roots/parents retain the resolver's lexical path.
The final file is deliberately not canonicalized for display: reads can follow a
regular-file symlink, but atomic save replaces the named entry. A symlinked project
`.claude` can be readable and still be refused by the existing save guard.

`readOnly` describes the existing managed scope policy only. `false` is **not** a
writability promise: a missing project, invalid/non-directory parent, permissions,
symlink guards, concurrent filesystem changes or a later save failure can prevent
a write. Metadata neither changes nor preflights save permissions. No new writable
flag is provided. All existing save errors must remain visible in the consumer.

This is a read-time observation, not a filesystem lock or a future-save guarantee.
Regular content is read once without parsing/reformatting. The existing safe
regular-file opener is reused after resolving a read alias, so directories/FIFOs
are rejected rather than blocking. No folders or files are created by observation.
Other single-scope readers and all writers are unchanged.

## Compatibility and SE0b handoff

Wire metadata is optional on both existing TS response declarations. The shared
`api` adapter normalizes it after either Tauri invocation or HTTP fetch. Absent,
invalid or future states become `{path:null,state:"unknown",readOnly:null}` for the
affected scope; no path or platform policy is synthesized. Legacy JSON fields are
preserved byte-for-byte, and unrelated API commands are untouched. Direct callers
bypassing `api` must treat absent metadata as unknown too.

SE0a changes no rendered UI. SE0b must separately add the approved always-visible
editing scope/file line, inheritance explanation, dirty marker and save target:
- Use returned `metadata.scopes[scope].path` and `metadata.serverHome`, never TS path templates.
- Distinguish loading/error/unknown/unavailable from confirmed missing/present.
- Keep managed lock policy and actual save failure handling. Do not infer write access.
- Reuse existing editor JSON-text + manager dirty semantics, not a new hash.
- Keep source/precedence semantics in `settingsMerger`; file presence is only evidence.
- Add meaningful `SettingsScopeLine.test.tsx` RED first; 5 locales, settings/dirty/inherited harness cases, 390px/125% transitions and real save/failure checks.
- Do not implement contributor-owned #574/#717 or message text #720.

SE0b and any merge require their separate review/authorization gates. Metadata
availability is not evidence that the SE0 UI acceptance criteria have shipped.
