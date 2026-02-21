import { FeedbackModal } from "./FeedbackModal";
import { useModal } from "@/contexts/modal";

export const FeedbackModalContainer: React.FC = () => {
  const { isOpen, closeModal, feedbackPrefill } = useModal();

  if (!isOpen("feedback")) return null;

  return (
    <FeedbackModal
      isOpen={true}
      prefill={feedbackPrefill}
      onClose={() => closeModal("feedback")}
    />
  );
};
