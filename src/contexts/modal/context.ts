import { createContext, useContext } from "react";

export type ModalType = "feedback" | "folderSelector" | "globalSearch";
export type FolderSelectorMode = "notFound" | "change";
export type FeedbackType = "bug" | "feature" | "improvement" | "other";

export interface FeedbackPrefill {
  feedbackType?: FeedbackType;
  subject?: string;
  body?: string;
  includeSystemInfo?: boolean;
}

interface OpenModalOptions {
  mode?: FolderSelectorMode;
  feedbackPrefill?: FeedbackPrefill;
}

interface ModalContextValue {
  // 상태
  isOpen: (modal: ModalType) => boolean;
  folderSelectorMode: FolderSelectorMode;
  feedbackPrefill: FeedbackPrefill | null;

  // 액션
  openModal: (modal: ModalType, options?: OpenModalOptions) => void;
  closeModal: (modal: ModalType) => void;
  closeAllModals: () => void;
}

export const ModalContext = createContext<ModalContextValue | null>(null);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used within ModalProvider");
  }
  return context;
};
