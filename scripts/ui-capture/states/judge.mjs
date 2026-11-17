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

/** The primitives under the F2a state contract (`data-ctl` prefixes). */
export const CONTRACT_PRIMITIVES = ["button:", "input:", "textarea:", "select:", "switch:"];

export const isContractControl = (ctl) => CONTRACT_PRIMITIVES.some((prefix) => String(ctl).startsWith(prefix));

/**
 * The states a run judges: forced colours replace author backgrounds and
 * borders with system colours (hover and pressed fills vanish by design), so
 * there only keyboard focus is held to the contract.
 */
export const contractStates = (runId = "") => (runId.startsWith("chromium-forced") ? ["focus"] : STATES);

const stateName = (state) => (state === "active" ? "pressed" : state);

/** Why a contract row fails `state`, or null when it passes. */
function contractFailure(row, state) {
  if (state === "focus") {
    if (!row.focusable) return "not focusable";
    if (!row.focus) return "focus not measured";
    if (row.focus.reached === false) return "not reached by the keyboard";
    if (!row.focus.visible) return "no visible focus";
    if (row.focus.inView === false) return "focus ring outside the viewport";
    if (row.focus.covered) return "covered by another element";
    return null;
  }
  if (!row[state]) return `${stateName(state)} not measured`;
  return row[state].visible ? null : `no visible ${stateName(state)} state`;
}

/**
 * The F2a contract over one run's rows (plan F2a, D7): every Button, Input,
 * Textarea, Select and Switch instance probed shows keyboard focus (reached
 * by the key, ring box on screen, not covered) and, outside forced colours,
 * hover and pressed. `{ population, focus, hover?, active?, failures }`;
 * an empty population fails.
 */
export function summarizeContract(rows, runId = "") {
  const own = rows.filter((row) => isContractControl(row.ctl));
  const contract = { population: own.length, failures: [] };
  if (own.length === 0) contract.failures.push("F2a contract: no Button/Input/Textarea/Select/Switch measured");
  for (const row of own) if (row.error) contract.failures.push(`F2a contract: ${row.ctl}:${row.src}: ${row.error}`);
  const measured = own.filter((row) => !row.error);
  for (const state of contractStates(runId)) {
    const failing = measured.map((row) => [row, contractFailure(row, state)]).filter(([, why]) => why);
    contract[state] = { population: measured.length, visible: measured.length - failing.length };
    for (const [row, why] of failing) contract.failures.push(`F2a contract ${stateName(state)}: ${row.ctl}:${row.src}: ${why}`);
  }
  return contract;
}
