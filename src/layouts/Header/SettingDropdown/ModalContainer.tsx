import {
  FeedbackModalContainer,
  FolderSelectorContainer,
  GlobalSearchModalContainer,
} from "@/components/modals";

export const ModalContainer = () => {
  return (
    <>
      <FolderSelectorContainer />
      <FeedbackModalContainer />
      <GlobalSearchModalContainer />
    </>
  );
};
