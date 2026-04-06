import {
  Bot,
  Search,
  Map,
  ShieldCheck,
  Wrench,
  Settings,
} from "lucide-react";

export type SubagentStyle = {
  icon: typeof Bot;
  bg: string;
  text: string;
  border: string;
};

export const SUBAGENT_STYLES: Record<string, SubagentStyle> = {
  Explore: {
    icon: Search,
    bg: "bg-cyan-500/15",
    text: "text-cyan-600 dark:text-cyan-400",
    border: "border-cyan-500/30",
  },
  Plan: {
    icon: Map,
    bg: "bg-violet-500/15",
    text: "text-violet-600 dark:text-violet-400",
    border: "border-violet-500/30",
  },
  "code-reviewer": {
    icon: ShieldCheck,
    bg: "bg-emerald-500/15",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/30",
  },
  "general-purpose": {
    icon: Wrench,
    bg: "bg-slate-500/15",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-500/30",
  },
  "statusline-setup": {
    icon: Settings,
    bg: "bg-amber-500/15",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/30",
  },
};

const DEFAULT_STYLE = SUBAGENT_STYLES["general-purpose"]!;

export function getSubagentStyle(type?: string): SubagentStyle {
  if (!type) return DEFAULT_STYLE;
  if (SUBAGENT_STYLES[type]) return SUBAGENT_STYLES[type]!;
  const lower = type.toLowerCase();
  for (const [key, style] of Object.entries(SUBAGENT_STYLES)) {
    if (lower.includes(key.toLowerCase())) return style;
  }
  return DEFAULT_STYLE;
}
