import { useState, useCallback, type ReactNode, useMemo } from "react";
import {
  ModalContext,
  type FolderSelectorMode,
  type ModalType,
} from "./context";

interface ModalState {
  feedback: boolean;
  folderSelector: boolean;
  globalSearch: boolean;
  folderSelectorMode: FolderSelectorMode;
}

export const ModalProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [modalState, setModalState] = useState<ModalState>({
    feedback: false,
    folderSelector: false,
    globalSearch: false,
    folderSelectorMode: "notFound",
  });

  const isOpen = useCallback(
    (modal: ModalType): boolean => {
      return modalState[modal];
    },
    [modalState]
  );

  const openModal = useCallback(
    (modal: ModalType, options?: { mode?: FolderSelectorMode }) => {
      setModalState((prev) => ({
        ...prev,
        [modal]: true,
        ...(modal === "folderSelector" &&
          options?.mode && { folderSelectorMode: options.mode }),
      }));
    },
    []
  );

  const closeModal = useCallback((modal: ModalType) => {
    setModalState((prev) => ({ ...prev, [modal]: false }));
  }, []);

  const closeAllModals = useCallback(() => {
    setModalState((prev) => ({
      ...prev,
      feedback: false,
      folderSelector: false,
      globalSearch: false,
    }));
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      folderSelectorMode: modalState.folderSelectorMode,
      openModal,
      closeModal,
      closeAllModals,
    }),
    [
      closeAllModals,
      closeModal,
      isOpen,
      modalState.folderSelectorMode,
      openModal,
    ]
  );

  return (
    <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
  );
};
