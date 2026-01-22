import {
  Bot,
  Code,
  Edit,
  FileSearch,
  FileText,
  FolderSearch,
  GitBranch,
  Globe,
  ListTodo,
  Plug,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RendererVariant } from "@/components/renderers";

type Props = {
  toolName: string;
  className?: string;
  /** Whether to apply tool-specific color */
  colored?: boolean;
  /** Size variant */
  size?: "sm" | "default" | "lg";
};

/** Tool variant to Tailwind color class mapping */
const VARIANT_COLORS: Record<RendererVariant, string> = {
  code: "text-tool-code",
  file: "text-tool-file",
  search: "text-tool-search",
  task: "text-tool-task",
  system: "text-tool-system",
  git: "text-tool-git",
  web: "text-tool-web",
  mcp: "text-tool-mcp",
  document: "text-tool-document",
  terminal: "text-tool-terminal",
  thinking: "text-thinking-foreground",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  error: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Size classes */
const SIZE_CLASSES = {
  sm: "w-3 h-3",
  default: "w-4 h-4",
  lg: "w-5 h-5",
};

/** Get tool variant from tool name */
const getToolVariant = (name: string): RendererVariant => {
  const lower = name.toLowerCase();

  // Code operations (Blue)
  if (lower.includes("read") || lower.includes("write") || lower.includes("edit") || lower.includes("lsp") || lower.includes("notebook")) {
    return "code";
  }

  // File operations (Teal)
  if (lower.includes("glob") || lower.includes("ls") || lower === "file") {
    return "file";
  }

  // Search operations (Violet)
  if (lower.includes("grep") || lower.includes("search")) {
    return "search";
  }

  // Task management (Amber)
  if (lower.includes("task") || lower.includes("todo") || lower.includes("agent")) {
    return "task";
  }

  // System/Shell operations (Gray)
  if (lower.includes("bash") || lower.includes("command") || lower.includes("shell") || lower.includes("kill")) {
    return "terminal";
  }

  // Git operations (Cyan)
  if (lower.includes("git")) {
    return "git";
  }

  // Web operations (Sky Blue)
  if (lower.includes("web") || lower.includes("fetch") || lower.includes("http")) {
    return "web";
  }

  // MCP operations (Magenta)
  if (lower.includes("mcp") || lower.includes("server")) {
    return "mcp";
  }

  // Document operations (Teal)
  if (lower.includes("document") || lower.includes("pdf")) {
    return "document";
  }

  return "neutral";
};

/** Get icon component based on tool name */
const getIcon = (name: string) => {
  const lower = name.toLowerCase();

  // Terminal/Shell
  if (lower.includes("bash") || lower.includes("command") || lower.includes("shell") || lower.includes("kill")) {
    return Terminal;
  }

  // File reading
  if (lower.includes("read")) {
    return FileText;
  }

  // File writing/editing
  if (lower.includes("edit") || lower.includes("write") || lower.includes("notebook")) {
    return Edit;
  }

  // Code/LSP
  if (lower.includes("lsp") || lower.includes("code")) {
    return Code;
  }

  // Search (Grep)
  if (lower.includes("grep")) {
    return FileSearch;
  }

  // File search (Glob)
  if (lower.includes("glob") || lower.includes("ls") || lower === "file") {
    return FolderSearch;
  }

  // General search
  if (lower.includes("search")) {
    return Search;
  }

  // Todo/Task management
  if (lower.includes("todo")) {
    return ListTodo;
  }

  // Agent/Task execution
  if (lower.includes("task") || lower.includes("agent")) {
    return Bot;
  }

  // Web operations
  if (lower.includes("web") || lower.includes("fetch") || lower.includes("http")) {
    return Globe;
  }

  // Git operations
  if (lower.includes("git")) {
    return GitBranch;
  }

  // MCP/Server
  if (lower.includes("mcp") || lower.includes("server")) {
    return Plug;
  }

  // Default
  return Wrench;
};

export const ToolIcon = ({ toolName, className, colored = false, size = "default" }: Props) => {
  const Icon = getIcon(toolName);
  const variant = getToolVariant(toolName);
  const colorClass = colored ? VARIANT_COLORS[variant] : "";
  const sizeClass = SIZE_CLASSES[size];

  return <Icon className={cn(sizeClass, colorClass, className)} />;
};
