import { useTranslation } from "react-i18next";
import { Terminal, MessageCircle, Orbit, Asterisk, Bot, SquareUser, Square, ArrowRight, Glasses, Diamond, MousePointer2, MousePointerClick, Hammer, Sparkles, Bird, Hash, Hexagon, Moon, Ghost, Braces, Layers, Triangle, DoorOpen, Code, Leaf, CircleDot, Flower, WavesHorizontal, Radio, Zap, Pentagon, CircleQuestionMark, type LucideIcon } from "lucide-react";
import type { ProviderId } from "@/types";
import { cn } from "@/lib/utils";
import { getProviderBadgeStyle, getProviderLabel } from "@/utils/providers";

/** Explicit stable silhouettes, never an array-position/colour-dependent hash. */
const SHAPES: Record<ProviderId, LucideIcon> = {
  aider: Terminal, amazonq: MessageCircle, antigravity: Orbit, claude: Asterisk,
  cline: Bot, codebuddy: SquareUser, codex: Square, continue: ArrowRight,
  copilot: Glasses, crush: Diamond, cursor: MousePointer2, "cursor-agent": MousePointerClick,
  forgecode: Hammer, gemini: Sparkles, goose: Bird, grok: Hash, kilo: Hexagon,
  kimi: Moon, kiro: Ghost, llm: Braces, ompi: Layers, opencode: Triangle,
  openhands: DoorOpen, openinterpreter: Code, pearai: Leaf, pi: CircleDot,
  qwen: Flower, trae: WavesHorizontal, vibe: Radio, zcode: Zap, zed: Pentagon,
};

export function ProviderMark({ provider = "claude", decorative = false, className }: { provider?: string; decorative?: boolean; className?: string }) {
  const { t } = useTranslation();
  const known = Object.prototype.hasOwnProperty.call(SHAPES, provider);
  const Shape = known ? SHAPES[provider as ProviderId] : CircleQuestionMark;
  // Reuse the existing provider colour roles; F1c owns their values.
  const tone = known ? getProviderBadgeStyle(provider).split(/\s+/).filter((token) => /(^|:)text-/.test(token)).join(" ") : "text-muted-foreground";
  return <span role={decorative ? undefined : "img"} aria-hidden={decorative || undefined}
    aria-label={decorative ? undefined : known ? getProviderLabel((key, fallback) => t(key, fallback), provider as ProviderId) : provider}
    data-provider-shape={known ? provider : "unknown"} className={cn("inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center", tone, className)}>
    <Shape className="h-3.5 w-3.5" aria-hidden="true" />
  </span>;
}
