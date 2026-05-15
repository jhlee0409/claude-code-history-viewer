import * as React from "react";
import { Archive, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectSource } from "@/types";

interface RestoredHistoryRoot {
  provider: string;
  path: string;
  label: string;
  source?: ProjectSource;
}

interface HistoryBackupResult {
  backupPath: string;
  filesCopied: number;
  bytesCopied: number;
}

interface HistoryRestoreResult {
  restoredPath: string;
  roots: RestoredHistoryRoot[];
  filesCopied: number;
  bytesCopied: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} PB`;
}

export function HistoryBackupRestore() {
  const [isExporting, setIsExporting] = React.useState(false);
  const [isRestoring, setIsRestoring] = React.useState(false);
  const addCustomClaudePath = useAppStore((state) => state.addCustomClaudePath);
  const scanProjects = useAppStore((state) => state.scanProjects);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose where to create the AI history backup",
      });
      if (!selected || typeof selected !== "string") return;

      const result = await api<HistoryBackupResult>("export_history_backup", {
        path: selected,
      });
      toast.success(
        `Backup created: ${result.filesCopied} files, ${formatBytes(result.bytesCopied)}`
      );
    } catch (error) {
      console.error("History backup failed:", error);
      toast.error("Failed to create history backup");
    } finally {
      setIsExporting(false);
    }
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose a CCHV AI history backup folder",
      });
      if (!selected || typeof selected !== "string") return;

      const result = await api<HistoryRestoreResult>("restore_history_backup", {
        path: selected,
      });
      for (const root of result.roots) {
        await addCustomClaudePath(root.path, root.label, root.source);
      }
      await scanProjects();
      toast.success(
        `Restored ${result.roots.length} source(s): ${result.filesCopied} files`
      );
    } catch (error) {
      console.error("History restore failed:", error);
      toast.error("Failed to restore history backup");
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Card className="shrink-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Archive className="h-4 w-4" />
          AI History Backup
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Export and restore Claude Code, Codex CLI, OpenCode, and synced Podman/remote history.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleExport} disabled={isExporting || isRestoring}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export
            </Button>
            <Button
              variant="outline"
              onClick={handleRestore}
              disabled={isExporting || isRestoring}
            >
              {isRestoring ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Restore
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
