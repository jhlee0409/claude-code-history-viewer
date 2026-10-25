/**
 * D-R1 (TR1a, owner decision A; amendment 8): the Default path's body,
 * chosen by the recorded tool name — one table, `BODY_BY_NAME`.
 *
 * | name | body |
 * |---|---|
 * | TodoWrite, todowrite | the structured todo list (TodoWriteToolRenderer's) |
 * | update_plan | the plan's explanation and steps (UpdatePlanToolRenderer's) |
 * | NotebookEdit | one summary line (mode · cell · type), then the new source |
 * | TaskCreate | one summary line (subject · active form), then the description |
 * | TaskUpdate | one summary line (status · subject · owner · blocks) |
 * | apply_patch | honest JSON: no parser of its patch exists in the tree yet (TR2b owns it) |
 * | any other name | honest JSON |
 *
 * A structured body needs its input's shape (`todos` / `plan` arrays); any
 * other shape falls back to the JSON. Input keys a structured body does not
 * show are kept in a JSON block after it, so nothing recorded is lost. The
 * JSON is never CSS-clipped: past its line cap it waits behind "Show all n
 * lines", a disclosure with `aria-expanded` + `aria-controls` (OutputBlock).
 * The Checklist pattern itself is TR4's; this only routes to the bodies that
 * exist. Lookups are `Object.hasOwn` (a tool named `constructor` is JSON).
 */
import type { ReactNode } from "react";
import { PathText } from "@/lib/format/PathText";
import { CodeTarget, TextTarget } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";
import { TodoWriteList, type TodoItem } from "../toolUseRenderers/TodoWriteToolRenderer";
import { UpdatePlanSteps, type UpdatePlanToolInput } from "../toolUseRenderers/UpdatePlanToolRenderer";
import { inputSummary, num, str } from "./shared";
import { InputJson, Leftover, Summary, type BodyContext } from "./toolBodyParts";

export type { BodyContext } from "./toolBodyParts";

export type BodyKind = "todo" | "plan" | "notebook" | "taskCreate" | "taskUpdate" | "json";

export const BODY_BY_NAME: Readonly<Record<string, BodyKind>> = {
  TodoWrite: "todo",
  // OpenCode records the same tool, with the same input, in lower case.
  todowrite: "todo",
  update_plan: "plan",
  NotebookEdit: "notebook",
  TaskCreate: "taskCreate",
  TaskUpdate: "taskUpdate",
  // Codex edits: a DiffView body needs a parser of its patch; none exists yet (TR2b).
  apply_patch: "json",
};

/** The body for a recorded tool name; every name the table does not list is `json`. */
export function bodyKindFor(name: string): BodyKind {
  return Object.hasOwn(BODY_BY_NAME, name) ? (BODY_BY_NAME[name] as BodyKind) : "json";
}

/** What a routed body gives its ToolRow. */
export interface RoutedBody {
  target?: ReactNode;
  meta?: ReactNode;
  body: ReactNode;
}

