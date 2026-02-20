import { memo, type ReactNode } from "react";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout, type RendererVariant } from "@/components/renderers";

interface ToolResultCardProps {
  title: string;
  icon: ReactNode;
  variant: RendererVariant;
  toolUseId?: string;
  rightContent?: ReactNode;
  children: ReactNode;
}

export const ToolResultCard = memo(function ToolResultCard({
  title,
  icon,
  variant,
  toolUseId,
  rightContent,
  children,
}: ToolResultCardProps) {
  const styles = getVariantStyles(variant);

  return (
    <Renderer className={styles.container} enableToggle={false}>
      <Renderer.Header
        title={title}
        icon={icon}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {rightContent}
            {toolUseId && (
              <span className={cn(layout.monoText, styles.accent)}>{toolUseId}</span>
            )}
          </div>
        }
      />
      <Renderer.Content>{children}</Renderer.Content>
    </Renderer>
  );
});
