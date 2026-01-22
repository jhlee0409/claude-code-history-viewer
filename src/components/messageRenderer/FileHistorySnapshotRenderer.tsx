/**
 * File History Snapshot Renderer
 *
 * Displays file history snapshot information showing tracked files and their backup state.
 * Uses design tokens for consistent theming across light/dark modes.
 *
 * @example
 * ```tsx
 * <FileHistorySnapshotRenderer
 *   messageId="msg_123"
 *   snapshot={{ trackedFileBackups: {...}, timestamp: "..." }}
 *   isSnapshotUpdate={false}
 * />
 * ```
 */

import { memo } from "react";
import { History, FileArchive, Clock, Link2, FolderArchive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVariantStyles, layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import type { FileHistorySnapshotData } from "../../types";

type Props = {
  messageId: string;
  snapshot: FileHistorySnapshotData;
  isSnapshotUpdate: boolean;
};

export const FileHistorySnapshotRenderer = memo(
  function FileHistorySnapshotRenderer({
    messageId,
    snapshot,
    isSnapshotUpdate,
  }: Props) {
    const { t } = useTranslation("components");

    const trackedFilesCount = Object.keys(snapshot.trackedFileBackups || {}).length;
    const trackedFiles = Object.entries(snapshot.trackedFileBackups || {});

    const styles = getVariantStyles("task");

    return (
      <div className={cn("border", layout.rounded, layout.containerPadding, styles.container)}>
        {/* Header */}
        <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
          <History className={cn(layout.iconSize, styles.icon)} />
          <span className={cn(`${layout.smallText} font-medium`, styles.title)}>
            {isSnapshotUpdate
              ? t("fileHistorySnapshotRenderer.update", {
                  defaultValue: "File History Update",
                })
              : t("fileHistorySnapshotRenderer.snapshot", {
                  defaultValue: "File History Snapshot",
                })}
          </span>
          {trackedFilesCount > 0 && (
            <span className={cn(`${layout.smallText} px-1.5 py-0.5 rounded`, styles.badge, styles.badgeText)}>
              {trackedFilesCount}{" "}
              {t("fileHistorySnapshotRenderer.files", {
                defaultValue: "files tracked",
              })}
            </span>
          )}
        </div>

        {/* Metadata */}
        <div className={`space-y-1.5 ${layout.smallText}`}>
          {/* Linked Message */}
          <div className={cn("flex items-center", layout.iconSpacing, styles.icon)}>
            <Link2 className={layout.iconSizeSmall} />
            <span className="font-mono truncate">{messageId}</span>
          </div>

          {/* Timestamp */}
          {snapshot.timestamp && (
            <div className={cn("flex items-center", layout.iconSpacing, styles.icon)}>
              <Clock className={layout.iconSizeSmall} />
              <span>
                {new Date(snapshot.timestamp).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Tracked Files List */}
        {trackedFilesCount > 0 && (
          <div className="mt-3 pt-2 border-t border-task/30">
            <div className={cn(`flex items-center mb-2 ${layout.smallText}`, layout.iconSpacing, styles.accent)}>
              <FolderArchive className={layout.iconSizeSmall} />
              <span className="font-medium">
                {t("fileHistorySnapshotRenderer.trackedFiles", {
                  defaultValue: "Tracked Files",
                })}
              </span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {trackedFiles.map(([path, entry]) => (
                <div
                  key={path}
                  className={`flex items-center ${layout.iconSpacing} ${layout.smallText} bg-task/10 rounded px-2 py-1`}
                >
                  <FileArchive className={cn(layout.iconSizeSmall, "flex-shrink-0", styles.icon)} />
                  <span className={cn("font-mono truncate", styles.title)}>
                    {typeof entry === "object" && entry?.originalPath
                      ? entry.originalPath
                      : path}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {trackedFilesCount === 0 && (
          <div className={cn(`mt-2 ${layout.smallText} italic`, styles.icon)}>
            {t("fileHistorySnapshotRenderer.noFiles", {
              defaultValue: "No files tracked in this snapshot",
            })}
          </div>
        )}
      </div>
    );
  }
);
