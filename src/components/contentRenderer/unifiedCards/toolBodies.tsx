/**
 * D-R1 (TR1a): the Default path's body, chosen by the recorded tool name.
 * Skeleton for the red tests: the table is empty and every name falls back
 * to the generic JSON body. The routing lands with TR1a's fix commit.
 */
export type BodyKind = "todo" | "plan" | "notebook" | "taskCreate" | "taskUpdate" | "json";

export const BODY_BY_NAME: Readonly<Record<string, BodyKind>> = {};

export function bodyKindFor(name: string): BodyKind {
  void name;
  return "json";
}
