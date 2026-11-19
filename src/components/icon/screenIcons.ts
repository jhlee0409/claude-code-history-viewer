/**
 * One glyph per meaning (decision page section 7, "의미 고정"; plan T5).
 *
 * Wherever the app shows one of these meanings - a header tab, a content
 * header, a sidebar or menu entry, the mobile bar - it uses this icon, so the
 * same thing never looks two ways. `VIEW_REGISTRY` takes its screen icons
 * from here.
 *
 * - `recent`: the table names lucide's `history`; in lucide 1.57 that glyph's
 *   canonical name is `rotate-ccw-clock` (`History` is a deprecated alias).
 * - `tokenStats` is not in the table; it keeps the coins its content header
 *   already showed (the tab showed `activity`).
 */
import {
  Archive,
  Bot,
  ChartColumn,
  ChartPie,
  Coins,
  FilePenLine,
  MessageSquareText,
  PanelRight,
  RotateCcwClock,
  Settings,
  SquareKanban,
  SquareTerminal,
  Star,
  type LucideIcon,
} from "lucide-react";

export const SCREEN_ICONS = {
  conversation: MessageSquareText,
  analytics: ChartColumn,
  edits: FilePenLine,
  board: SquareKanban,
  recent: RotateCcwClock,
  favorites: Star,
  globalStats: ChartPie,
  archive: Archive,
  inspector: PanelRight,
  agent: Bot,
  terminal: SquareTerminal,
  settings: Settings,
  tokenStats: Coins,
} as const satisfies Record<string, LucideIcon>;

export type ScreenIconMeaning = keyof typeof SCREEN_ICONS;
