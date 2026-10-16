// src/components/ProjectTree/components/ProviderDot.tsx
import { cn } from "@/lib/utils";
import { getProviderBadgeStyle } from "@/utils/providers";

/**
 * A provider as a small coloured dot (plan T7: "one-line rows + provider
 * dot"). The colour is the provider's badge text colour, so a dot and the
 * provider's badge elsewhere agree. Decorative: the row names the providers.
 */
export function ProviderDot({ provider, className }: { provider?: string; className?: string }) {
  const textColour = getProviderBadgeStyle(provider)
    .split(" ")
    .filter((token) => /(^|:)text-/.test(token))
    .join(" ");
  return (
    <span
      aria-hidden="true"
      data-provider-dot={provider ?? "claude"}
      className={cn("block h-1.5 w-1.5 shrink-0 rounded-full bg-current", textColour, className)}
    />
  );
}
