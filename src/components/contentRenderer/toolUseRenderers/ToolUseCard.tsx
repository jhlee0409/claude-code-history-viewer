import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout, type RendererVariant } from "@/components/renderers";

interface ToolUseCardProps {
  title: string;
  icon: ReactNode;
  variant: RendererVariant;
  toolId?: string;
  rightContent?: ReactNode;
  children: ReactNode;
}

export const ToolUseCard = memo(function ToolUseCard({
  title,
  icon,
  variant,
  toolId,
  rightContent,
  children,
}: ToolUseCardProps) {
  const { t } = useTranslation();
  const styles = getVariantStyles(variant);

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={title}
        icon={icon}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {rightContent}
            {toolId && (
              <code
                className={cn(
                  layout.monoText,
                  "px-2 py-0.5",
                  layout.rounded,
                  styles.badge,
                  styles.badgeText
                )}
              >
                {t("common.id")}: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>{children}</Renderer.Content>
    </Renderer>
  );
});

interface ToolUsePropertyRowProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function ToolUsePropertyRow({
  label,
  children,
  className,
}: ToolUsePropertyRowProps) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <span className={cn(layout.smallText, "text-muted-foreground shrink-0 pt-0.5")}>
        {label}:
      </span>
      {children}
    </div>
  );
}
