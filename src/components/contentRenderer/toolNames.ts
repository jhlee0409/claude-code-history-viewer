/**
 * Recorded tool names → the canonical Claude Code name of the same primitive.
 *
 * Claude Code uses PascalCase names; other providers (oh-my-pi, Codex,
 * OpenCode, Gemini) emit lowercase or snake_case variants for the same
 * primitives. Only names whose input shape matches the canonical tool are
 * aliased; everything else keeps its recorded name. Shared by the card
 * router (`UnifiedToolExecutionRenderer`) and the row's tool kind
 * (`transcript/toolKind`), so a name reaches the same card and the same kind.
 */
const TOOL_ALIASES: Readonly<Record<string, string>> = {
  bash: "Bash",
  shell: "Bash",
  read: "Read",
  read_file: "Read",
  write: "Write",
  write_file: "Write",
  grep: "Grep",
  glob: "Glob",
  websearch: "WebSearch",
  web_search: "WebSearch",
  webfetch: "WebFetch",
  web_fetch: "WebFetch",
};

/** The canonical name for a recorded tool name (the recorded name when it has no alias). */
export function canonicalToolName(name: string): string {
  const lower = name.toLowerCase();
  return Object.hasOwn(TOOL_ALIASES, lower) ? (TOOL_ALIASES[lower] as string) : name;
}
