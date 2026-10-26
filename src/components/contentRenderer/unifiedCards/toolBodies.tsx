/**
 * D-R1 (TR1a, owner decision A; amendment 8): the Default path's body,
 * chosen by the recorded tool name — one table, `BODY_BY_NAME`. Every body
 * is a view of the recorded input: DefaultCard puts it in the Input zone
 * (DetailZone), the results in the Result zone.
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
 * A structured body is a lossless, searchable view of the recorded input
 * (TR1a fix round 1):
 * 1. Shape gate: a body is chosen only when the input fully matches the
 *    shape it reads — every array member an object, every field it reads of
 *    the type it expects, every status one it shows as itself (the todo
 *    list draws no own mark for `cancelled`; the plan steps would label
 *    `blocked` "Pending"). Anything else is the honest JSON of the whole
 *    input, so a malformed record never throws (`plan: [null]`).
 * 2. Nothing recorded is lost: what the body does not show — top level and
 *    nested (`activeForm`, item ids, the `medium` priority the list leaves
 *    out, unknown keys, an empty value) — stays in an "other recorded
 *    fields" JSON block after it. What is "shown" is what the body renders,
 *    per key and per member (`unshown`).
 * 3. Every search hit counted in the input is marked in the opened row
 *    (fix round 2): targets, summary line, item and step text, explanation,
 *    notebook source and path (the whole shown path, a hit may span folder
 *    and name), description and the leftover JSON all mark the hits; a
 *    capped block opens for a hit. A field counts as shown only where its
 *    recorded text appears verbatim: a status drawn as an icon or a
 *    translated label, a path shown relative to a base, is shown for display
 *    only, and while the query hits its recorded value it is in the leftover
 *    JSON with that value, marked (`shownAs`). No query, or no hit there:
 *    the body is exactly as without search.
 *
 * The JSON is never CSS-clipped: past its line cap it waits behind "Show all
 * n lines", a disclosure with `aria-expanded` + `aria-controls`
 * (OutputBlock). The Checklist pattern itself is TR4's; this only routes to
 * the bodies that exist. Lookups are `Object.hasOwn` (a tool named
 * `constructor` is JSON).
 */
import type { ReactNode } from "react";
import { PathText } from "@/lib/format/PathText";
import { formatPath } from "@/lib/format/path";
import { CodeTarget, Marked, TextTarget } from "../../transcript/ToolRow";
import { OutputBlock } from "../../transcript/OutputBlock";
import { TodoWriteList, UpdatePlanSteps, type TodoItem, type UpdatePlanToolInput } from "./checklistBodies";
import { inputSummary, num, str } from "./shared";
import { fieldsFit, isNonEmptyArray, isNonEmptyString, isNumber, isRecord, isString, isStringArray, keysCaption, SHOWN, shownAs, shownIf, unshown, unshownMembers } from "./recordShape";
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
  /** Caption meta on the Input zone's label line (the JSON fallback: its keys). */
  inputMeta?: ReactNode;
  /** The Input zone's content. */
  body: ReactNode;
}

const TASK_STATUS_KEYS: Readonly<Record<string, string>> = {
  pending: "taskOperation.pending",
  in_progress: "taskOperation.inProgress",
  completed: "taskOperation.completed",
  deleted: "taskOperation.deleted",
};

/** The label a task / plan status is shown as (the gates admit only listed statuses where a label is drawn). */
const statusLabel = (t: BodyContext["t"], status: string): string => (Object.hasOwn(TASK_STATUS_KEYS, status) ? t(TASK_STATUS_KEYS[status] as string) : status);

/** The output-block form of the context's search marks. */
const blockHighlight = (ctx: BodyContext) => (ctx.highlight ? { isCurrentMatch: ctx.highlight.isCurrentMatch, currentMatchIndex: ctx.highlight.currentMatchIndex } : undefined);

// TodoWrite ------------------------------------------------------------------

/** The statuses TodoWriteList draws a mark of their own for (any other would read as "pending"). */
const TODO_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"]);

const isTodoItem = (value: unknown): boolean =>
  isRecord(value) && typeof value.status === "string" && TODO_STATUSES.has(value.status) && fieldsFit(value, { content: isString, priority: isString, id: isString });

/**
 * What TodoWriteList shows of an item: its content, its status (as an icon
 * only: retained while the query hits it) and a priority other than
 * `medium`. An item without content it prints whole, as JSON. The id is only
 * a React key: it stays unshown.
 */
