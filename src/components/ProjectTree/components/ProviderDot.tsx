import { ProviderMark } from "@/components/ui/providerMark";

/** Compatibility boundary: project rows and menus already name the provider. */
export function ProviderDot({ provider, className }: { provider?: string; className?: string }) {
  return <span aria-hidden="true" data-provider-dot={provider ?? "claude"} className={className}>
    <ProviderMark provider={provider} decorative />
  </span>;
}
