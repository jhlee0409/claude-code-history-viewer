import { useState } from "react";
import { Folder, AlertCircle, ArrowLeft, CheckCircle2, HelpCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface FolderSelectorProps {
  onFolderSelected: (path: string) => void;
  mode?: "notFound" | "change";
  onClose?: () => void;
}

export function FolderSelector({
  onFolderSelected,
  mode = "notFound",
  onClose,
}: FolderSelectorProps) {
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string>("");

  const { t: tComponents } = useTranslation("components");
  const isChangeMode = mode === "change";

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: tComponents("folderPicker.selectFolderTitle"),
      });

      if (selected && typeof selected === "string") {
        setSelectedPath(selected);
        setValidationError("");
        await validateAndSelectFolder(selected);
      }
    } catch (err) {
      console.error(tComponents("folderPicker.folderSelectError"), err);
      setValidationError(tComponents("folderPicker.folderSelectErrorDetails"));
    }
  };

  const validateAndSelectFolder = async (path: string) => {
    setIsValidating(true);
    setValidationError("");

    try {
      const isValid = await invoke<boolean>("validate_claude_folder", { path });

      if (isValid) {
        onFolderSelected(path);
      } else {
        setValidationError(tComponents("folderPicker.invalidFolder"));
      }
    } catch {
      setValidationError(tComponents("folderPicker.validationError"));
    } finally {
      setIsValidating(false);
    }
  };

  const content = (
    <div className="text-center space-y-6">
      {/* Icon */}
      <div className="flex justify-center">
        <div className="rounded-full bg-primary/10 p-4">
          <Folder className="h-12 w-12 text-primary" />
        </div>
      </div>

      {/* Title & Description */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">
          {isChangeMode
            ? tComponents("folderPicker.change")
            : tComponents("folderPicker.notFound")}
        </h1>
        <p className="text-muted-foreground">
          {isChangeMode
            ? tComponents("folderPicker.newFolder")
            : tComponents("folderPicker.homeNotFound")}
        </p>
      </div>

      {/* Select Button */}
      <Button
        onClick={handleSelectFolder}
        disabled={isValidating}
        size="lg"
        className="w-full"
      >
        <Folder className="h-4 w-4" />
        {isValidating
          ? tComponents("folderPicker.validating")
          : tComponents("folderPicker.selectButton")}
      </Button>

      {/* Selected Path */}
      {selectedPath && (
        <Alert variant="default" className="text-left">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="truncate">
            {tComponents("folderPicker.selectedPath")} {selectedPath}
          </AlertDescription>
        </Alert>
      )}

      {/* Validation Error */}
      {validationError && (
        <Alert variant="destructive" className="text-left">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}

      {/* Help Section */}
      <Card variant="outline" className="text-left">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            {tComponents("folderPicker.help")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {tComponents("folderPicker.helpDetails")}
          </p>
        </CardContent>
      </Card>
    </div>
  );

  // Change mode: use Dialog
  if (isChangeMode) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose?.()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>{tComponents("folderPicker.change")}</DialogTitle>
            <DialogDescription>
              {tComponents("folderPicker.newFolder")}
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  // Not found mode: full screen
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <Card
        className={cn(
          "max-w-md w-full mx-4 relative",
          "shadow-lg border-border"
        )}
      >
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="absolute left-4 top-4"
          >
            <ArrowLeft className="h-4 w-4" />
            {tComponents("folderPicker.backButton")}
          </Button>
        )}
        <CardContent className="pt-12 pb-8 px-8">
          {content}
        </CardContent>
      </Card>
    </div>
  );
}
