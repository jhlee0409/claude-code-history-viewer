import React, { useState, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Terminal } from "lucide-react";
import { useNativeRename } from "@/hooks/useNativeRename";
import type { ProviderId } from "@/types";

interface NativeRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  currentName: string;
  provider?: ProviderId;
  onSuccess?: (newTitle: string) => void;
}

export const NativeRenameDialog: React.FC<NativeRenameDialogProps> = ({
  open,
  onOpenChange,
  filePath,
  currentName,
  provider = "claude",
  onSuccess,
}) => {
  const { t } = useTranslation();
  const { renameNative, isRenaming, error } = useNativeRename();
  const [title, setTitle] = useState("");
  const inputId = useId();
  const isOpenCode = provider === "opencode";
  const isForgeCode = provider === "forgecode";
  const usesStandaloneTitlePreview = isOpenCode || isForgeCode;

  // Extract existing title if present. For providers that use a
  // standalone title (OpenCode, ForgeCode) the saved name *is* the title,
  // so mirror the parsing path the save side uses — otherwise the input
  // arrives empty and a blind save would silently reset the title.
  useEffect(() => {
    if (!open) return;
    if (usesStandaloneTitlePreview) {
      setTitle(currentName);
    } else {
      const match = currentName.match(/^\[(.+?)\]/);
      setTitle(match?.[1] ?? "");
    }
  }, [open, currentName, usesStandaloneTitlePreview]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await renameNative(filePath, title, provider);
      onSuccess?.(result.new_title);
      onOpenChange(false);
    } catch {
      // Error is handled by the hook
    }
  };

  // Get base message (without prefix) for preview
  const baseMessage = currentName.replace(/^\[.+?\]\s*/, "");
  const previewText = usesStandaloneTitlePreview
    ? (title || t("session.nativeRename.titlePlaceholder"))
    : `[${title || t("session.nativeRename.titlePlaceholder")}] ${baseMessage.slice(0, 30)}...`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            {isOpenCode
              ? t("session.nativeRename.titleOpenCode", "Rename in OpenCode")
              : isForgeCode
                ? t("session.nativeRename.titleForgeCode", "Rename in ForgeCode")
                : t("session.nativeRename.title")}
          </DialogTitle>
          <DialogDescription>
            {isOpenCode
              ? t(
                  "session.nativeRename.descriptionOpenCode",
                  "This updates the OpenCode session title in storage."
                )
              : isForgeCode
                ? t(
                    "session.nativeRename.descriptionForgeCode",
                    "This updates the ForgeCode conversation title in the Forge database."
                  )
                : t("session.nativeRename.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {isOpenCode
                  ? t(
                      "session.nativeRename.warningOpenCode",
                      "This operation modifies the OpenCode session metadata file. The change is reversible."
                    )
                  : isForgeCode
                    ? t(
                        "session.nativeRename.warningForgeCode",
                        "This operation updates the ForgeCode conversation title stored in the Forge database."
                      )
                    : t("session.nativeRename.warning")}
              </AlertDescription>
            </Alert>

            {/* Current session name display */}
            <div className="space-y-1">
              <Label className="text-muted-foreground">
                {t("session.nativeRename.currentName", "Current name")}
              </Label>
              <p className="text-sm bg-muted/50 rounded-md px-3 py-2 break-words">
                {currentName || t("session.summaryNotFound", "No summary")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={inputId}>
                {t("session.nativeRename.label")}
              </Label>
              <Input
                id={inputId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  t("session.nativeRename.placeholder")
                }
                disabled={isRenaming}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {usesStandaloneTitlePreview
                  ? t("session.nativeRename.previewOpenCode", {
                      title: previewText,
                    })
                  : t("session.nativeRename.preview", {
                      title: title || t("session.nativeRename.titlePlaceholder"),
                      original: baseMessage.slice(0, 30),
                    })}
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isRenaming}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isRenaming}>
              {isRenaming
                ? t("common.saving")
                : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
