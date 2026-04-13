import { FolderSelector } from "./FolderSelector";
import { useAppStore } from "@/store/useAppStore";
import { useModal } from "@/contexts/modal";
import { AppErrorType } from "@/types";
import { useEffect } from "react";

/**
 * Checks if the selected path is a standard .claude directory.
 * Standard: path ends with ".claude" or contains a ".claude" segment.
 */
function isStandardClaudePath(path: string): boolean {
  const segments = path.split(/[\\/]/);
  return segments.includes(".claude");
}

export const FolderSelectorContainer: React.FC = () => {
  const { isOpen, closeModal, folderSelectorMode, openModal } = useModal();
  const { setClaudePath, scanProjects, addCustomClaudePath, error } =
    useAppStore();

  // 에러 발생 시 자동으로 폴더 선택 모달 열기
  useEffect(() => {
    if (error?.type === AppErrorType.CLAUDE_FOLDER_NOT_FOUND) {
      openModal("folderSelector", { mode: "notFound" });
    }
  }, [error, openModal]);

  const handleFolderSelected = async (path: string) => {
    if (isStandardClaudePath(path)) {
      // Standard .claude directory → set as main claudePath
      let claudeFolderPath = path;
      if (!path.endsWith(".claude")) {
        claudeFolderPath = `${path}/.claude`;
      }
      setClaudePath(claudeFolderPath);
    } else {
      // Custom directory (e.g. ~/.claude-personal) → register as custom path
      const folderName =
        path.split(/[\\/]/).filter(Boolean).pop() ?? "custom";
      await addCustomClaudePath(path, folderName);
    }

    try {
      await scanProjects();
    } catch (err) {
      console.error("Failed to scan projects:", err);
    }
  };

  if (!isOpen("folderSelector")) return null;

  return (
    <div className="fixed inset-0 z-50">
      <FolderSelector
        mode={folderSelectorMode}
        onClose={() => closeModal("folderSelector")}
        onFolderSelected={handleFolderSelected}
      />
    </div>
  );
};
