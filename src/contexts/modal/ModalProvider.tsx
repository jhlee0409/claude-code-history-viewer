import { useState, useCallback, type ReactNode, useMemo } from "react";
import {
  ModalContext,
  type FeedbackPrefill,
  type FolderSelectorMode,
  type ModalType,
} from "./context";

interface ModalState {
  feedback: boolean;
  folderSelector: boolean;
  globalSearch: boolean;
  folderSelectorMode: FolderSelectorMode;
  feedbackPrefill: FeedbackPrefill | null;
}

export const ModalProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [modalState, setModalState] = useState<ModalState>({
    feedback: false,
    folderSelector: false,
    globalSearch: false,
    folderSelectorMode: "notFound",
    feedbackPrefill: null,
  });

  const isOpen = useCallback(
    (modal: ModalType): boolean => {
      return modalState[modal];
    },
    [modalState]
  );

  const openModal = useCallback(
    (
      modal: ModalType,
      options?: {
        mode?: FolderSelectorMode;
        feedbackPrefill?: FeedbackPrefill;
      }
    ) => {
      setModalState((prev) => ({
        ...prev,
        [modal]: true,
        ...(modal === "folderSelector" &&
          options?.mode && { folderSelectorMode: options.mode }),
        ...(modal === "feedback" && {
          feedbackPrefill: options?.feedbackPrefill ?? null,
        }),
      }));
    },
    []
  );

  const closeModal = useCallback((modal: ModalType) => {
    setModalState((prev) => ({
      ...prev,
      [modal]: false,
      ...(modal === "feedback" && { feedbackPrefill: null }),
    }));
  }, []);

  const closeAllModals = useCallback(() => {
    setModalState((prev) => ({
      ...prev,
      feedback: false,
      folderSelector: false,
      globalSearch: false,
      feedbackPrefill: null,
    }));
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      folderSelectorMode: modalState.folderSelectorMode,
      feedbackPrefill: modalState.feedbackPrefill,
      openModal,
      closeModal,
      closeAllModals,
    }),
    [
      closeAllModals,
      closeModal,
      modalState.feedbackPrefill,
      isOpen,
      modalState.folderSelectorMode,
      openModal,
    ]
  );

  return (
    <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
  );
};
