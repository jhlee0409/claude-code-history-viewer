// src/components/ProjectTree.tsx
import React, { useState } from "react";
import {
  Folder,
  Wrench,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Database,
  Clock,
  Hash,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { ClaudeProject, ClaudeSession } from "../types";
import { cn } from "@/lib/utils";
import { getLocale } from "../utils/time";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectTreeProps {
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  onProjectSelect: (project: ClaudeProject) => void;
  onSessionSelect: (session: ClaudeSession) => void;
  onGlobalStatsClick: () => void;
  isLoading: boolean;
  isViewingGlobalStats: boolean;
  width?: number;
  isResizing?: boolean;
  onResizeStart?: (e: React.MouseEvent<HTMLElement>) => void;
}

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  projects,
  sessions,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onGlobalStatsClick,
  isLoading,
  isViewingGlobalStats,
  width,
  isResizing,
  onResizeStart,
}) => {
  const [expandedProject, setExpandedProject] = useState("");
  const { t, i18n } = useTranslation();

  const formatTimeAgo = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      const currentLanguage = i18n.language || "en";
      const locale = getLocale(currentLanguage);

      if (diffMins < 60) {
        return t("common.time.minutesAgo", { count: diffMins });
      } else if (diffHours < 24) {
        return t("common.time.hoursAgo", { count: diffHours });
      } else if (diffDays < 7) {
        return t("common.time.daysAgo", { count: diffDays });
      } else {
        return date.toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
        });
      }
    } catch {
      return dateStr;
    }
  };

  const toggleProject = (projectPath: string) => {
    setExpandedProject((prev) => (prev === projectPath ? "" : projectPath));
  };

  const sidebarStyle = width ? { width: `${width}px` } : undefined;

  return (
    <aside
      className={cn(
        "flex-shrink-0 bg-sidebar border-r-0 flex h-full",
        !width && "w-64",
        isResizing && "select-none"
      )}
      style={sidebarStyle}
    >
      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Right accent border */}
        <div className="absolute right-0 inset-y-0 w-[2px] bg-gradient-to-b from-accent/40 via-accent/60 to-accent/40" />

        {/* Sidebar Header */}
      <div className="px-4 py-3 bg-accent/5 border-b border-accent/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-widest text-accent">
              {t("components:project.explorer", "Explorer")}
            </span>
          </div>
          <span className="text-xs font-mono text-accent bg-accent/10 px-2 py-0.5 rounded-full">
            {projects.length}
          </span>
        </div>
      </div>

      {/* Projects List */}
      <OverlayScrollbarsComponent
        className="relative flex-1 py-2"
        options={{
          scrollbars: {
            theme: "os-theme-custom",
            autoHide: "leave",
            autoHideDelay: 400,
          },
          overflow: {
            x: "hidden",
          },
        }}
      >
        {projects.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted/30 flex items-center justify-center">
              <Folder className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("components:project.notFound", "No projects found")}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 animate-stagger">
            {/* Global Stats Button */}
            <button
              onClick={onGlobalStatsClick}
              className={cn(
                "sidebar-item w-full flex items-center gap-3 mx-2 group",
                "text-left transition-all duration-300",
                isViewingGlobalStats && "active"
              )}
              style={{ width: "calc(100% - 16px)" }}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300",
                  "bg-accent/10 text-accent",
                  "group-hover:bg-accent/20 group-hover:shadow-sm group-hover:shadow-accent/20",
                  isViewingGlobalStats && "bg-accent/20 shadow-glow"
                )}
              >
                <Database className="w-4 h-4 transition-transform group-hover:scale-110" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-sidebar-foreground">
                  {t("components:project.globalStats", "Global Statistics")}
                </div>
                <div className="text-2xs text-muted-foreground">
                  {t("components:project.globalStatsDescription", "All projects overview")}
                </div>
              </div>
            </button>

            {/* Divider */}
            <div className="my-2 mx-4 h-px bg-sidebar-border" />

            {/* Projects */}
            {projects.map((project) => {
              const isExpanded = expandedProject === project.path;

              return (
                <div key={project.path}>
                  {/* Project Item */}
                  <button
                    onClick={() => {
                      onProjectSelect(project);
                      toggleProject(project.path);
                    }}
                    className={cn(
                      "w-full px-4 py-2.5 flex items-center gap-2.5",
                      "text-left transition-all duration-300",
                      "hover:bg-accent/8 hover:pl-5",
                      "border-l-2 border-transparent",
                      isExpanded && "bg-accent/10 border-l-accent pl-5"
                    )}
                  >
                    {/* Expand Icon */}
                    <span
                      className={cn(
                        "transition-all duration-300",
                        isExpanded ? "text-accent" : "text-muted-foreground"
                      )}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>

                    {/* Folder Icon */}
                    <div
                      className={cn(
                        "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
                        isExpanded
                          ? "bg-accent/20 text-accent"
                          : "bg-muted/50 text-muted-foreground"
                      )}
                    >
                      <Folder className="w-3.5 h-3.5" />
                    </div>

                    {/* Project Name */}
                    <span
                      className={cn(
                        "text-sm truncate flex-1 transition-colors duration-300",
                        isExpanded
                          ? "text-accent font-semibold"
                          : "text-sidebar-foreground/80"
                      )}
                    >
                      {project.name}
                    </span>

                    {/* Session count badge */}
                    {isExpanded && sessions.length > 0 && (
                      <span className="text-2xs font-mono text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">
                        {sessions.length}
                      </span>
                    )}
                  </button>

                  {/* Sessions List */}
                  {isExpanded && sessions.length > 0 && !isLoading && (
                    <div className="ml-6 pl-3 border-l-2 border-accent/20 space-y-1 py-2">
                      {sessions.map((session) => {
                        const isSessionSelected =
                          selectedSession?.session_id === session.session_id;

                        return (
                          <button
                            key={session.session_id}
                            onClick={() => {
                              if (!isSessionSelected) {
                                onSessionSelect(session);
                              }
                            }}
                            className={cn(
                              "w-full flex flex-col gap-1.5 py-2.5 px-3 rounded-lg",
                              "text-left transition-all duration-300",
                              "hover:bg-accent/8",
                              isSessionSelected
                                ? "bg-accent/15 shadow-sm shadow-accent/10 ring-1 ring-accent/20"
                                : "bg-transparent"
                            )}
                            style={{ width: "calc(100% - 8px)" }}
                          >
                            {/* Session Header */}
                            <div className="flex items-start gap-2.5">
                              <div
                                className={cn(
                                  "w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-300",
                                  isSessionSelected
                                    ? "bg-accent text-accent-foreground"
                                    : "bg-muted/50 text-muted-foreground"
                                )}
                              >
                                <MessageCircle className="w-3 h-3" />
                              </div>
                              <span
                                className={cn(
                                  "text-xs leading-relaxed line-clamp-2 transition-colors duration-300",
                                  isSessionSelected
                                    ? "text-accent font-medium"
                                    : "text-sidebar-foreground/70"
                                )}
                              >
                                {session.summary ||
                                  t(
                                    "components:session.summaryNotFound",
                                    "No summary"
                                  )}
                              </span>
                            </div>

                            {/* Session Meta */}
                            <div className="flex items-center gap-3 ml-7 text-2xs">
                              <span
                                className={cn(
                                  "flex items-center gap-1 font-mono",
                                  isSessionSelected
                                    ? "text-accent/80"
                                    : "text-muted-foreground"
                                )}
                              >
                                <Clock className="w-3 h-3" />
                                {formatTimeAgo(session.last_modified)}
                              </span>
                              <span
                                className={cn(
                                  "flex items-center gap-1 font-mono",
                                  isSessionSelected
                                    ? "text-accent/80"
                                    : "text-muted-foreground"
                                )}
                              >
                                <Hash className="w-3 h-3" />
                                {session.message_count}
                              </span>
                              {session.has_tool_use && (
                                <Wrench
                                  className={cn(
                                    "w-3 h-3",
                                    isSessionSelected
                                      ? "text-accent"
                                      : "text-accent/50"
                                  )}
                                />
                              )}
                              {session.has_errors && (
                                <AlertTriangle className="w-3 h-3 text-destructive" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Loading State */}
                  {isExpanded && isLoading && (
                    <div className="ml-6 pl-3 border-l-2 border-accent/20 space-y-2 py-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-2.5 py-2 px-3">
                          <Skeleton variant="circular" className="w-5 h-5" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3 w-3/4" />
                            <Skeleton className="h-2 w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty Sessions */}
                  {isExpanded && sessions.length === 0 && !isLoading && (
                    <div className="ml-7 py-3 text-2xs text-muted-foreground">
                      {t("components:session.notFound", "No sessions")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </OverlayScrollbarsComponent>

      </div>

      {/* Resize Handle - Outside scroll area */}
      {onResizeStart && (
        <div
          className={cn(
            "w-3 cursor-col-resize flex-shrink-0",
            "hover:bg-accent/20 active:bg-accent/30 transition-colors",
            isResizing && "bg-accent/30"
          )}
          onMouseDown={onResizeStart}
        />
      )}
    </aside>
  );
};
