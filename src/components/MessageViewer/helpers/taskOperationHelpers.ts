/**
 * Task Operation Helpers
 *
 * Groups consecutive TaskCreate/TaskUpdate/TaskGet/TaskList operations
 * and their results into unified task board views.
 *
 * Pattern detected:
 *   assistant (content has tool_use name=TaskCreate) →
 *   user (toolUseResult has {task: {...}}) →
 *   assistant (content has tool_use name=TaskCreate) →
 *   user (toolUseResult has {task: {...}})
 *
 * These sequences are grouped and rendered as a single task board.
 */

import type { ClaudeMessage } from "../../../types";

/** Recognized task operation tool names */
const TASK_TOOL_NAMES = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TodoWrite",
  "TodoRead",
]);

/** Time window (in milliseconds) for grouping task operations */
const TASK_GROUPING_WINDOW_MS = 5000;

/** A single task operation (tool_use call + result) */
export interface TaskOperation {
  /** The tool name (e.g., "TaskCreate") */
  toolName: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Result data if available */
  result?: Record<string, unknown>;
  /** Task data extracted from result */
  task?: {
    id?: string;
    subject?: string;
    status?: string;
    description?: string;
  };
}

/** Basic task info collected from TaskCreate across the entire conversation */
export interface TaskInfo {
  id: string;
  subject?: string;
  description?: string;
}

/** A group of task operations to render together */
export interface TaskOperationGroupResult {
  operations: TaskOperation[];
  messageUuids: Set<string>;
  /** Global task registry: id → info from TaskCreate anywhere in conversation */
  taskRegistry: Map<string, TaskInfo>;
}

/**
 * Check if a message is an assistant message containing task operation tool_use items
 */
function isTaskOperationAssistantMessage(message: ClaudeMessage): boolean {
  if (message.type !== "assistant" || !Array.isArray(message.content)) return false;
  return (message.content as unknown[]).some((item) => {
    if (item == null || typeof item !== "object") return false;
    const obj = item as Record<string, unknown>;
    return obj.type === "tool_use" && typeof obj.name === "string" && TASK_TOOL_NAMES.has(obj.name);
  });
}

/**
 * Check if a message is a user message with a task operation result
 * Shapes: {task: {...}}, {tasks: [...]}, {oldTodos: [...], newTodos: [...]}
 */
function isTaskResultMessage(message: ClaudeMessage): boolean {
  if (message.type !== "user" && message.type !== "assistant") return false;
  const msg = message as { toolUseResult?: unknown };
  if (!msg.toolUseResult || typeof msg.toolUseResult !== "object") return false;
  const result = msg.toolUseResult as Record<string, unknown>;
  // {task: {id, subject, ...}}
  if (result.task != null && typeof result.task === "object") return true;
  // {tasks: [...]} from TaskList
  if (Array.isArray(result.tasks)) return true;
  // TaskUpdate result: {success, taskId, updatedFields, statusChange}
  if (result.success != null && typeof result.taskId === "string") return true;
  return false;
}

/**
 * Extract task operations from an assistant message's content array
 */
function extractTaskOperations(message: ClaudeMessage): TaskOperation[] {
  if (!Array.isArray(message.content)) return [];
  const ops: TaskOperation[] = [];
  for (const item of message.content as unknown[]) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (obj.type === "tool_use" && typeof obj.name === "string" && TASK_TOOL_NAMES.has(obj.name)) {
      ops.push({
        toolName: obj.name,
        input: (obj.input as Record<string, unknown>) ?? {},
      });
    }
  }
  return ops;
}

/**
 * Extract task data from a result message
 */
function extractTaskResult(message: ClaudeMessage): Record<string, unknown> | null {
  if (message.type !== "user" && message.type !== "assistant") return null;
  const msg = message as { toolUseResult?: unknown };
  if (!msg.toolUseResult || typeof msg.toolUseResult !== "object") return null;
  return msg.toolUseResult as Record<string, unknown>;
}

/**
 * Group consecutive task operation messages.
 *
 * Scans messages in order, detecting sequences of alternating
 * assistant(task tool_use) and user(task result) messages.
 * Groups them within a 5-second timestamp window.
 */
