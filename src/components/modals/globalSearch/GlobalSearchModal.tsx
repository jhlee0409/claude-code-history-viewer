import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
    Search,
    ArrowUp,
    ArrowDown,
    CornerDownLeft,
    X,
    Loader2,
} from "lucide-react";
import { Dialog, DialogContent, Input } from "@/components/ui";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeMessage, ClaudeSession, ContentItem } from "@/types";

type GlobalSearchResult = ClaudeMessage;

interface GlobalSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const GlobalSearchModal = ({
    isOpen,
    onClose,
}: GlobalSearchModalProps) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<GlobalSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsContainerRef = useRef<HTMLDivElement>(null);
    const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    const { claudePath, projects, selectProject, selectSession, sessions } =
        useAppStore();

    // Group results by project name
    const groupedResults = useMemo(() => {
        const groups = new Map<string, GlobalSearchResult[]>();

        for (const result of results) {
            const projectName =
                result.projectName || t("globalSearch.unknownProject");
            if (!groups.has(projectName)) {
                groups.set(projectName, []);
            }
            groups.get(projectName)!.push(result);
        }

        return groups;
    }, [results, t]);

    // Flatten grouped results for keyboard navigation
    const flattenedResults = useMemo(() => {
        const flat: GlobalSearchResult[] = [];
        for (const items of groupedResults.values()) {
            flat.push(...items);
        }
        return flat;
    }, [groupedResults]);

    // Maximum results to display for performance
    const MAX_RESULTS = 100;

    // Debounced search
    const performSearch = useCallback(
        async (searchQuery: string) => {
            const trimmedQuery = searchQuery.trim();

            // Require at least 2 characters to search
            if (!claudePath || trimmedQuery.length < 2) {
                setResults([]);
                setIsSearching(false);
                return;
            }

            setIsSearching(true);
            try {
                const searchResults = await invoke<GlobalSearchResult[]>(
                    "search_messages",
                    {
                        claudePath,
                        query: trimmedQuery,
                        filters: {},
                        limit: MAX_RESULTS,
                    },
                );
                setResults(searchResults);
                setSelectedIndex(0);
            } catch (error) {
                console.error("Global search failed:", error);
                setResults([]);
            } finally {
                setIsSearching(false);
            }
        },
        [claudePath],
    );

    // Handle input change with debounce
    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value;
            setQuery(value);

            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }

            debounceTimeoutRef.current = setTimeout(() => {
                performSearch(value);
            }, 300);
        },
        [performSearch],
    );

    // Navigate to selected result
    const handleSelectResult = useCallback(
        async (result: GlobalSearchResult) => {
            // First, check if the session is in the currently loaded sessions
            let targetSession = sessions.find(
                (s) =>
                    s.session_id === result.sessionId ||
                    s.actual_session_id === result.sessionId,
            );

            if (targetSession) {
                // Session is in current project, just select it
                await selectSession(targetSession);
                onClose();
                return;
            }

            // Session not in current project - search through all projects
            for (const project of projects) {
                try {
                    // Load sessions for this project directly via invoke
                    const projectSessions = await invoke<ClaudeSession[]>(
                        "load_project_sessions",
                        { projectPath: project.path },
                    );

                    // Check if any session matches
                    targetSession = projectSessions.find(
                        (s) =>
                            s.session_id === result.sessionId ||
                            s.actual_session_id === result.sessionId,
                    );

                    if (targetSession) {
                        // Found it! Select the project first, then the session
                        await selectProject(project);
                        // After selectProject, sessions state is updated
                        // We need to select the session from the updated state
                        await selectSession(targetSession);
                        onClose();
                        return;
                    }
                } catch (error) {
                    console.error(
                        `Failed to load sessions for project ${project.name}:`,
                        error,
                    );
                }
            }

            // Session not found in any project
            console.warn(
                `Could not find session ${result.sessionId} in any project`,
            );
            onClose();
        },
        [projects, sessions, selectProject, selectSession, onClose],
    );

    // Keyboard navigation
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (flattenedResults.length === 0) return;

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex((prev) =>
                        prev < flattenedResults.length - 1 ? prev + 1 : 0,
                    );
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex((prev) =>
                        prev > 0 ? prev - 1 : flattenedResults.length - 1,
                    );
                    break;
                case "Enter":
                    e.preventDefault();
                    if (flattenedResults[selectedIndex]) {
                        handleSelectResult(flattenedResults[selectedIndex]);
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    onClose();
                    break;
            }
        },
        [flattenedResults, selectedIndex, handleSelectResult, onClose],
    );

    // Scroll selected item into view
    useEffect(() => {
        if (resultsContainerRef.current && flattenedResults.length > 0) {
            const selectedElement = resultsContainerRef.current.querySelector(
                `[data-index="${selectedIndex}"]`,
            );
            selectedElement?.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex, flattenedResults.length]);

    // Focus input when modal opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 0);
        } else {
            setQuery("");
            setResults([]);
            setSelectedIndex(0);
        }
    }, [isOpen]);

    // Cleanup debounce on unmount
    useEffect(() => {
        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
        };
    }, []);

    // Get preview text from message content
    const getPreviewText = (message: GlobalSearchResult): string => {
        if (!message.content) return t("globalSearch.noPreview");

        const content = message.content;
        if (typeof content === "string") {
            return content.slice(0, 150) + (content.length > 150 ? "..." : "");
        }

        if (Array.isArray(content)) {
            for (const item of content as ContentItem[]) {
                if (item.type === "text" && "text" in item) {
                    const text = item.text as string;
                    return (
                        text.slice(0, 150) + (text.length > 150 ? "..." : "")
                    );
                }
            }
        }

        return t("globalSearch.noPreview");
    };

    // Format timestamp
    const formatTimestamp = (timestamp: string): string => {
        try {
            const date = new Date(timestamp);
            return date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            });
        } catch {
            return "";
        }
    };

    // Highlight search term in text
    const highlightText = (text: string, searchTerm: string): React.ReactNode => {
        if (!searchTerm.trim()) return text;

        const regex = new RegExp(
            `(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
        );
        const parts = text.split(regex);

        return parts.map((part, index) =>
            regex.test(part) ? (
                <mark
                    key={index}
                    className="bg-yellow-300 dark:bg-yellow-500/40 text-foreground rounded-sm px-0.5"
                >
                    {part}
                </mark>
            ) : (
                part
            ),
        );
    };

    let currentResultIndex = 0;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="sm:max-w-2xl p-0 gap-0 overflow-hidden"
                onKeyDown={handleKeyDown}
                showCloseButton={false}
            >
                {/* Search Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={handleInputChange}
                        placeholder={t("globalSearch.placeholder")}
                        className="border-0 shadow-none focus-visible:ring-0 px-0 h-auto text-sm"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                    />
                    {isSearching && (
                        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
                    )}
                    {query && !isSearching && (
                        <button
                            onClick={() => {
                                setQuery("");
                                setResults([]);
                                inputRef.current?.focus();
                            }}
                            className="p-1 hover:bg-muted rounded"
                        >
                            <X className="w-3 h-3 text-muted-foreground" />
                        </button>
                    )}
                </div>

                {/* Results */}
                <div
                    ref={resultsContainerRef}
                    className="max-h-100 overflow-y-auto"
                >
                    {isSearching && results.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            {t("globalSearch.searching")}
                        </div>
                    )}

                    {!isSearching && query && results.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            {t("globalSearch.noResults")}
                        </div>
                    )}

                    {!query && (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            {t("globalSearch.hint")}
                        </div>
                    )}

                    {results.length > 0 && (
                        <div className="py-2">
                            {Array.from(groupedResults.entries()).map(
                                ([projectName, items]) => (
                                    <div key={projectName}>
                                        {/* Project Header */}
                                        <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground bg-muted sticky top-0 truncate">
                                            {projectName}
                                        </div>

                                        {/* Results in this project */}
                                        {items.map((result) => {
                                            const index = currentResultIndex++;
                                            const isSelected =
                                                index === selectedIndex;

                                            return (
                                                <button
                                                    key={result.uuid}
                                                    data-index={index}
                                                    onClick={() =>
                                                        handleSelectResult(
                                                            result,
                                                        )
                                                    }
                                                    className={`w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors ${
                                                        isSelected
                                                            ? "bg-muted"
                                                            : ""
                                                    }`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span
                                                                    className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                                                        result.type ===
                                                                        "user"
                                                                            ? "bg-blue-500/10 text-blue-500"
                                                                            : result.type ===
                                                                                "assistant"
                                                                              ? "bg-amber-500/10 text-amber-500"
                                                                              : "bg-gray-500/10 text-gray-500"
                                                                    }`}
                                                                >
                                                                    {
                                                                        result.type
                                                                    }
                                                                </span>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {formatTimestamp(
                                                                        result.timestamp,
                                                                    )}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-foreground line-clamp-2">
                                                                {highlightText(
                                                                    getPreviewText(result),
                                                                    query,
                                                                )}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ),
                            )}
                        </div>
                    )}
                </div>

                {/* Footer with keyboard hints */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono">
                                <ArrowUp className="w-3 h-3 inline" />
                            </kbd>
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono">
                                <ArrowDown className="w-3 h-3 inline" />
                            </kbd>
                            <span className="ml-1">
                                {t("globalSearch.navigate")}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono">
                                <CornerDownLeft className="w-3 h-3 inline" />
                            </kbd>
                            <span className="ml-1">
                                {t("globalSearch.select")}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">
                                esc
                            </kbd>
                            <span className="ml-1">
                                {t("globalSearch.close")}
                            </span>
                        </div>
                    </div>
                    {results.length > 0 && (
                        <span>
                            {t("globalSearch.results", {
                                count: results.length,
                            })}
                        </span>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
