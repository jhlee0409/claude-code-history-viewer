// Summary of one `ui:states` run (plan I0, D7): for hover, keyboard focus
// and pressed, how many controls that can show the state did show it. An
// empty gallery fails: nothing measured is not "every state visible".

const STATES = ["focus", "hover", "active"];

/**
 * `rows`: one per control instance, `{ ctl, src, focusable, focus?, hover?,
 * active? }` where each state is `{ visible }` (from statesJudge.focusChange)
 * or absent when the state does not apply (not focusable, pressing a menu).
 */
export function summarizeStates(rows) {
  const summary = { failures: [] };
  for (const state of STATES) {
    const judged = rows.filter((row) => row[state] && (state !== "focus" || row.focusable));
    summary[state] = { population: judged.length, visible: judged.filter((row) => row[state].visible).length };
  }
  if (rows.length === 0) summary.failures.push("empty gallery: no controls measured");
  for (const row of rows) if (row.error) summary.failures.push(`${row.ctl}:${row.src}: ${row.error}`);
  return summary;
}
