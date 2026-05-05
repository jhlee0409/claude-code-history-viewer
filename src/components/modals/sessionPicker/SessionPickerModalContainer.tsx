import { SessionPickerModal } from "./SessionPickerModal";

/**
 * Thin passthrough for consistency with other modals in `src/components/modals`.
 * Visibility is driven entirely by the store, so no useModal wiring is needed.
 */
export const SessionPickerModalContainer: React.FC = () => {
    return <SessionPickerModal />;
};
