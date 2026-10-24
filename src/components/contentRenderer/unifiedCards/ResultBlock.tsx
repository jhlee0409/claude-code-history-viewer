import { RendererDefaultsContext } from "@/shared/rendererDefaults";
import { ToolExecutionResultRouter } from "../../messageRenderer/ToolExecutionResultRouter";
import type { ToolResultLike } from "./shared";

export function ResultBlock({
  results,
  searchQuery,
  isCurrentMatch,
  currentMatchIndex,
}: {
  results: ToolResultLike[];
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}) {
  // No result: the card's header already says "No result recorded"
  // (OutcomeStatus); a history viewer has nothing "pending" (TR0b).
  if (results.length === 0) return null;
  // The card itself is the collapsible; once it is open, the nested result
  // renderers should not demand a second click.
  return (
    <RendererDefaultsContext.Provider value={NESTED_OPEN}>
      <div className="mt-2 space-y-2">
        {results.map((result, idx) => {
          const content = result.content ?? result;
          return (
            <ToolExecutionResultRouter
              key={idx}
              toolResult={content as Record<string, unknown> | string | unknown[]}
              searchQuery={searchQuery}
              isCurrentMatch={isCurrentMatch}
              currentMatchIndex={currentMatchIndex}
            />
          );
        })}
      </div>
    </RendererDefaultsContext.Provider>
  );
}

const NESTED_OPEN = { defaultExpanded: true };
