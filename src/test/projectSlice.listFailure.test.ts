/**
 * A session-list failure marks the tab's project unavailable only when the
 * project's folder is gone - the backend's "Failed to resolve project_path"
 * with the OS's not-found code (`src-tauri/src/commands/session/load.rs`).
 * Any other failure may pass and keeps the tab as it is (PR #673 review).
 */
import { describe, expect, it } from "vitest";
import { isProjectFolderGone } from "@/store/slices/projectSlice";

describe("isProjectFolderGone", () => {
  it.each([
    "Failed to resolve project_path: No such file or directory (os error 2)",
    "Failed to resolve project_path: The system cannot find the file specified. (os error 2)",
    "Failed to resolve project_path: The system cannot find the path specified. (os error 3)",
  ])("a missing folder: %s", (message) => {
    expect(isProjectFolderGone(new Error(message))).toBe(true);
    expect(isProjectFolderGone(message)).toBe(true);
  });

  it.each([
    "Failed to resolve project_path: Permission denied (os error 13)",
    "Failed to read session: The process cannot access the file because it is being used by another process. (os error 32)",
    "Failed to open /p/a/x.jsonl: No such file or directory (os error 2)",
    "Failed to fetch",
    "Task join error: task 12 panicked",
  ])("anything else: %s", (message) => {
    expect(isProjectFolderGone(new Error(message))).toBe(false);
  });
});