export function groupTaskOperations(
  messages: ClaudeMessage[]
): Map<string, TaskOperationGroupResult> {
  const groups = new Map<string, TaskOperationGroupResult>();

  // Build global task registry from all TaskCreate operations in the conversation
  const taskRegistry = new Map<string, TaskInfo>();
  for (const msg of messages) {
    // Extract from assistant message TaskCreate tool_use
    if (msg.type === "assistant" && Array.isArray(msg.content)) {
      for (const item of msg.content as unknown[]) {
        if (item == null || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        if (obj.type === "tool_use" && obj.name === "TaskCreate") {
          const input = (obj.input as Record<string, unknown>) ?? {};
          const subject = typeof input.subject === "string" ? input.subject : undefined;
          const description = typeof input.description === "string" ? input.description : undefined;
          if (subject || description) {
            const toolUseId = typeof obj.id === "string" ? obj.id : undefined;
            if (toolUseId) {
              (taskRegistry as Map<string, TaskInfo & { _toolUseId?: string }>).set(`_pending_${toolUseId}`, {
                id: "",
                subject,
                description,
              });
            }
          }
        }
      }
    }
    // Extract from result messages (both assistant and user)
    const resultMsg = msg as { toolUseResult?: unknown };
    if (resultMsg.toolUseResult && typeof resultMsg.toolUseResult === "object") {
      const result = resultMsg.toolUseResult as Record<string, unknown>;
      if (result.task && typeof result.task === "object") {
        const task = result.task as Record<string, unknown>;
        const id = task.id != null ? String(task.id) : undefined;
        if (id && !taskRegistry.has(id)) {
          taskRegistry.set(id, {
            id,
            subject: typeof task.subject === "string" ? task.subject : (typeof task.description === "string" ? task.description : undefined),
            description: typeof task.description === "string" ? task.description : undefined,
          });
        }
      }
    }
  }

  let currentGroup: {
    leaderId: string;
    operations: TaskOperation[];
    messageUuids: Set<string>;
    lastTimestamp: number;
    pendingOps: TaskOperation[];
  } | null = null;

  const flushGroup = () => {
    if (currentGroup && currentGroup.operations.length > 0) {
      groups.set(currentGroup.leaderId, {
        operations: currentGroup.operations,
        messageUuids: currentGroup.messageUuids,
        taskRegistry,
      });
    }
    currentGroup = null;
  };

  for (const msg of messages) {
    const msgTime = new Date(msg.timestamp).getTime();
    if (isNaN(msgTime)) continue;

    if (isTaskOperationAssistantMessage(msg)) {
      const ops = extractTaskOperations(msg);
      if (ops.length === 0) continue;

      if (currentGroup && Math.abs(msgTime - currentGroup.lastTimestamp) <= TASK_GROUPING_WINDOW_MS) {
        // Continue current group
        currentGroup.pendingOps = ops;
        currentGroup.messageUuids.add(msg.uuid);
        currentGroup.lastTimestamp = msgTime;
      } else {
        // Flush previous group, start new
        flushGroup();
        currentGroup = {
          leaderId: msg.uuid,
          operations: [],
          messageUuids: new Set([msg.uuid]),
          lastTimestamp: msgTime,
          pendingOps: ops,
        };
      }
    } else if (isTaskResultMessage(msg) && currentGroup) {
      if (Math.abs(msgTime - currentGroup.lastTimestamp) <= 5000) {
        // Link result to pending operations
        const result = extractTaskResult(msg);
        if (result && currentGroup.pendingOps.length > 0) {
          for (const op of currentGroup.pendingOps) {
            op.result = result;
            if (result.task && typeof result.task === "object") {
              const task = result.task as Record<string, unknown>;
              op.task = {
                id: task.id != null ? String(task.id) : (task.task_id != null ? String(task.task_id) : undefined),
                subject: typeof task.subject === "string" ? task.subject : (typeof op.input.subject === "string" ? op.input.subject : undefined),
                status: typeof task.status === "string" ? task.status : undefined,
                description: typeof task.description === "string" ? task.description : (typeof op.input.description === "string" ? op.input.description : undefined),
              };
            } else if (typeof result.taskId === "string") {
              // TaskUpdate result: {success, taskId, statusChange: {from, to}}
              const statusChange = result.statusChange as Record<string, string> | undefined;
              op.task = {
                id: result.taskId as string,
                status: statusChange?.to ?? undefined,
                subject: (op.input.subject as string | undefined) ?? undefined,
              };
            }
            currentGroup.operations.push(op);
          }
          currentGroup.pendingOps = [];
        }
        currentGroup.messageUuids.add(msg.uuid);
        currentGroup.lastTimestamp = msgTime;
      } else {
        flushGroup();
      }
    } else {
      // Skip progress/system messages — they shouldn't break task grouping
      if (msg.type === "progress" || msg.type === "system") {
        continue;
      }
      // Non-task message: if we have pending ops waiting for results, keep waiting
      // Only flush pending ops without results if timestamp gap exceeded
      if (currentGroup) {
        if (Math.abs(msgTime - currentGroup.lastTimestamp) > TASK_GROUPING_WINDOW_MS) {
          // Flush pending ops without results
          for (const op of currentGroup.pendingOps) {
            currentGroup.operations.push(op);
          }
          currentGroup.pendingOps = [];
          flushGroup();
        }
        // Otherwise keep group open — result may come after non-task messages
      }
    }
  }

  // Flush remaining
  if (currentGroup && currentGroup.pendingOps.length > 0) {
    for (const op of currentGroup.pendingOps) {
      currentGroup.operations.push(op);
    }
    currentGroup.pendingOps = [];
  }
  flushGroup();

  return groups;
}
