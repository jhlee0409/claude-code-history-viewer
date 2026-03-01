export type TreeNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";
export interface TreeItemAnnouncementLabels {
  collapsed: string;
  expanded: string;
  selected: string;
}

export function getNextTreeItemIndex(
  currentIndex: number,
  itemCount: number,
  key: TreeNavigationKey
): number {
  if (itemCount <= 0) {
    return -1;
  }

  switch (key) {
    case "ArrowDown":
      return Math.min(currentIndex + 1, itemCount - 1);
    case "ArrowUp":
      return Math.max(currentIndex - 1, 0);
    case "Home":
      return 0;
    case "End":
      return itemCount - 1;
    default:
      return currentIndex;
  }
}

export function normalizeTypeaheadLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function findTypeaheadMatchIndex(
  labels: string[],
  currentIndex: number,
  query: string
): number {
  if (labels.length === 0 || !query.trim()) {
    return -1;
  }

  const normalizedQuery = normalizeTypeaheadLabel(query);
  const normalizedLabels = labels.map(normalizeTypeaheadLabel);

  for (let offset = 1; offset <= normalizedLabels.length; offset += 1) {
    const index = (currentIndex + offset) % normalizedLabels.length;
    if (normalizedLabels[index]?.startsWith(normalizedQuery)) {
      return index;
    }
  }

  return -1;
}

export function buildTreeItemAnnouncement(
  rawLabel: string,
  state: {
    ariaExpanded?: "true" | "false" | null;
    ariaSelected?: "true" | "false" | null;
  },
  labels: TreeItemAnnouncementLabels,
  fallbackLabel: string
): string {
  const normalizedLabel = rawLabel.replace(/\s+/g, " ").trim() || fallbackLabel;
  const descriptors: string[] = [];

  if (state.ariaExpanded === "true") {
    descriptors.push(labels.expanded);
  } else if (state.ariaExpanded === "false") {
    descriptors.push(labels.collapsed);
  }

  if (state.ariaSelected === "true") {
    descriptors.push(labels.selected);
  }

  return descriptors.length > 0
    ? `${normalizedLabel}, ${descriptors.join(", ")}`
    : normalizedLabel;
}
