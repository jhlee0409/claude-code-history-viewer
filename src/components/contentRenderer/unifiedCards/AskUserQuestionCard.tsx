import { memo } from "react";
import { SquareCheckBig, Circle } from "lucide-react";
import { ToolIcon } from "../../ToolIcon";
import { Marked, TextTarget, ToolRow, type TextHighlight } from "../../transcript/ToolRow";
import { ToolResultOutputs } from "../../transcript/ToolResultOutputs";
import { DetailZone } from "../../transcript/DetailZone";
import { hasShownResults, toolFamily, toolOutcome } from "../../transcript/toolOutcome";
import type { Props } from "./shared";
import { searchHits } from "./shared";
import { DefaultCard } from "./DefaultCard";

interface AskOption {
  label: string;
  description?: string;
}

interface AskQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskOption[];
}

// Defensive parse of the AskUserQuestion tool input. Returns null when the
// shape is not recognized so callers can fall back to the generic renderer.
function parseQuestions(input: unknown): AskQuestion[] | null {
  if (!input || typeof input !== "object") return null;
  const raw = (input as Record<string, unknown>).questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const questions: AskQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.question !== "string") return null;

    const options: AskOption[] = [];
    if (Array.isArray(rec.options)) {
      for (const opt of rec.options) {
        if (opt && typeof opt === "object") {
          const o = opt as Record<string, unknown>;
          if (typeof o.label === "string") {
            options.push({
              label: o.label,
              description: typeof o.description === "string" ? o.description : undefined,
            });
          }
        }
      }
    }

    questions.push({
      question: rec.question,
      header: typeof rec.header === "string" ? rec.header : undefined,
      multiSelect: rec.multiSelect === true,
      options,
    });
  }
  return questions;
}

/**
 * AskUserQuestion (TR1a): one ToolRow. Row: the recorded tool name · the
 * first question · the outcome from `toolOutcome` only. Opened: the Input
 * zone — every question with its header and options (labels and
 * descriptions) — then the Result zone, the recorded answer. A search hit anywhere in them opens the row once per
 * query and is marked, the first question included when the row cuts it;
 * a hit on the tool id shows the id, marked, in the detail's meta line.
 * An input this card does not recognize keeps the generic Default row.
 */
export const AskUserQuestionCard = memo(function AskUserQuestionCard({
  toolUse,
  toolResults,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const questions = parseQuestions(toolUse.input);

  // Unknown/unexpected shape → keep the generic fallback renderer (never break
  // rendering on schema drift). #429
  if (!questions) {
    return (
      <DefaultCard
        toolUse={toolUse}
        toolResults={toolResults}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    );
  }

  return (
    <AskRow
      toolUse={toolUse}
      toolResults={toolResults}
      questions={questions}
      searchQuery={searchQuery}
      isCurrentMatch={isCurrentMatch}
      currentMatchIndex={currentMatchIndex}
    />
  );
});

function AskRow({
  toolUse,
  toolResults,
  questions,
  searchQuery,
  isCurrentMatch,
  currentMatchIndex,
}: Props & { questions: AskQuestion[]; searchQuery: string }) {
  const name = (toolUse.name as string) || "AskUserQuestion";
  const toolId = (toolUse.id as string) || "";
  const family = toolFamily(name);
  const outcome = toolOutcome(toolUse, toolResults, family);
  const expandKey = `unified-ask-${toolId}`;

  // Reveal + highlight when the search term is anywhere in the questions or
  // options, so a match inside a collapsed row is actually visible. #429
  const texts = questions.flatMap((q) => [q.header, q.question, ...q.options.flatMap((o) => [o.label, o.description])]);
  const textHit = searchHits(searchQuery, ...texts);
  // Searching by tool id (the old header showed the id, marked): the id, marked, in the meta line.
  const idHit = searchHits(searchQuery, toolId);
  const hit = textHit || idHit;
  const highlight: TextHighlight | undefined = searchQuery.trim() !== "" ? { searchQuery, isCurrentMatch, currentMatchIndex } : undefined;
  const first = questions[0]?.question ?? "";
  const firstLine = first.split("\n")[0] ?? "";

  return (
    <ToolRow
      icon={<ToolIcon toolName={name} title={null} className="w-4 h-4" />}
      verb={name}
      target={firstLine ? <TextTarget text={firstLine} full={first} highlight={highlight} /> : undefined}
      outcome={outcome}
      family={family}
      toolId={toolId}
      expandKey={expandKey}
      revealFor={hit ? searchQuery : undefined}
      detailMeta={
        idHit ? (
          <code data-mono="code" className="font-mono">
            <Marked text={toolId} highlight={highlight} />
          </code>
        ) : undefined
      }
    >
      <DetailZone kind="input">
        <div className="space-y-3">
          {questions.map((q, qi) => {
          const OptionIcon = q.multiSelect ? SquareCheckBig : Circle;
          return (
            <div key={qi} className="border-l border-line-faint pl-3">
              {q.header && (
                <div className="mb-1 text-caption text-fg-3">
                  <Marked text={q.header} highlight={highlight} />
                </div>
              )}
              <div className="whitespace-pre-wrap text-list font-medium text-fg">
                <Marked text={q.question} highlight={highlight} />
              </div>
              {q.options.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {q.options.map((opt, oi) => (
                    <li key={oi} className="flex items-start gap-2">
                      <OptionIcon aria-hidden="true" className="mt-0.5 w-3.5 h-3.5 shrink-0 text-fg-3" />
                      <div className="min-w-0">
                        <div className="text-list text-fg">
                          <Marked text={opt.label} highlight={highlight} />
                        </div>
                        {opt.description && (
                          <div className="whitespace-pre-wrap text-caption text-fg-3">
                            <Marked text={opt.description} highlight={highlight} />
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        </div>
      </DetailZone>
      <DetailZone kind="result" show={hasShownResults(toolResults)}>
        <ToolResultOutputs results={toolResults} family={family} expandKey={expandKey} failed={outcome.verdict === "failed"} searchQuery={searchQuery} />
      </DetailZone>
    </ToolRow>
  );
}
