import {
  FeedbackModalContainer,
  FolderSelectorContainer,
  GlobalSearchModalContainer,
  SessionPickerModalContainer,
} from "@/components/modals";

export const ModalContainer = () => {
  return (
    <>
      <FolderSelectorContainer />
      <FeedbackModalContainer />
      <GlobalSearchModalContainer />
      <SessionPickerModalContainer />
    </>
  );
};
