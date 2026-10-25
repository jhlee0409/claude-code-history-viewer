/**
 * DetailZone — inert skeleton (red commit only): renders its children as is.
 * The labelled input / result zones land in the next commit.
 */
import type { ReactNode } from "react";

export type DetailZoneKind = "input" | "result";

export interface DetailZoneProps {
  kind: DetailZoneKind;
  meta?: ReactNode;
  show?: boolean | "whenTargetCut";
  children?: ReactNode;
}

export function DetailZone({ children }: DetailZoneProps) {
  return <>{children}</>;
}
