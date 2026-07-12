import type { ClaudeSession } from "@/types";

export interface SessionItemProps {
  session: ClaudeSession;
  isSelected: boolean;
  onSelect: () => void;
  onHover?: () => void;
  formatTimeAgo: (date: string) => string;
  /** Whether the list is in multi-select mode (renders a checkbox) */
  isSelectionMode?: boolean;
  /** Whether this row is checked in multi-select mode */
  isChecked?: boolean;
  /**
   * Toggle this row's checkbox. Receives the mouse event so the caller can
   * read modifier keys (Shift = range, Cmd/Ctrl = individual toggle).
   */
  onToggleSelect?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  /**
   * Start/extend a selection from normal mode via a modifier click
   * (Cmd/Ctrl+click or Shift+click). Enters selection mode.
   */
  onModifierSelect?: (e: React.MouseEvent) => void;
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
  readOnly: boolean;
  providerId: string;
  supportsNativeRename: boolean;
  supportsResumeCommand: boolean;
  supportsSessionDeletion: boolean;
  supportsRevealInFinder: boolean;
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
  onRevealInFinder: (e: React.MouseEvent) => void;
  onDeleteSession: (e: React.MouseEvent) => void;
  onContextMenuOpenChange: (open: boolean) => void;
}

export interface SessionMetaProps {
  session: ClaudeSession;
  isSelected: boolean;
  formatTimeAgo: (date: string) => string;
}
