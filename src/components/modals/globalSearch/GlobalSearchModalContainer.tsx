import { GlobalSearchModal } from "./GlobalSearchModal";
import { useModal } from "@/contexts/modal";

export const GlobalSearchModalContainer: React.FC = () => {
    const { isOpen, closeModal } = useModal();

    if (!isOpen("globalSearch")) return null;

    return (
        <GlobalSearchModal
            isOpen={true}
            onClose={() => closeModal("globalSearch")}
        />
    );
};
