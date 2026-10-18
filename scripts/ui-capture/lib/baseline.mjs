// Baseline freeze (plan I0): the "before" of every D metric I0's probes can
// measure, with the conditions they were measured under, aggregated from a
// capture run's probes.json. Pure functions here; freeze-baseline.mjs is the
// CLI that reads the run and writes specs/2026-10-18-inner-ui/baseline.json.

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round = (n, d = 4) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Replace machine-specific roots in measured examples (the checkout path, the home dir). */
export function scrubPaths(value, roots) {
  if (typeof value === "string") return roots.reduce((s, [from, to]) => (from ? s.split(from).join(to) : s), value);
  if (Array.isArray(value)) return value.map((v) => scrubPaths(v, roots));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubPaths(v, roots)]));
  return value;
}

/** Per probe: where it applied, its selector, populations, and empty-population scenarios. */
function probeIndex(probes) {
  const index = {};
  for (const [id, scenario] of Object.entries(probes)) {
    for (const [name, result] of Object.entries(scenario.inner ?? {})) {
      const entry = (index[name] ??= { selector: null, applicable: 0, notApplicable: 0, population: 0, emptyPopulation: [], scenarios: {} });
      if (!result.applicable) {
        entry.notApplicable += 1;
        continue;
      }
      entry.applicable += 1;
      entry.selector ??= result.selector;
      entry.population += result.population ?? 0;
      if (!(result.population > 0)) entry.emptyPopulation.push(id);
      entry.scenarios[id] = result;
    }
  }
  return index;
}

/**
 * The D-metric "before" values I0's probes measure. Each entry names the
 * probe, how many scenarios it applied to, the summed population and the
 * value; `emptyPopulation` must be empty (a run with one fails anyway).
 */
export function aggregateBefore(probes) {
  const idx = probeIndex(probes);
  const values = (name) => Object.entries(idx[name]?.scenarios ?? {});
  const meta = (name) => {
    const e = idx[name];
    return e ? { probe: name, selector: e.selector, scenarios: e.applicable, population: e.population, emptyPopulation: e.emptyPopulation } : { probe: name, scenarios: 0 };
  };

  const leaks = values("absPathLeaks").map(([id, r]) => [id, r.value.leaks]);
  const toolRows = values("toolRowMetrics");
  const fontSizes = {};
  for (const [, r] of toolRows) for (const [px, n] of Object.entries(r.value.fontSizes ?? {})) fontSizes[px] = (fontSizes[px] ?? 0) + n;
  const wb = { ko: { total: 0, keepAll: 0 }, ja: { total: 0, keepAll: 0 }, zh: { total: 0, keepAll: 0 } };
  for (const [, r] of values("wordBreak")) {
    for (const [lang, b] of Object.entries(r.value.byLang ?? {})) {
      wb[lang].total += b.total;
      wb[lang].keepAll += b.keepAll;
    }
  }
  const cards = values("cards");
  const radii = {};
  for (const [, r] of cards) for (const [k, n] of Object.entries(r.value.radii ?? {})) radii[k] = (radii[k] ?? 0) + n;
  const focus = values("focusVisible");
  const overflow = values("overflowX");
  const chrome = values("chromeSelect");
  const left = values("leftEdges");
  const leading = values("cjkLeading");

  return {
    D1: { ...meta("absPathLeaks"), value: { leaks: sum(leaks.map(([, n]) => n)), scenariosWithLeaks: leaks.filter(([, n]) => n > 0).length } },
    D2: {
      ...meta("toolRowMetrics"),
      value: {
        rows: sum(toolRows.map(([, r]) => r.population)),
        fontSizePx: fontSizes,
        minRowHeightPx: Math.min(...toolRows.map(([, r]) => r.value.minHeight ?? Infinity)),
        truncatedRows: sum(toolRows.map(([, r]) => r.value.truncatedRows ?? 0)),
      },
    },
    D7: { ...meta("focusVisible"), value: { visible: sum(focus.map(([, r]) => r.value.visible)), stops: sum(focus.map(([, r]) => r.population)), invisible: sum(focus.map(([, r]) => r.value.invisible)) } },
    D12: {
      wordBreak: { ...meta("wordBreak"), value: Object.fromEntries(Object.entries(wb).map(([l, b]) => [l, { ...b, keepAllShare: b.total ? round(b.keepAll / b.total) : null }])) },
      cjkLeading: { ...meta("cjkLeading"), value: { multiLineNodes: sum(leading.map(([, r]) => r.population)), below15: sum(leading.map(([, r]) => r.value.below15)) } },
    },
    D20: {
      cards: { ...meta("cards"), value: { cards: sum(cards.map(([, r]) => r.value.cards)), maxNesting: Math.max(0, ...cards.map(([, r]) => r.value.maxNesting)), radii } },
      leftEdges: {
        ...meta("leftEdges"),
        value: {
          titleToContentDeltaPx: Object.fromEntries(left.map(([id, r]) => [id, r.value.delta])),
          distinctLeftEdgesMax: Math.max(0, ...left.map(([, r]) => r.value.distinctEdges)),
        },
      },
    },
    D24: { ...meta("chromeSelect"), value: { selectableChromeText: sum(chrome.map(([, r]) => r.value.selectable)), chromeText: sum(chrome.map(([, r]) => r.population)) } },
    D25: {
      ...meta("overflowX"),
      value: {
        mobileScenariosWithPageOverflow: overflow.filter(([id, r]) => id.includes("--390x844--") && r.value.pageOverflowPx > 0).map(([id, r]) => `${id} (${r.value.pageOverflowPx}px)`),
        clippedBoxes: sum(overflow.map(([, r]) => r.value.clipped)),
      },
    },
  };
}
