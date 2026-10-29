import { memo } from "react";
import { useResultProvider } from "../../transcript/resultProvider";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../../ToolIcon";
import { ToolRow } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { editConfirmationPath, hasShownResults, recordedEditFacts, toolFamily, toolOutcome, withoutOwnConfirmations } from "../../transcript/toolOutcome";
import { useToolPathContext } from "../../transcript/pathContext";
import type { EditReplacement } from "../../transcript/DiffViewModel";
import { PathText } from "@/lib/format/PathText";
import { FileEditRenderer } from "../../toolResultRenderer/FileEditRenderer";
import type { Props } from "./shared";
import { str, strAny } from "./shared";
import { replacementCounts } from "@/utils/lineChanges";

/** Every replacement of the input: Edit's own old → new, or MultiEdit's `edits`. */
function replacements(input: Record<string, unknown>): { kind: "edit" | "multiEdit"; edits: EditReplacement[] } {
  const own = [str(input, "old_string"), str(input, "new_string")] as const;
  if (own[0] != null || own[1] != null) {
    return { kind: "edit", edits: [{ oldString: own[0] ?? "", newString: own[1] ?? "", replaceAll: input.replace_all === true }] };
  }
  if (!Array.isArray(input.edits)) return { kind: "edit", edits: [] };
  return {
    kind: "multiEdit",
    edits: input.edits.flatMap((edit) => {
      if (edit === null || typeof edit !== "object") return [];
      const e = edit as Record<string, unknown>;
      return [{ oldString: str(e, "old_string") ?? "", newString: str(e, "new_string") ?? "", replaceAll: e.replace_all === true }];
    }),
  };
}

/**
 * Edit / MultiEdit: a ToolRow header (Edit · relative path · +a −d). Opened:
 * the Input zone — one meta line → the DiffView (FileEditRenderer), nothing
 * between (TR2a, D4): the diff is the recorded change the agent asked for. A MultiEdit shows every edit as its own diff section (amendment 6,
 * TC3). The row's "+a −d" and the diff's counts come from one function,
 * `replacementCounts` (TC4).
 *
 * The results, after the diff, in the Result zone, through the TR0 output
 * rules (TC2): a failed or interrupted call shows everything its results
 * recorded (the `<tool_use_error>` text …). Otherwise a result that is only
 * Claude's confirmation sentence naming the row's own file
 * (`editConfirmationPath`) says nothing the diff does not, and stays out as
 * before; every other result — a note the tool added, a `cat -n` snippet,
 * any other text or block — is shown as recorded (review round 1 of PR
 * #746, F1: a paired result is never consumed unseen). The result's own
 * metadata (via `recordedEditFacts`) gives the user-modified flag and the
 * original file, which numbers the diff with the file's own lines and adds
 * the file copies to the menu; its whole text is not repeated in the row.
 */
export const EditCard = memo(function EditCard({ toolUse, toolResults }: Props) {
  const provider = useResultProvider();
  const { t } = useTranslation();
  const pathCtx = useToolPathContext();
  const name = (toolUse.name as string) || "Edit";
  const toolId = (toolUse.id as string) || "";
  const input = (toolUse.input as Record<string, unknown>) ?? {};
  const filePath = strAny(input, "file_path", "path") ?? "";
  const { kind, edits } = replacements(input);
  const counts = replacementCounts(edits.map((e) => [e.oldString, e.newString] as const));
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family, provider);
  const facts = recordedEditFacts(toolResults);
  const expandKey = `unified-${toolId}`;
  const shownResults =
    outcome.verdict === "failed" || outcome.lifecycle === "interrupted" ? toolResults : withoutOwnConfirmations(toolResults, filePath, editConfirmationPath);

  return (
    <ToolRow
      icon={<ToolIcon toolName="Edit" title={null} className="w-4 h-4" />}
      verb={name}
      target={filePath ? <PathText path={filePath} ctx={pathCtx} className="text-code text-fg" /> : undefined}
      meta={
        edits.length > 0 ? (
          <span>
            <span aria-hidden="true" data-mono="code" className="font-mono">{`+${counts.added} −${counts.removed}`}</span>
            <span className="sr-only">{`${t("toolRow.linesAdded", { count: counts.added })}, ${t("toolRow.linesRemoved", { count: counts.removed })}`}</span>
          </span>
        ) : undefined
      }
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
    >
      {/* The diff is the recorded change the agent asked for: Input. */}
      <DetailZone kind="input">
        <FileEditRenderer
          toolResult={{
            filePath,
            replaceAll: kind === "edit" && edits[0]?.replaceAll === true,
            newString: kind === "edit" ? (edits[0]?.newString ?? "") : "",
            originalFile: facts.originalFile ?? "",
            userModified: facts.userModified === true,
          }}
          edits={edits}
          kind={kind}
          showPath={false}
          showOriginalContent={false}
          expandKey={`${expandKey}-diff`}
        />
      </DetailZone>
      {/* What the results recorded beyond the confirmation sentence: Result. */}
      <DetailZone kind="result" show={hasShownResults(shownResults)}>
        <ToolResultOutputs results={shownResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} />
      </DetailZone>
    </ToolRow>
  );
});