const todoUnshown =
  (searchQuery: string | undefined) =>
  (todo: Record<string, unknown>): Record<string, unknown> =>
    Object.hasOwn(todo, "content")
      ? unshown(todo, { content: SHOWN, status: shownAs(() => "", searchQuery), priority: shownIf((v) => isNonEmptyString(v) && v !== "medium") })
      : {};

function todoBody(ctx: BodyContext): RoutedBody | null {
  const { todos } = ctx.input;
  if (!Array.isArray(todos) || !todos.every(isTodoItem)) return null;
  return {
    meta: <span>{ctx.t("taskOperation.itemCount", { count: todos.length })}</span>,
    body: (
      <>
        <TodoWriteList todos={todos as TodoItem[]} highlight={ctx.highlight} />
        <Leftover ctx={ctx} rest={unshown(ctx.input, { todos: unshownMembers(todoUnshown(ctx.highlight?.searchQuery)) })} />
      </>
    ),
  };
}

// update_plan ----------------------------------------------------------------

/** The statuses UpdatePlanSteps labels as themselves (any other would read "Pending"). */
const PLAN_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed", "deleted"]);

const isPlanStep = (value: unknown): boolean => isRecord(value) && typeof value.status === "string" && PLAN_STATUSES.has(value.status) && fieldsFit(value, { step: isString });

function planBody(ctx: BodyContext): RoutedBody | null {
  const { plan } = ctx.input;
  if (!Array.isArray(plan) || !plan.every(isPlanStep) || !fieldsFit(ctx.input, { explanation: isString })) return null;
  // UpdatePlanSteps shows a non-empty explanation, and each step's text and status label (a translated label).
  const status = shownAs((value) => statusLabel(ctx.t, value as string), ctx.highlight?.searchQuery);
  const rest = unshown(ctx.input, { explanation: shownIf(isNonEmptyString), plan: unshownMembers((step) => unshown(step, { step: SHOWN, status })) });
  return {
    meta: <span>{ctx.t("taskOperation.taskCount", { count: plan.length })}</span>,
    body: (
      <>
        <UpdatePlanSteps input={ctx.input as UpdatePlanToolInput} highlight={ctx.highlight} />
        <Leftover ctx={ctx} rest={rest} />
      </>
    ),
  };
}

// NotebookEdit ---------------------------------------------------------------

function notebookBody(ctx: BodyContext): RoutedBody | null {
  const { input, t } = ctx;
  if (!fieldsFit(input, { notebook_path: isString, cell_number: isNumber, cell_id: isString, new_source: isString, edit_mode: isString, cell_type: isString })) return null;
  const path = str(input, "notebook_path");
  const cellNumber = num(input, "cell_number");
  const cellId = str(input, "cell_id");
  const source = str(input, "new_source");
  const cell = cellNumber != null ? `${t("rendererLabels.cell")} ${cellNumber}` : cellId ? `${t("rendererLabels.cell")} ${t("rendererLabels.id")}: ${cellId}` : null;
  // The summary names the cell by its number when there is one; the id then
  // stays unshown. The path is shown as PathText shows it (maybe relative).
  const shownPath = (value: unknown) => {
    const shown = formatPath(value as string, ctx.pathCtx);
    return `${shown.dir}${shown.name}`;
  };
  const rest = unshown(input, {
    notebook_path: shownIf(isNonEmptyString, shownAs(shownPath, ctx.highlight?.searchQuery)),
    cell_number: SHOWN,
    cell_id: shownIf((v) => cellNumber == null && isNonEmptyString(v)),
    new_source: SHOWN,
    edit_mode: shownIf(isNonEmptyString),
    cell_type: shownIf(isNonEmptyString),
  });
  return {
    target: path ? <PathText path={path} ctx={ctx.pathCtx} className="text-code text-fg" highlight={ctx.highlight} /> : undefined,
    body: (
      <>
        <Summary items={[str(input, "edit_mode"), cell, str(input, "cell_type")]} highlight={ctx.highlight} />
        {source != null && (
          <OutputBlock text={source} source="file" wrap={false} expandKey={`${ctx.expandKey}-source`} searchQuery={ctx.searchQuery} highlight={blockHighlight(ctx)} />
        )}
        <Leftover ctx={ctx} rest={rest} />
      </>
    ),
  };
}

