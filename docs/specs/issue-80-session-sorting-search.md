# Implementation Spec: Session List Sorting and Search (#80)

> **Issue:** [#80 - 左侧列表建议增加筛选搜索](https://github.com/jhlee0409/claude-code-history-viewer/issues/80)  
> **Author:** @drinkeewu  
> **Status:** Draft  
> **Classification:** MINOR — UI enhancement to existing sidebar component

---

## Problem Statement

Users want better control over the session list in the sidebar:

1. **Sorting** — Sessions are displayed in a fixed order (last modified). Users want to toggle between newest-first and oldest-first.
2. **Search/Filter** — A global search modal exists, but users want quick inline filtering directly in the sidebar without opening a modal.

### Current Behavior

- Sessions sorted by `last_modified` (descending) — hardcoded
- Search requires opening `GlobalSearchModal` via keyboard shortcut
- No filter input in the sidebar

### Requested Features

1. Time-based sorting toggle (ascending ↔ descending)
2. Inline search input at the top of the session list

---

## Proposed Solution

### Architecture Overview

```
ProjectTree/
├── index.tsx                    # Add search state, pass down
├── components/
│   ├── SessionListHeader.tsx    # NEW: Search input + sort toggle
│   ├── SessionList.tsx          # Receive filtered/sorted sessions
│   └── ...
```

### 1. Add Session List Header Component

Create a new component for search and sort controls:

```tsx
// src/components/ProjectTree/components/SessionListHeader.tsx
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SortOrder = "newest" | "oldest";

interface SessionListHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
}

export const SessionListHeader: React.FC<SessionListHeaderProps> = ({
  searchQuery,
  onSearchChange,
  sortOrder,
  onSortChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
      <div className="relative flex-1">
        <Input
          placeholder={t("session.search.placeholder", "Search sessions...")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-7 text-xs pr-7"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-7 w-7"
            onClick={() => onSearchChange("")}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => onSortChange(sortOrder === "newest" ? "oldest" : "newest")}
        title={t(
          sortOrder === "newest"
            ? "session.sort.oldestFirst"
            : "session.sort.newestFirst"
        )}
      >
        {sortOrder === "newest" ? (
          <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUp className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
};
```

### 2. Update ProjectTree Index

Add state management for search and sort:

```tsx
// In src/components/ProjectTree/index.tsx
import { useState, useMemo } from "react";
import { SessionListHeader, SortOrder } from "./components/SessionListHeader";

export const ProjectTree: React.FC<ProjectTreeProps> = ({ ... }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  // Filter and sort sessions
  const processedSessions = useMemo(() => {
    let result = [...sessions];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((session) =>
        session.summary?.toLowerCase().includes(query) ||
        session.session_id.toLowerCase().includes(query)
      );
    }

    // Sort by last_modified
    result.sort((a, b) => {
      const dateA = new Date(a.last_modified).getTime();
      const dateB = new Date(b.last_modified).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [sessions, searchQuery, sortOrder]);

  return (
    <div className="...">
      <SessionListHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
      />
      <SessionList sessions={processedSessions} ... />
    </div>
  );
};
```

### 3. Optional: Persist Sort Preference

Store sort preference in localStorage or Zustand store:

```tsx
// In useAppStore.ts (if persisting)
interface AppState {
  sessionSortOrder: SortOrder;
  setSessionSortOrder: (order: SortOrder) => void;
}

// Or simple localStorage
const savedOrder = localStorage.getItem("sessionSortOrder") as SortOrder;
const [sortOrder, setSortOrder] = useState<SortOrder>(savedOrder || "newest");

useEffect(() => {
  localStorage.setItem("sessionSortOrder", sortOrder);
}, [sortOrder]);
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/ProjectTree/components/SessionListHeader.tsx` | **NEW** — Search input + sort toggle |
| `src/components/ProjectTree/index.tsx` | Add search/sort state, filtering logic |
| `src/components/ProjectTree/types.ts` | Add `SortOrder` type if needed |
| `src/i18n/locales/en/translation.json` | Add translation keys |
| `src/i18n/locales/ko/translation.json` | Add translation keys |
| `src/i18n/locales/ja/translation.json` | Add translation keys |
| `src/i18n/locales/zh-CN/translation.json` | Add translation keys |
| `src/i18n/locales/zh-TW/translation.json` | Add translation keys |

---

## Translation Keys

```json
{
  "session": {
    "search": {
      "placeholder": "Search sessions..."
    },
    "sort": {
      "newestFirst": "Sort by newest first",
      "oldestFirst": "Sort by oldest first"
    }
  }
}
```

### Korean (ko)
```json
{
  "session": {
    "search": {
      "placeholder": "세션 검색..."
    },
    "sort": {
      "newestFirst": "최신순 정렬",
      "oldestFirst": "오래된순 정렬"
    }
  }
}
```

### Chinese Simplified (zh-CN)
```json
{
  "session": {
    "search": {
      "placeholder": "搜索会话..."
    },
    "sort": {
      "newestFirst": "按最新排序",
      "oldestFirst": "按最旧排序"
    }
  }
}
```

---

## Acceptance Criteria

- [ ] Search input visible at top of session list
- [ ] Typing in search filters sessions in real-time
- [ ] Empty search shows all sessions
- [ ] Sort toggle button visible next to search
- [ ] Clicking sort toggles between newest/oldest first
- [ ] Sort icon indicates current direction (↓ newest, ↑ oldest)
- [ ] Translations added for all 5 locales (EN, KO, JA, ZH-CN, ZH-TW)
- [ ] No performance regression with 100+ sessions
- [ ] Virtual scrolling still works with filtered results

---

## Testing Plan

### Manual Testing

1. **Search functionality**
   - Load app with multiple sessions
   - Type in search box → verify filtering works
   - Clear search → verify all sessions return
   - Search with no matches → verify empty state

2. **Sort functionality**
   - Toggle sort → verify order changes
   - Refresh page → verify sort preference (if persisted)

3. **Performance**
   - Test with 100+ sessions
   - Verify no lag while typing in search
   - Verify virtual scrolling works with filtered list

### Unit Tests (Optional)

```tsx
// src/test/SessionListHeader.test.tsx
describe("SessionListHeader", () => {
  it("calls onSearchChange when typing", () => {
    const onSearchChange = vi.fn();
    render(<SessionListHeader searchQuery="" onSearchChange={onSearchChange} ... />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "test" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("test");
  });

  it("toggles sort order on button click", () => {
    const onSortChange = vi.fn();
    render(<SessionListHeader sortOrder="newest" onSortChange={onSortChange} ... />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSortChange).toHaveBeenCalledWith("oldest");
  });
});
```

---

## Design Considerations

### UX

- Search input uses debounce for performance (optional, 150ms)
- Clear button (X) appears only when search has value
- Sort icon animates on toggle for visual feedback
- Placeholder text clearly indicates searchable fields

### Accessibility

- Search input has proper `aria-label`
- Sort button has descriptive `title` attribute
- Keyboard navigation works (Tab through controls)

### Edge Cases

- Empty session list: Hide header or show disabled state?
- Very long search query: Input should handle overflow
- Rapid typing: Consider debouncing filter operation

---

## Future Enhancements

1. **Advanced filters**: Filter by date range, token count, project
2. **Search history**: Remember recent searches
3. **Keyboard shortcut**: Focus search with `/` key
4. **Sort by other fields**: Token count, duration, message count

---

> ⚠️ **Note**: Code samples are reference implementations. Verify component paths and adapt to existing patterns before use.

---

*Generated by JJ ✨ (OpenClaw AI Assistant)*
