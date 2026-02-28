import { useState, useCallback, type ReactNode, useMemo, useRef } from "react";
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
  const focusOriginsRef = useRef<Partial<Record<ModalType, HTMLElement[]>>>({});
  const openOrderRef = useRef<ModalType[]>([]);

  const restoreFocus = useCallback((modal: ModalType) => {
    const candidates = focusOriginsRef.current[modal];
    if (candidates == null || candidates.length === 0) return false;

    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const target = candidates[index];
      if (target == null || !target.isConnected) {
        continue;
      }

      target.focus();
      return true;
    }

    return false;
  }, []);

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
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        const current = focusOriginsRef.current[modal] ?? [];
        focusOriginsRef.current[modal] = [...current, activeElement];
      }

      openOrderRef.current = [...openOrderRef.current.filter((item) => item !== modal), modal];

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
    openOrderRef.current = openOrderRef.current.filter((item) => item !== modal);
    setModalState((prev) => ({
      ...prev,
      [modal]: false,
      ...(modal === "feedback" && { feedbackPrefill: null }),
    }));
    restoreFocus(modal);
    focusOriginsRef.current[modal] = [];
  }, [restoreFocus]);

  const closeAllModals = useCallback(() => {
    const openedModals = [...openOrderRef.current];
    openOrderRef.current = [];
    setModalState((prev) => ({
      ...prev,
      feedback: false,
      folderSelector: false,
      globalSearch: false,
      feedbackPrefill: null,
    }));
    requestAnimationFrame(() => {
      for (const modal of [...openedModals].reverse()) {
        if (restoreFocus(modal)) {
          break;
        }
      }
      for (const modal of openedModals) {
        focusOriginsRef.current[modal] = [];
      }
    });
  }, [restoreFocus]);

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
