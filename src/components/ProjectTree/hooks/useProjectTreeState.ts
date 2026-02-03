// src/components/ProjectTree/hooks/useProjectTreeState.ts
import { useState, useCallback, useRef, useEffect } from "react";
import type { ClaudeProject } from "../../../types";
import type { GroupingMode } from "../../../types/metadata.types";
import type { ContextMenuState } from "../types";

export function useProjectTreeState(groupingMode: GroupingMode) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Reset expandedProjects when grouping mode changes
  const prevGroupingMode = useRef(groupingMode);
  useEffect(() => {
    if (prevGroupingMode.current !== groupingMode) {
      setExpandedProjects(new Set());
      prevGroupingMode.current = groupingMode;
    }
  }, [groupingMode]);

  const toggleProject = useCallback((projectPath: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }, []);

  const isProjectExpanded = useCallback(
    (projectPath: string) => {
      return expandedProjects.has(projectPath);
    },
    [expandedProjects]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, project: ClaudeProject) => {
      e.preventDefault();
      setContextMenu({
        project,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    expandedProjects,
    setExpandedProjects,
    toggleProject,
    isProjectExpanded,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
  };
}
