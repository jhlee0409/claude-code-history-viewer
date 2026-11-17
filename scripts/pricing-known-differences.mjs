/**
 * Feed values that were already checked against the provider's official page
 * and found to be feed artifacts (a Batch row, a reseller discount, a stale
 * tier). The weekly watch lists them separately instead of counting them as
 * findings — but only while the feed still reports the recorded value, so a
 * real change on the feed side surfaces again.
 *
 * Entries live in docs/pricing-sources/known-feed-differences.json.
 */

/** `openrouter:minimax/minimax-m2.5` → `openrouter`. */
const feedOf = (source) => source.split(":")[0];

const sameValue = (recorded, current) =>
  typeof recorded === "number" && typeof current === "number"
    ? Math.abs(recorded - current) <= 1e-9 * Math.max(1, Math.abs(recorded))
    : recorded === current;

function findKnown(known, key, field, source, value) {
  return known.find(
    (entry) =>
      entry.model === key &&
      entry.field === field &&
      entry.feed === feedOf(source) &&
      sameValue(entry.feedValue, value),
  );
}

/**
 * Split mismatches and deprecation signals into still-open findings and
 * known feed differences.
 *
 * @param {{ mismatches: Array<{key: string, field: string, theirs: unknown, source: string}>,
 *           deprecations: Array<{key: string, theirs: unknown, source: string}> }} result
 * @param {Array<{model: string, field: string, feed: string, feedValue: unknown, reason: string, verifiedAt: string}>} known
 */
export function splitKnownDifferences(result, known) {
  const acknowledged = [];
  const mismatches = [];
  for (const row of result.mismatches) {
    const entry = findKnown(known, row.key, row.field, row.source, row.theirs);
    if (entry) acknowledged.push({ ...row, reason: entry.reason, verifiedAt: entry.verifiedAt });
    else mismatches.push(row);
  }
  const deprecations = [];
  for (const row of result.deprecations) {
    const entry = findKnown(known, row.key, "deprecation", row.source, row.theirs);
    if (entry) acknowledged.push({ ...row, field: "deprecation", reason: entry.reason, verifiedAt: entry.verifiedAt });
    else deprecations.push(row);
  }
  return { ...result, mismatches, deprecations, acknowledged };
}