// TaskCreate / TaskUpdate ----------------------------------------------------

function taskCreateBody(ctx: BodyContext): RoutedBody | null {
  const { input, t } = ctx;
  if (!fieldsFit(input, { subject: isString, description: isString, activeForm: isString })) return null;
  const subject = str(input, "subject");
  const description = str(input, "description");
  const activeForm = str(input, "activeForm");
  const rest = unshown(input, { subject: shownIf(isNonEmptyString), description: shownIf(isNonEmptyString), activeForm: shownIf(isNonEmptyString) });
  return {
    target: subject ? <TextTarget text={subject} highlight={ctx.highlight} /> : undefined,
    body: (
      <>
        <Summary items={[subject, activeForm && `${t("taskOperation.activeForm")} ${activeForm}`]} highlight={ctx.highlight} />
        {description && (
          <p className="whitespace-pre-wrap text-list text-fg-2">
            <Marked text={description} highlight={ctx.highlight} />
          </p>
        )}
        <Leftover ctx={ctx} rest={rest} />
      </>
    ),
  };
}

function taskUpdateBody(ctx: BodyContext): RoutedBody | null {
  const { input, t } = ctx;
  if (!fieldsFit(input, { taskId: isString, status: isString, subject: isString, owner: isString, addBlocks: isStringArray, addBlockedBy: isStringArray })) return null;
  const taskId = str(input, "taskId");
  const status = str(input, "status");
  const owner = str(input, "owner");
  const blocks = (input.addBlocks as string[] | undefined) ?? [];
  const blockedBy = (input.addBlockedBy as string[] | undefined) ?? [];
  const label = status ? statusLabel(t, status) : null;
  const rest = unshown(input, {
    taskId: shownIf(isNonEmptyString),
    // A listed status is shown as its translated label, any other as recorded.
    status: shownIf(isNonEmptyString, shownAs(() => label ?? "", ctx.highlight?.searchQuery)),
    subject: shownIf(isNonEmptyString),
    owner: shownIf(isNonEmptyString),
    addBlocks: shownIf(isNonEmptyArray),
    addBlockedBy: shownIf(isNonEmptyArray),
  });
  return {
    target: taskId ? <TextTarget text={`${t("rendererLabels.task")} #${taskId}`} highlight={ctx.highlight} /> : undefined,
    body: (
      <>
        <Summary
          items={[
            label,
            str(input, "subject"),
            owner && `${t("rendererLabels.owner")} ${owner}`,
            blocks.length > 0 && `${t("rendererLabels.blocks")} ${blocks.map((id) => `#${id}`).join(" ")}`,
            blockedBy.length > 0 && `${t("rendererLabels.blockedBy")} ${blockedBy.map((id) => `#${id}`).join(" ")}`,
          ]}
          highlight={ctx.highlight}
        />
        <Leftover ctx={ctx} rest={rest} />
      </>
    ),
  };
}

// Any other name -------------------------------------------------------------

/** The generic body: the input summary as the target, the whole input as JSON. */
function jsonBody(ctx: BodyContext): RoutedBody {
  const summary = inputSummary(ctx.input);
  const target = !summary ? undefined : summary.isPath ? (
    <PathText path={summary.line} ctx={ctx.pathCtx} className="text-code text-fg" highlight={ctx.highlight} />
  ) : (
    <CodeTarget text={summary.text} full={summary.line} highlight={ctx.highlight} />
  );
  const keys = keysCaption(ctx.input);
  return { target, inputMeta: keys ? <span>{keys}</span> : undefined, body: <InputJson value={ctx.input} ctx={ctx} /> };
}

const STRUCTURED: Readonly<Record<Exclude<BodyKind, "json">, (ctx: BodyContext) => RoutedBody | null>> = {
  todo: todoBody,
  plan: planBody,
  notebook: notebookBody,
  taskCreate: taskCreateBody,
  taskUpdate: taskUpdateBody,
};

/**
 * The row's target, meta and body for a Default-path tool call: its
 * structured body when the input (an object) fits it, else the JSON.
 */
export function routedBody(name: string, ctx: BodyContext): RoutedBody {
  const kind = bodyKindFor(name);
  return (kind === "json" || !isRecord(ctx.input) ? null : STRUCTURED[kind](ctx)) ?? jsonBody(ctx);
}
