/**
 * A one-line body value of a result (a search result's title or URL, a
 * fetched URL, a file path): cut with an ellipsis, or wrapped when it holds
 * the search hit its row was opened for, so the mark is never behind the
 * ellipsis (CodeRabbit 4378494005 on PR #746). Without a hit the line keeps
 * its ellipsis.
 */
import { searchHits } from "./unifiedCards/shared";
import type { TextHighlight } from "../transcript/ToolRow";

export const oneLineValueClass = (text: string, highlight: TextHighlight | undefined): string =>
  searchHits(highlight?.searchQuery, text) ? "min-w-0 break-words" : "truncate";
