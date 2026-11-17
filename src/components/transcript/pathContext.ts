/**
 * The base a tool target path is shown relative to (plan §4.4, F3a): the
 * open project's root and the user's home, both only when the app knows them
 * for certain. Anything else stays whole (`formatPath` → `absolute`).
 */
import { useMemo } from "react";
import type { PathContext } from "@/lib/format/path";
import { useAppStore } from "@/store/useAppStore";

export function useToolPathContext(): PathContext {
  const projectRoot = useAppStore((s) => s.selectedProject?.actual_path ?? null);
  const homeDir = useAppStore((s) => s.homeDir);
  return useMemo(() => ({ projectRoot, homeDir }), [projectRoot, homeDir]);
}
