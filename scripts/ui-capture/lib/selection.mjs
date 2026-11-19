// Exact-id scenario selection (second review N1). `--only` matches
// substrings (`analytics--1440x900--dark` also selects
// `global-stats-after-analytics--1440x900--dark`); a fixed gate set such as
// the CI subset needs the exact ids, each of which must exist.

export class SelectionError extends Error {}

/**
 * The scenarios of `all` (active, expanded) whose id is in `ids`, in matrix
 * order. An id that is unknown, inactive (not in `all`) or repeated throws:
 * a typo must not silently shrink the gate.
 */
export function selectScenarios(all, ids) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new SelectionError(`duplicate selected scenario id ${id}`);
    seen.add(id);
  }
  const known = new Set(all.map((s) => s.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new SelectionError(`selected scenario id(s) not in the active matrix: ${unknown.join(", ")}`);
  return all.filter((s) => seen.has(s.id));
}
