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

  const ensureProjectExpanded = useCallback(
    (projectPath: string, groupKey?: string) => {
      if (!projectPath) return;

      setExpandedProjects((prev) => {
        if (prev.has(projectPath) && (!groupKey || prev.has(groupKey))) {
          return prev;
        }

        const next = new Set(prev);
        next.add(projectPath);
        if (groupKey) {
          next.add(groupKey);
        }
        return next;
      });
    },
    []
  );

  const isProjectExpanded = useCallback(
    (projectPath: string) => {
      return expandedProjects.has(projectPath);
    },
    [expandedProjects]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, project: ClaudeProject, providerSiblings?: ClaudeProject[]) => {
      e.preventDefault();
      const boundary = e.currentTarget
        .closest<HTMLElement>("[data-menu-boundary]")
        ?.getBoundingClientRect() ?? null;
      // Keyboard-opened menus (ContextMenu key / Shift+F10) carry no pointer
      // position; anchor them to the row instead.
      const anchor = e.currentTarget.getBoundingClientRect();
      const x = e.clientX || anchor.left + 24;
      const y = e.clientY || anchor.bottom;
      setContextMenu({
        project,
        providerSiblings,
        position: { x, y, boundary },
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
    ensureProjectExpanded,
    isProjectExpanded,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
  };
}
