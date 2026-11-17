// Intended visual changes for the unchanged gate.
//
// Locally: `pnpm ui:capture ... --gate unchanged --expect-changed <list>`.
// In CI: a pull request declares them in its body, on a line of its own,
//
//   ui-expected-changes: home--390x844--dark, transcript-mixed-turn--*
//
// and the ui-harness job passes that list on as --expect-changed
// (expected-changes.mjs). Nothing is committed, so a declaration never
// outlives its pull request.
//
// An entry is an exact scenario id or an id prefix with a trailing `*`.
// Anything else is an error: a declaration that silently meant nothing would
// let a typo through.

export class ExpectedChangesError extends Error {}

const KEY = "ui-expected-changes:";
// Scenario ids are `<screen>--<viewport>--<theme>` in [a-z0-9-] (scenarios.mjs).
const ENTRY = /^[a-z0-9][a-z0-9-]*\*?$/;

function checkEntry(entry, source) {
  if (ENTRY.test(entry)) return entry;
  const why = entry === "*" ? "a bare * would accept every change; name an id prefix such as home--*" : "expected a scenario id or an id prefix ending in *, separated by commas";
  throw new ExpectedChangesError(`${source}: "${entry}" is not a scenario id (${why})`);
}

const unique = (entries) => [...new Set(entries)];

/** `"a, b--*"` -> `["a", "b--*"]`: comma separated, blanks dropped, repeats dropped. */
export function parseExpectedList(text, source = "--expect-changed") {
  const entries = String(text)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return unique(entries.map((entry) => checkEntry(entry, source)));
}

/**
 * Every `ui-expected-changes:` line of a pull request body, merged. A line
 * counts when it starts with the key (leading spaces and the key's case do not
 * matter); text inside an HTML comment does not count, because reviewers do
 * not see it. An empty or missing body declares nothing.
 */
export function expectedChangesFromBody(body) {
  // GitHub hides an unclosed comment up to the end of the body, too.
  const visible = String(body ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const entries = [];
  for (const line of visible.split(/\r\n|\r|\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.slice(0, KEY.length).toLowerCase() !== KEY) continue;
    entries.push(...parseExpectedList(trimmed.slice(KEY.length), `PR body "${KEY}"`));
  }
  return unique(entries);
}

const matches = (id, entry) => (entry.endsWith("*") ? id.startsWith(entry.slice(0, -1)) : id === entry);

/** The first entry that covers scenario `id`, or null. */
export const expectedBy = (id, entries) => entries.find((entry) => matches(id, entry)) ?? null;

/** Entries that cover none of `ids`: a typo must fail, not shrink to nothing. */
export const unmatchedPatterns = (entries, ids) => entries.filter((entry) => !ids.some((id) => matches(id, entry)));
