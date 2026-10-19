/**
 * EmptyState Component
 *
 * Displays when no settings file exists for a scope
 */

import * as React from "react";
import { FileX } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { SettingsScope } from "@/types";

interface EmptyStateProps {
  scope: SettingsScope;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ scope, className }) => {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Icon icon={FileX} size={24} className="text-muted-foreground/50" />
      </div>
      <p className="text-body text-muted-foreground mb-2">
        {t("settingsManager.noSettings")}
      </p>
      <p className="text-list text-muted-foreground/70">
        {t(`settingsManager.scope.${scope}`)}
      </p>
    </div>
  );
};
