// Opt-in synthetic raw producer shapes; never changes the default CI32 fixture.
// Run with CCHV_CAPTURE_PRODUCER_CONTEXT=1 on BOTH compared bundles.
export { DEFAULT_LOCALE, MEASUREMENT_STATE, STORAGE_SEED, expandScenarios } from "./scenarios.mjs";
import { inspectorStorage } from "./scenarios.mjs";

const screens = ["list", "prompts", "outline"].map(mode => ({
  id: `producer-codex-${mode}`,
  title: `Synthetic Codex context: ${mode}`,
  inspectorOpen: true,
  storage: { ...inspectorStorage({ open: true }), "navigator-view-mode": mode === "outline" ? "outline" : "list" },
  steps: [{ do: "openSession", session: "patch-only" }, ...(mode === "prompts" ? [{ do: "navigatorPromptsOnly" }] : [])],
}));
screens.push({
  id: "producer-claude-bash",
  title: "Synthetic Claude bash-mode input/output, outline and minimap",
  inspectorOpen: true,
  storage: { ...inspectorStorage({ open: true }), "navigator-view-mode": "outline" },
  steps: [{ do: "openSession", session: "outcomes" }],
});
export const MATRIX = [{ viewports: [{ id: "1440x900", width: 1440, height: 900 }], themes: ["dark"], screens: [...screens, ...["codex", "claude"].map(provider => ({
  id: `producer-${provider}-user`,
  title: `Synthetic ${provider} automatic cycles excluded from user-only display`,
  steps: [{ do: "openSession", session: provider === "codex" ? "patch-only" : "outcomes" }],
  storage: { "message-filter": JSON.stringify({ roles: { user: true, assistant: false }, contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true } }) },
}))] }];
