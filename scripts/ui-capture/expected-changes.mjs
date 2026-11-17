#!/usr/bin/env node
// The ui-harness CI job's reader of a pull request's declared visual changes:
//
//   PR_BODY="<pull request body>" node scripts/ui-capture/expected-changes.mjs
//
// prints the `ui-expected-changes:` entries comma-joined (nothing when none
// are declared), ready for `pnpm ui:capture --expect-changed <list>`. The body
// is untrusted input: the workflow hands it over only as $PR_BODY, and what
// this prints is only scenario ids, `*` and commas. Garbage exits 2 with the
// reason on stderr. Syntax: lib/expectedChanges.mjs, README "Gates".

import { ExpectedChangesError, expectedChangesFromBody } from "./lib/expectedChanges.mjs";

try {
  const entries = expectedChangesFromBody(process.env.PR_BODY);
  if (entries.length) process.stdout.write(`${entries.join(",")}\n`);
} catch (error) {
  if (!(error instanceof ExpectedChangesError)) throw error;
  process.stderr.write(`✗ ${error.message}\n`);
  process.exitCode = 2;
}
