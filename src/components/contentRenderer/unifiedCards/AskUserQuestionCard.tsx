import { memo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Renderer } from "@/shared/RendererHeader";
import { ToolIcon } from "../../ToolIcon";
import { getToolVariant } from "@/utils/toolIconUtils";
import { getVariantStyles, layout } from "../../renderers";
import { HighlightedText } from "../../common/HighlightedText";
import type { Props } from "./shared";
import { isError } from "./shared";
import { StatusBadge } from "./StatusBadge";
import { ResultBlock } from "./ResultBlock";
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
              description:
                typeof o.description === "string" ? o.description : undefined,
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

export const AskUserQuestionCard = memo(function AskUserQuestionCard({
  toolUse,
  toolResults,
  searchQuery = "",
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) {
  const { t } = useTranslation();
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

  const toolName = (toolUse.name as string) || "AskUserQuestion";
  const toolId = (toolUse.id as string) || "";
  const variant = getToolVariant(toolName);
  const styles = getVariantStyles(variant);

  // Reveal + highlight when the search term is anywhere in the questions or
  // options, so a match inside a collapsed card is actually visible. #429
  const haystack = questions
    .flatMap((q) => [
      q.header ?? "",
      q.question,
      ...q.options.flatMap((o) => [o.label, o.description ?? ""]),
    ])
    .join(" ")
    .toLowerCase();
  const matchesSearch =
    !!searchQuery && haystack.includes(searchQuery.toLowerCase());

  const highlight = (text: string): ReactNode =>
    searchQuery ? (
      <HighlightedText
        text={text}
        searchQuery={searchQuery}
        isCurrentMatch={isCurrentMatch}
        currentMatchIndex={currentMatchIndex}
      />
    ) : (
      text
    );

  return (
    <Renderer
      className={styles.container}
      hasError={toolResults.length > 0 && toolResults.some(isError)}
      expandKey={`unified-ask-${toolId}`}
      autoExpand={matchesSearch}
    >
      <Renderer.Header
        title={toolName}
        icon={<ToolIcon toolName={toolName} className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            <StatusBadge results={toolResults} />
            {toolId && (
              <code className={cn(layout.monoText, "hidden md:inline px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                {t("common.id")}: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className="space-y-3">
          {questions.map((q, qi) => {
            const OptionIcon = q.multiSelect ? CheckSquare : Circle;
            return (
              <div key={qi} className="border-l-2 border-border pl-3">
                {q.header && (
                  <div className={cn(layout.monoText, "mb-1 inline-block px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                    {highlight(q.header)}
                  </div>
                )}
                <div className={cn(layout.bodyText, "font-semibold text-foreground whitespace-pre-wrap")}>
                  {highlight(q.question)}
                </div>
                {q.options.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <li key={oi} className={cn("flex items-start", layout.iconGap)}>
                        <OptionIcon className={cn(layout.iconSizeSmall, "mt-0.5 shrink-0 text-muted-foreground")} />
                        <div className="min-w-0">
                          <div className={cn(layout.bodyText, "text-foreground")}>
                            {highlight(opt.label)}
                          </div>
                          {opt.description && (
                            <div className={cn(layout.smallText, "text-muted-foreground whitespace-pre-wrap")}>
                              {highlight(opt.description)}
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
        <ResultBlock
          results={toolResults}
          searchQuery={searchQuery}
          isCurrentMatch={isCurrentMatch}
          currentMatchIndex={currentMatchIndex}
        />
      </Renderer.Content>
    </Renderer>
  );
});
