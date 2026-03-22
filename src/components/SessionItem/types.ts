import type { ClaudeSession } from "@/types";

export interface SessionItemProps {
  session: ClaudeSession;
  isSelected: boolean;
  onSelect: () => void;
  onHover?: () => void;
  formatTimeAgo: (date: string) => string;
}

export interface SessionHeaderProps {
  isArchivedCodexSession: boolean;
  isSelected: boolean;
}

export interface SessionNameEditorProps {
  isEditing: boolean;
  editValue: string;
  displayName: string | undefined;
  hasCustomName: boolean;
  hasClaudeCodeName: boolean;
  isNamed: boolean;
  isSelected: boolean;
  isContextMenuOpen: boolean;
  providerId: string;
  supportsNativeRename: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  ignoreBlurRef: React.RefObject<boolean>;
  onEditValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSave: () => void;
  onCancel: () => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onRenameClick: (e: React.MouseEvent) => void;
  onResetCustomName: () => Promise<void>;
  onNativeRenameClick: (e: React.MouseEvent) => void;
  onCopySessionId: (e: React.MouseEvent) => void;
  onCopyResumeCommand: (e: React.MouseEvent) => void;
  onCopyFilePath: (e: React.MouseEvent) => void;
  onContextMenuOpenChange: (open: boolean) => void;
}

export interface SessionMetaProps {
  session: ClaudeSession;
  isSelected: boolean;
  formatTimeAgo: (date: string) => string;
}
