/**
 * RecentEditsViewer Module
 *
 * Re-exports the main component and types.
 */

export { RecentEditsViewer } from "./RecentEditsViewer";
export { FileEditItem } from "./FileEditItem";
export { FileEditRowCompact } from "./FileEditRowCompact";
export { FileEditExpansion } from "./FileEditExpansion";
export { useFileEditActions } from "./useFileEditActions";
export {
  RecentEditsScopeToggle,
  RecentEditsDensityToggle,
} from "./RecentEditsToggles";
export { RecentEditsOptionsMenu } from "./RecentEditsOptionsMenu";
export type { FileEditRowCompactProps } from "./FileEditRowCompact";
export type { RecentEditsViewerProps, FileEditItemProps, RestoreStatus } from "./types";
