/**
 * DiffView (plan §4.3, TR2a): skeleton of the unified diff view's contract.
 * The implementation lands with the fix commits.
 */

/** One old → new replacement. `oldStart` / `newStart`: the first line's number in the file (default 1). */
export interface DiffSection {
  oldText: string;
  newText: string;
  oldStart?: number;
  newStart?: number;
}

export interface DiffViewProps {
  sections: DiffSection[];
  /** Capture-registry key prefix for the cap and gap disclosures. */
  expandKey: string;
  /** Rows shown before "Show n more lines". */
  lineCap?: number;
  /** Unchanged lines kept around each change; farther ones fold into a gap row. */
  context?: number;
  /** Accessible name of the diff table (e.g. the file's relative path). */
  label?: string;
}

export function DiffView(props: DiffViewProps) {
  void props;
  return null;
}
