/**
 * Output kind detection, shared by OutputBlock and CommandOutputDisplay.
 *
 * The rules are the ones the app already used: StringRenderer's file-tree
 * check and CommandOutputDisplay's JSON / test / build / package / table
 * checks, in that component's order. Detection only labels output; it never
 * changes the text.
 */

export type CommandOutputKind = "json" | "test" | "build" | "package" | "table" | "terminal";
export type OutputKind = "fileTree" | CommandOutputKind;

/** StringRenderer's rule: a path plus list or tree glyphs. */
export function isFileTreeText(text: string): boolean {
  return text.includes("/") && (text.includes("- ") || text.includes("├") || text.includes("└"));
}

function parsesAsJsonObject(text: string): boolean {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** CommandOutputDisplay's rules, first match wins. */
export function detectCommandOutputKind(stdout: string): CommandOutputKind {
  if (parsesAsJsonObject(stdout)) return "json";
  if (stdout.includes("Test Suites:") || stdout.includes("jest") || stdout.includes("coverage")) return "test";
  if (stdout.includes("webpack") || stdout.includes("build") || stdout.includes("compile")) return "build";
  if (stdout.includes("npm") || stdout.includes("yarn") || stdout.includes("pnpm")) return "package";
  if (stdout.includes("|") && stdout.includes("-") && stdout.split("\n").length > 2) return "table";
  return "terminal";
}

export function detectOutputKind(text: string): OutputKind {
  return isFileTreeText(text) ? "fileTree" : detectCommandOutputKind(text);
}
