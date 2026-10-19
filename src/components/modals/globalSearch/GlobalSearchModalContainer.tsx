import { GlobalSearchModal } from "./GlobalSearchModal";
import { useModal } from "@/contexts/modal";
import { useCommandContext } from "@/commands/useCommandContext";

export const GlobalSearchModalContainer: React.FC = () => {
    const { isOpen, closeModal } = useModal();
    const getCommandContext = useCommandContext();

    if (!isOpen("globalSearch")) return null;

    return (
        <GlobalSearchModal
            isOpen={true}
            onClose={() => closeModal("globalSearch")}
            getCommandContext={getCommandContext}
        />
    );
};
