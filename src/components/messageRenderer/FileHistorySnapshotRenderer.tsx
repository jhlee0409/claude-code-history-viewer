import { memo } from "react";
import { History, FileArchive, Clock, Link2, FolderArchive } from "lucide-react";
import { useTranslation } from "react-i18next";
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

    return (
      <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
        {/* Header */}
        <div className="flex items-center space-x-2 mb-2">
          <History className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <span className="text-xs font-medium text-violet-800 dark:text-violet-300">
            {isSnapshotUpdate
              ? t("fileHistorySnapshotRenderer.update", {
                  defaultValue: "File History Update",
                })
              : t("fileHistorySnapshotRenderer.snapshot", {
                  defaultValue: "File History Snapshot",
                })}
          </span>
          {trackedFilesCount > 0 && (
            <span className="text-xs bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded">
              {trackedFilesCount}{" "}
              {t("fileHistorySnapshotRenderer.files", {
                defaultValue: "files tracked",
              })}
            </span>
          )}
        </div>

        {/* Metadata */}
        <div className="space-y-1.5 text-xs">
          {/* Linked Message */}
          <div className="flex items-center space-x-2 text-violet-600 dark:text-violet-400">
            <Link2 className="w-3 h-3" />
            <span className="font-mono truncate">{messageId}</span>
          </div>

          {/* Timestamp */}
          {snapshot.timestamp && (
            <div className="flex items-center space-x-2 text-violet-600 dark:text-violet-400">
              <Clock className="w-3 h-3" />
              <span>
                {new Date(snapshot.timestamp).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Tracked Files List */}
        {trackedFilesCount > 0 && (
          <div className="mt-3 pt-2 border-t border-violet-200 dark:border-violet-700">
            <div className="flex items-center space-x-1 mb-2 text-xs text-violet-700 dark:text-violet-300">
              <FolderArchive className="w-3 h-3" />
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
                  className="flex items-center space-x-2 text-xs bg-violet-100/50 dark:bg-violet-900/30 rounded px-2 py-1"
                >
                  <FileArchive className="w-3 h-3 text-violet-500 dark:text-violet-400 flex-shrink-0" />
                  <span className="font-mono text-violet-700 dark:text-violet-300 truncate">
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
          <div className="mt-2 text-xs text-violet-500 dark:text-violet-400 italic">
            {t("fileHistorySnapshotRenderer.noFiles", {
              defaultValue: "No files tracked in this snapshot",
            })}
          </div>
        )}
      </div>
    );
  }
);
