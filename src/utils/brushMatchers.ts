export type { ActiveBrush, BrushableCard } from "@/types/board.types";
import type { ActiveBrush, BrushableCard } from "@/types/board.types";

export function matchesBrush(brush: ActiveBrush | null, card: BrushableCard): boolean {
    if (!brush) return true;

    switch (brush.type) {
        case "model":
            return !!card.model && card.model.includes(brush.value);
        case "tool":
            if (brush.value === "document") {
                // Special handling for "Documentation" brush
                // Matches if variant is 'document' OR if any edited file is a markdown file
                return card.variant === "document" || card.editedFiles.some(f => f.toLowerCase().endsWith('.md') || f.toLowerCase().endsWith('.markdown'));
            }
            if (brush.value === "code") {
                // Return true if variant is code (Edits OR Reads)
                // OR if it's explicitly a file edit (handles create_file which is variant: file)
                return card.variant === 'code' || card.isFileEdit;
            }
            if (brush.value === "git") {
                // Matches explicit git variant OR generic git commands
                return card.variant === "git" || card.isGit;
            }
            return card.variant === brush.value;
        case "status":
            switch (brush.value) {
                case "error": return card.isError;
                case "cancelled": return card.isCancelled;
                case "commit": return card.isCommit;
                default: return false;
            }
        case "file":
            // Exact match for now
            return card.editedFiles.some(f => f === brush.value || f.endsWith(brush.value));
        default:
            return false;
    }
}
