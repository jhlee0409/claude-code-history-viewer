import { memo } from "react";
import { useTranslation } from "react-i18next";
import { diffLines } from "diff";
import { ToolIcon } from "../../ToolIcon";
import { ToolRow } from "../../transcript/ToolRow";
import { toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import { PathText } from "@/lib/format/PathText";
import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { FileEditRenderer } from "../../toolResultRenderer/FileEditRenderer";
import type { Props } from "./shared";
import { str, strAny } from "./shared";

/** Added / removed line counts of one old → new replacement. */
function lineChanges(oldText: string, newText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(oldText, newText, { ignoreNewlineAtEof: true })) {
    const lines = part.count ?? 0;
    if (part.added) added += lines;
    else if (part.removed) removed += lines;
  }
  return { added, removed };
}

/** Every old → new pair of the input: Edit's own, or MultiEdit's `edits`. */
function replacements(input: Record<string, unknown>): Array<[string, string]> {
  const own = [str(input, "old_string"), str(input, "new_string")] as const;
  if (own[0] != null || own[1] != null) return [[own[0] ?? "", own[1] ?? ""]];
  if (!Array.isArray(input.edits)) return [];
  return input.edits.flatMap((edit) => {
    if (edit === null || typeof edit !== "object") return [];
    const e = edit as Record<string, unknown>;
    return [[str(e, "old_string") ?? "", str(e, "new_string") ?? ""] as [string, string]];
  });
}

const NESTED_OPEN = { defaultExpanded: true };

/**
 * Edit: a ToolRow header (Edit · relative path · +a −d). The opened body is
 * the existing FileEditRenderer, already open, until TR2a replaces it with
 * the meta line + DiffView.
 */
export const EditCard = memo(function EditCard({ toolUse, toolResults }: Props) {
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const name = (toolUse.name as string) || "Edit";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = strAny(input, "file_path", "path") ?? "";
  const pairs = replacements(input);
  const counts = pairs.reduce(
    (sum, [oldText, newText]) => {
      const c = lineChanges(oldText, newText);
      return { added: sum.added + c.added, removed: sum.removed + c.removed };
    },
    { added: 0, removed: 0 },
  );
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);

  return (
    <ToolRow
      icon={<ToolIcon toolName="Edit" className="w-4 h-4" />}
      verb={name}
      target={filePath ? <PathText path={filePath} ctx={pathCtx} className="text-code text-fg" /> : undefined}
      meta={
        pairs.length > 0 ? (
          <span>
            <span aria-hidden="true" data-mono="code" className="font-mono">{`+${counts.added} −${counts.removed}`}</span>
            <span className="sr-only">{`${t("toolRow.linesAdded", { count: counts.added })}, ${t("toolRow.linesRemoved", { count: counts.removed })}`}</span>
          </span>
        ) : undefined
      }
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={`unified-${toolId}`}
    >
      <RendererDefaultsContext.Provider value={NESTED_OPEN}>
        <FileEditRenderer
          toolResult={{
            filePath,
            oldString: str(input, "old_string") ?? "",
            newString: str(input, "new_string") ?? "",
            replaceAll: input.replace_all === true,
            originalFile: "",
            userModified: false,
          }}
        />
      </RendererDefaultsContext.Provider>
    </ToolRow>
  );
});
