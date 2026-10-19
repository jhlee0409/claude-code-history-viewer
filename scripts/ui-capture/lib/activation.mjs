// Later-active scenarios (plan I0, RR C7).

/**
 * Scenarios whose screen declares `activatesWith: "<task id>"` are not run
 * until that task removes the field (plan I0 (b)): the screen does not exist
 * yet, so a "before" capture of it would be invented. They are reported, not
 * silently dropped.
 */
export function splitByActivation(scenarios) {
  const active = [];
  const inactive = [];
  for (const scenario of scenarios) {
    if (scenario.screen.activatesWith) {
      inactive.push({ id: scenario.id, activatesWith: scenario.screen.activatesWith, before: scenario.screen.before ?? null });
    } else {
      active.push(scenario);
    }
  }
  return { active, inactive };
}
