/**
 * PermissionsSection Component
 *
 * Accordion section for permissions settings:
 * - Allow list
 * - Deny list
 * - Ask list
 */

import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Shield, Plus, X } from "lucide-react";
import type { ClaudeCodeSettings } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface PermissionsSectionProps {
  settings: ClaudeCodeSettings;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updates: Partial<ClaudeCodeSettings>) => void;
  readOnly: boolean;
}

// ============================================================================
// Permission List Editor Sub-component
// ============================================================================

interface PermissionListEditorProps {
  title: string;
  items: string[];
  onItemsChange: (items: string[]) => void;
  placeholder?: string;
  readOnly: boolean;
  variant: "allow" | "deny" | "ask";
}

const PermissionListEditor: React.FC<PermissionListEditorProps> = React.memo(({
  title,
  items,
  onItemsChange,
  placeholder,
  readOnly,
  variant,
}) => {
  const [newItem, setNewItem] = useState("");
  const { t } = useTranslation();

  const variantColors = {
    allow: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    deny: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    ask: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  const addItem = () => {
    if (newItem.trim() && !items.includes(newItem.trim())) {
      onItemsChange([...items, newItem.trim()]);
      setNewItem("");
    }
  };

  const removeItem = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <Label className={`text-sm ${variantColors[variant].split(" ")[1]}`}>
        {title}
      </Label>
      <div className="space-y-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">
            {t("settingsManager.unified.permissions.empty")}
          </p>
        ) : (
          items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="flex items-center gap-2 group"
            >
              <Badge
                variant="outline"
                className={`flex-1 justify-start font-mono text-xs py-1 ${variantColors[variant]}`}
              >
                {item}
              </Badge>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeItem(index)}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder={placeholder}
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
          />
          <Button size="sm" className="h-8" onClick={addItem}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
});

PermissionListEditor.displayName = "PermissionListEditor";

// ============================================================================
// Main Component
// ============================================================================

export const PermissionsSection: React.FC<PermissionsSectionProps> = React.memo(({
  settings,
  isExpanded,
  onToggle,
  onChange,
  readOnly,
}) => {
  const { t } = useTranslation();

  const allowList = settings.permissions?.allow ?? [];
  const denyList = settings.permissions?.deny ?? [];
  const askList = settings.permissions?.ask ?? [];

  const totalCount = allowList.length + denyList.length + askList.length;

  const handleAllowChange = (items: string[]) => {
    onChange({
      permissions: {
        ...settings.permissions,
        allow: items,
        deny: denyList,
        ask: askList,
      },
    });
  };

  const handleDenyChange = (items: string[]) => {
    onChange({
      permissions: {
        ...settings.permissions,
        allow: allowList,
        deny: items,
        ask: askList,
      },
    });
  };

  const handleAskChange = (items: string[]) => {
    onChange({
      permissions: {
        ...settings.permissions,
        allow: allowList,
        deny: denyList,
        ask: items,
      },
    });
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-3 px-4 rounded-lg text-muted-foreground hover:text-accent hover:bg-accent/10 border border-border/40 transition-colors duration-150">
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {t("settingsManager.unified.sections.permissions")}
          </span>
        </div>
        {totalCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            {totalCount}
          </Badge>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-10 pr-4 pb-4 pt-2 space-y-4">
          {/* Allow List */}
          <PermissionListEditor
            title={t("settingsManager.visual.allowList")}
            items={allowList}
            onItemsChange={handleAllowChange}
            placeholder="e.g., Bash(rg:*), Read(/path/**)"
            readOnly={readOnly}
            variant="allow"
          />

          {/* Deny List */}
          <PermissionListEditor
            title={t("settingsManager.visual.denyList")}
            items={denyList}
            onItemsChange={handleDenyChange}
            placeholder="e.g., Write(/sensitive/**)"
            readOnly={readOnly}
            variant="deny"
          />

          {/* Ask List */}
          <PermissionListEditor
            title={t("settingsManager.unified.permissions.askList")}
            items={askList}
            onItemsChange={handleAskChange}
            placeholder="e.g., Bash(rm:*)"
            readOnly={readOnly}
            variant="ask"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

PermissionsSection.displayName = "PermissionsSection";
