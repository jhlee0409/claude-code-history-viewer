import {
  BookOpen,
  Bot,
  Info,
  ScrollText,
  SquareSlash,
  User,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { MessageKind } from "../MessageViewer/helpers/messageKinds";

export interface KindStyle {
  icon: LucideIcon;
  /** Icon color */
  iconClass: string;
  /** Preview text weight; typed prompts read strongest, injected rows weakest */
  textClass: string;
}

/**
 * Preview text styling by kind, shared by `NavigatorEntry` (list mode) and
 * the outline's turn header (a turn start is always "prompt" or "command").
 * Lives in its own module - not alongside a component - so Fast Refresh
 * does not warn about a non-component export.
 */
export const KIND_STYLES: Record<MessageKind, KindStyle> = {
  prompt: { icon: User, iconClass: "text-info", textClass: "text-foreground font-medium" },
  command: { icon: SquareSlash, iconClass: "text-info", textClass: "text-foreground/80 font-mono" },
  "agent-update": { icon: Zap, iconClass: "text-tool-task", textClass: "text-foreground/80" },
  context: { icon: BookOpen, iconClass: "text-muted-foreground", textClass: "text-muted-foreground italic" },
  reply: { icon: Bot, iconClass: "text-warning", textClass: "text-foreground/80" },
  tool: { icon: Wrench, iconClass: "text-muted-foreground", textClass: "text-muted-foreground" },
  system: { icon: Info, iconClass: "text-muted-foreground", textClass: "text-muted-foreground" },
  summary: { icon: ScrollText, iconClass: "text-tool-mcp", textClass: "text-foreground/80" },
};