const TASK_STATUS_KEYS: Readonly<Record<string, string>> = {
  pending: "taskOperation.pending",
  in_progress: "taskOperation.inProgress",
  completed: "taskOperation.completed",
  deleted: "taskOperation.deleted",
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function todoBody(ctx: BodyContext): RoutedBody | null {
  if (!Array.isArray(ctx.input.todos)) return null;
  const todos = ctx.input.todos as TodoItem[];
  return {
    meta: <span>{ctx.t("taskOperation.itemCount", { count: todos.length })}</span>,
    body: (
      <>
        <TodoWriteList todos={todos} />
        <Leftover ctx={ctx} shown={["todos"]} />
      </>
    ),
  };
}

function planBody(ctx: BodyContext): RoutedBody | null {
  if (!Array.isArray(ctx.input.plan)) return null;
  const input = ctx.input as UpdatePlanToolInput;
  return {
    meta: <span>{ctx.t("taskOperation.taskCount", { count: (input.plan ?? []).length })}</span>,
    body: (
      <>
        <UpdatePlanSteps input={input} />
        <Leftover ctx={ctx} shown={["plan", "explanation"]} />
      </>
    ),
  };
}

function notebookBody(ctx: BodyContext): RoutedBody {
  const { input, t } = ctx;
  const path = str(input, "notebook_path");
  const cellNumber = num(input, "cell_number");
  const cellId = str(input, "cell_id");
  const source = str(input, "new_source");
  const cell = cellNumber != null ? `${t("rendererLabels.cell")} ${cellNumber}` : cellId ? `${t("rendererLabels.cell")} ${t("rendererLabels.id")}: ${cellId}` : null;
  return {
    target: path ? <PathText path={path} ctx={ctx.pathCtx} className="text-code text-fg" /> : undefined,
    body: (
      <>
        <Summary items={[str(input, "edit_mode"), cell, str(input, "cell_type")]} />
        {source != null && <OutputBlock text={source} source="file" wrap={false} expandKey={`${ctx.expandKey}-source`} searchQuery={ctx.searchQuery} />}
        <Leftover ctx={ctx} shown={["notebook_path", "cell_number", "cell_id", "new_source", "edit_mode", "cell_type"]} />
      </>
    ),
  };
}

function taskCreateBody(ctx: BodyContext): RoutedBody {
  const { input, t } = ctx;
  const subject = str(input, "subject");
  const description = str(input, "description");
  const activeForm = str(input, "activeForm");
  return {
    target: subject ? <TextTarget text={subject} /> : undefined,
    body: (
      <>
        <Summary items={[subject, activeForm && `${t("taskOperation.activeForm")} ${activeForm}`]} />
        {description && <p className="whitespace-pre-wrap text-list text-fg-2">{description}</p>}
        <Leftover ctx={ctx} shown={["subject", "description", "activeForm"]} />
      </>
    ),
  };
}

function taskUpdateBody(ctx: BodyContext): RoutedBody {
  const { input, t } = ctx;
  const taskId = str(input, "taskId");
  const status = str(input, "status");
  const owner = str(input, "owner");
  const blocks = strings(input.addBlocks);
  const blockedBy = strings(input.addBlockedBy);
  const statusLabel = status ? (Object.hasOwn(TASK_STATUS_KEYS, status) ? t(TASK_STATUS_KEYS[status] as string) : status) : null;
  return {
    target: taskId ? <TextTarget text={`${t("rendererLabels.task")} #${taskId}`} /> : undefined,
    body: (
      <>
        <Summary
          items={[
            statusLabel,
            str(input, "subject"),
            owner && `${t("rendererLabels.owner")} ${owner}`,
            blocks.length > 0 && `${t("rendererLabels.blocks")} ${blocks.map((id) => `#${id}`).join(" ")}`,
            blockedBy.length > 0 && `${t("rendererLabels.blockedBy")} ${blockedBy.map((id) => `#${id}`).join(" ")}`,
          ]}
        />
        <Leftover ctx={ctx} shown={["taskId", "status", "subject", "owner", "addBlocks", "addBlockedBy"]} />
      </>
    ),
  };
}

/** The generic body: the input summary as the target, the whole input as JSON. */
function jsonBody(ctx: BodyContext): RoutedBody {
  const summary = inputSummary(ctx.input);
  const target = !summary ? undefined : summary.isPath ? (
    <PathText path={summary.line} ctx={ctx.pathCtx} className="text-code text-fg" />
  ) : (
    <CodeTarget text={summary.text} full={summary.line} highlight={ctx.highlight} />
  );
  return { target, body: <InputJson value={ctx.input} ctx={ctx} /> };
}

/** The row's target, meta and body for a Default-path tool call. */
export function routedBody(name: string, ctx: BodyContext): RoutedBody {
  switch (bodyKindFor(name)) {
    case "todo":
      return todoBody(ctx) ?? jsonBody(ctx);
    case "plan":
      return planBody(ctx) ?? jsonBody(ctx);
    case "notebook":
      return notebookBody(ctx);
    case "taskCreate":
      return taskCreateBody(ctx);
    case "taskUpdate":
      return taskUpdateBody(ctx);
    case "json":
      return jsonBody(ctx);
  }
}
