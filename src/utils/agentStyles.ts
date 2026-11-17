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
    bg: "bg-agent-1-surface",
    text: "text-agent-1",
    border: "border-agent-1-line",
  },
  Plan: {
    icon: Map,
    bg: "bg-agent-2-surface",
    text: "text-agent-2",
    border: "border-agent-2-line",
  },
  "code-reviewer": {
    icon: ShieldCheck,
    bg: "bg-agent-3-surface",
    text: "text-agent-3",
    border: "border-agent-3-line",
  },
  "general-purpose": {
    icon: Wrench,
    bg: "bg-agent-4-surface",
    text: "text-agent-4",
    border: "border-agent-4-line",
  },
  "statusline-setup": {
    icon: Settings,
    bg: "bg-agent-5-surface",
    text: "text-agent-5",
    border: "border-agent-5-line",
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
