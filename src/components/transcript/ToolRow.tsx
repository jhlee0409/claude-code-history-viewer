/**
 * ToolRow (plan §4.3, TR0) — RED-phase stub with the final props.
 */
import type { ReactNode } from "react";
import type { ToolFamily, ToolOutcome } from "./toolOutcome";

export interface ToolRowProps {
  icon: ReactNode;
  verb: string;
  target?: ReactNode;
  meta?: ReactNode;
  outcome: ToolOutcome;
  family: ToolFamily;
  toolId?: string;
  expandKey: string;
  autoExpand?: boolean;
  children?: ReactNode;
}

export function ToolRow({ verb }: ToolRowProps) {
  return <div>{verb}</div>;
}
