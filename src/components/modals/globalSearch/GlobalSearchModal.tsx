/**
 * The ⌘K palette (plans T6b, T10): one cmdk list with four groups, in this
 * order - Commands, Projects, Sessions, Messages.
 *
 * - Commands, Projects and Sessions are matched synchronously from what the
 *   app holds (`paletteEntries`, `paletteSources`), so they follow every
 *   keystroke, IME composition included.
 * - Messages come from the backend search (`usePaletteMessageSearch`),
 *   debounced, owned by the field's text + scope + filter it was asked for,
 *   and never sent mid IME composition: starting one ends the typed query's
 *   search, and its end searches the composed text. The group shows its
 *   own waiting / loading / error / empty state and never holds up the
 *   others; a live region reports its outcome to screen readers.
 * - The scope chip ("This project" / "All projects") scopes Sessions and
 *   Messages; Projects always lists every project.
 * - Scoped with Tab to a project that is not open, Sessions reads its list
 *   (`useScopedProjectSessions`). If that fails the group says so - its
 *   rows are then only the sessions the app already knew of - with a "Try
 *   again" item, and the scope's live region reports it.
 * - Tab on a highlighted Projects row scopes Sessions and Messages to that
 *   project without opening it (phones: the row's "Search in this project"
 *   button). A pill naming the project stands in for the chip until it is
 *   cleared - the pill itself, or Backspace in an empty field - and the
 *   scope before it (the chip's) comes back. The query stays; Escape closes
 *   the palette as ever. Tab anywhere else, and Tab during an IME
 *   composition, keeps its usual meaning.
 * - Picking a row closes the palette and moves there with `navigate`
 *   (`navigation/paletteOpen.ts`): a project or session as its sidebar row
 *   opens it, a message as its session with the message as the explicit
 *   target. ⌘/Ctrl+Enter or ⌘/Ctrl+click opens it in a new tab (T8).
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { useTranslation } from "react-i18next";
import {
    Search,
    ArrowUp,
    ArrowDown,
    CornerDownLeft,
    X,
    User,
    Bot,
    MessageSquare,
    Lightbulb,
} from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { Dialog, DialogContent, Input } from "@/components/ui";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeMessage, ClaudeProject } from "@/types";
import { cn } from "@/lib/utils";
import type { CommandId } from "@/commands/manifest";
import { dispatchCommand, type CommandContext } from "@/commands/registry";
import { commandItemValue, paletteEntries } from "@/commands/paletteQuery";
import {
    GROUP_LIMIT,
    isSameProject,
    matchProjects,
    matchSessions,
    MESSAGE_PREVIEW_LIMIT,
    MIN_MESSAGE_QUERY,
    MORE_PROJECTS_VALUE,
    MORE_SESSIONS_VALUE,
    projectItemValue,
    RETRY_SESSIONS_VALUE,
    sessionCandidates,
    sessionItemValue,
    unsearchableProviders,
    type PaletteScope,
    type ProjectHit,
    type SessionCandidate,
} from "@/commands/paletteSources";
import { favoritesOf } from "@/navigation/library";
import { openMessageResult, openSessionTarget, runPaletteOpen } from "@/navigation/paletteOpen";
import { usePlaceOpeners } from "@/contexts/placeOpeners";
import { isActionModifier, isMacOS } from "@/utils/platform";
import { getProjectDisplayName } from "@/utils/pathUtils";
import { PaletteCommandGroup } from "./PaletteCommandGroup";
import { PaletteComboboxLink } from "./PaletteComboboxLink";
import { PaletteProjectGroup, PaletteSessionGroup } from "./PalettePlaceGroups";
import { PaletteMessageGroup } from "./PaletteMessageGroup";
import { messageGroupValues } from "./paletteMessageValues";
import { useScopedProjectSessions } from "./useScopedProjectSessions";
import {
    MAX_MESSAGE_RESULTS,
    usePaletteMessageSearch,
    type MessageTypeFilter,
} from "./usePaletteMessageSearch";

interface GlobalSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Live context of the palette's commands (`useCommandContext`). */
    getCommandContext: () => CommandContext;
}

/**
 * The keys cmdk's root acts on: move the highlight, pick the highlighted
 * item. Typed in the search field they drive the list; pressed on another
 * control in the palette (a type filter, the scope chip, clear) they
 * belong to that control alone, so they must not reach the root. Stopping
 * propagation, not the default, keeps the browser's own activation.
 */
const LIST_KEYS = new Set(["Enter", "ArrowDown", "ArrowUp", "Home", "End"]);
const keepKeysFromList = (e: React.KeyboardEvent) => {
    if (LIST_KEYS.has(e.key)) e.stopPropagation();
};

type ExpandableGroup = "projects" | "sessions" | "messages";

/** Tab with no modifier: the key that scopes to a highlighted project. */
const isPlainTab = (e: React.KeyboardEvent) =>
    e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;

/** An IME owns the key (composition, or the key that ends one). */
const isImeKey = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/** Marks where the project name sits in the pill's translated text. */
const NAME_SLOT = "\u0001";

export const GlobalSearchModal = ({
    isOpen,
    onClose,
    getCommandContext,
}: GlobalSearchModalProps) => {
    const { t } = useTranslation();
    // What the field shows, and whether an IME is composing it. The message
    // search runs on exactly these two (a half-composed syllable - Hangul,
    // kana - never goes to the backend; see `usePaletteMessageSearch`).
    const [query, setQuery] = useState("");
    const [composing, setComposing] = useState(false);
    const [messageTypeFilter, setMessageTypeFilter] = useState<MessageTypeFilter>("all");
    const [scope, setScope] = useState<PaletteScope>("all");
    // A project scoped with Tab (or the phone's row button); over `scope`
    // until cleared, which brings `scope` back as it was.
    const [pinned, setPinned] = useState<ClaudeProject | null>(null);
    // What the scope live region last said: set by the scope changes alone.
    const [scopeNotice, setScopeNotice] = useState("");
    // "Show more" opens a group for the query it was asked under.
    const [expanded, setExpanded] = useState<{ query: string; groups: ExpandableGroup[] }>({ query: "", groups: [] });
    const isExpanded = (group: ExpandableGroup) => expanded.query === query && expanded.groups.includes(group);
    const inputRef = useRef<HTMLInputElement>(null);
    // A command picked in the palette runs once the palette has closed and
    // released focus (`onCloseAutoFocus`), so ⌘F's find field keeps it.
    const pendingCommandRef = useRef<CommandId | null>(null);
    const openers = usePlaceOpeners();

    const {
        projects,
        sessions,
        selectedProject,
        recentSessions,
        userMetadata,
        getSessionDisplayName,
        isProjectHidden,
        excludeSidechain,
    } = useAppStore();
    // Scope "project" needs an open project; without one the chip is "all".
    const effectiveScope: PaletteScope = selectedProject ? scope : "all";
    // The project Sessions and Messages search, if any: the pinned one, else
    // the open one under "This project".
    const scopedProject = pinned ?? (effectiveScope === "project" ? (selectedProject ?? null) : null);
    const searchScope: PaletteScope = scopedProject ? "project" : "all";

    const { view: messageView, retry: retryMessages } = usePaletteMessageSearch({
        query,
        composing,
        scope: searchScope,
        messageType: messageTypeFilter,
        project: scopedProject,
        enabled: isOpen,
    });
    const {
        sessions: pinnedSessions,
        failed: pinnedSessionsFailed,
        retry: retryPinnedSessions,
    } = useScopedProjectSessions(pinned, selectedProject ?? null, sessions ?? [], excludeSidechain);

    // ---- the synchronous sources -------------------------------------------
    const commandEntries = paletteEntries(query, getCommandContext(), t);
    // Hidden projects stay out, as in the sidebar (flag or hidden pattern).
    const projectHits = useMemo(
        () => matchProjects(query, projects ?? [], (p) => isProjectHidden?.(p.path) === true),
        // `userMetadata`: the hidden flags and patterns `isProjectHidden` reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [query, projects, isProjectHidden, userMetadata],
    );
    const candidates = useMemo(
        () =>
            sessionCandidates({
                scope: searchScope,
                sessions: pinned ? pinnedSessions : (sessions ?? []),
                selectedProject: pinned ?? selectedProject ?? null,
                recent: recentSessions ?? [],
                favorites: userMetadata ? favoritesOf(userMetadata) : [],
                projects: projects ?? [],
                titleOf: (id, fallback) => getSessionDisplayName?.(id, fallback) ?? fallback,
            }),
        [searchScope, pinned, pinnedSessions, sessions, selectedProject, recentSessions, userMetadata, projects, getSessionDisplayName],
    );
    const sessionHits = useMemo(() => matchSessions(query, candidates), [query, candidates]);
    const notSearched = useMemo(() => unsearchableProviders(projects ?? []), [projects]);

    // ---- the highlighted item ------------------------------------------------
    const shownValues = (hits: readonly unknown[], group: ExpandableGroup, value: (i: number) => string, more: string) => {
        const open = isExpanded(group);
        const shown = open ? hits.length : Math.min(hits.length, GROUP_LIMIT);
        const values = Array.from({ length: shown }, (_, i) => value(i));
        if (!open && hits.length > GROUP_LIMIT) values.push(more);
        return values;
    };
    const itemValues = [
        ...commandEntries.filter((entry) => entry.enabled).map((entry) => commandItemValue(entry.command.id)),
        ...shownValues(projectHits, "projects", (i) => projectItemValue(projectHits[i]!.project), MORE_PROJECTS_VALUE),
        ...(pinnedSessionsFailed ? [RETRY_SESSIONS_VALUE] : []),
        ...shownValues(sessionHits, "sessions", (i) => sessionItemValue(sessionHits[i]!), MORE_SESSIONS_VALUE),
        ...messageGroupValues(messageView, isExpanded("messages")),
    ];
    // The highlight belongs to its query: a new query starts again at the
    // first item. Rows arriving later (messages) leave it where it is, as
    // long as the highlighted row is still listed.
    const [selection, setSelection] = useState<{ query: string; value: string } | null>(null);
    const selectedValue =
        selection && selection.query === query && itemValues.includes(selection.value)
            ? selection.value
            : (itemValues[0] ?? "");
    const handleSelectionChange = useCallback((value: string) => setSelection({ query, value }), [query]);
    const listRef = useRef<HTMLDivElement>(null);
    // The highlighted row's project, when it is a Projects row (Tab's target).
    const highlightedProject = projectHits.find((h) => projectItemValue(h.project) === selectedValue)?.project ?? null;

    // ---- scope to a project (Tab) -------------------------------------------
    const scopeTo = (project: ClaudeProject) => {
        if (!isSameProject(project, pinned)) {
            setPinned(project);
            setScopeNotice(t("globalSearch.live.scopePinned", { project: getProjectDisplayName(project) }));
        }
        inputRef.current?.focus();
    };
    const clearPinned = () => {
        setPinned(null);
        setScopeNotice(
            t("globalSearch.live.scopeCleared", {
                scope: t(effectiveScope === "project" ? "globalSearch.scope.project" : "globalSearch.scope.all"),
            }),
        );
        inputRef.current?.focus();
    };
    // The field's own keys, before cmdk's root and the dialog's focus trap.
    const handleFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (composing || isImeKey(e)) return;
        if (isPlainTab(e) && highlightedProject) {
            e.preventDefault();
            e.stopPropagation();
            scopeTo(highlightedProject);
        } else if (e.key === "Backspace" && pinned && e.currentTarget.value === "") {
            e.preventDefault();
            clearPinned();
        }
    };

    // ---- input -------------------------------------------------------------
    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
    }, []);
    const handleCompositionStart = useCallback(() => setComposing(true), []);
    // The composed text is the field's value now (some engines end the
    // composition before its last input event).
    const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
        setComposing(false);
        setQuery(e.currentTarget.value);
    }, []);
    const clearQuery = () => {
        setQuery("");
        inputRef.current?.focus();
    };

    // ⌘+click / ⌘+Enter on a row opens it in a new tab (T8). cmdk's
    // `onSelect` carries no event, so the modifier of the pointer or key that
    // picked it is noted on the way down.
    const newTabModifierRef = useRef(false);
    const noteModifier = (event: { metaKey: boolean; ctrlKey: boolean }) => {
        newTabModifierRef.current = isActionModifier(event);
    };

    /** Close the palette and run the pick (a navigation of its own). */
    const pick = useCallback(
        (open: () => Promise<boolean>) => {
            const inNewTab = newTabModifierRef.current;
            newTabModifierRef.current = false;
            onClose();
            void runPaletteOpen(open, inNewTab);
        },
        [onClose],
    );
    const openProject = useCallback((hit: ProjectHit) => pick(() => openers.openProject(hit.project)), [pick, openers]);
    const openSession = useCallback(
        (hit: SessionCandidate) => pick(() => openSessionTarget(hit.target, openers)),
        [pick, openers],
    );
    const openMessage = useCallback((result: ClaudeMessage) => pick(() => openMessageResult(result)), [pick]);

    const expand = (group: ExpandableGroup, firstNew?: string) => {
        setExpanded((prev) => ({
            query,
            groups: prev.query === query ? [...prev.groups, group] : [group],
        }));
        if (firstNew) setSelection({ query, value: firstNew });
    };

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        },
        [onClose],
    );

    const handleRunCommand = useCallback(
        (id: CommandId) => {
            pendingCommandRef.current = id;
            onClose();
        },
        [onClose],
    );

    const handleCloseAutoFocus = useCallback(
        (event: Event) => {
            const id = pendingCommandRef.current;
            if (!id) return;
            pendingCommandRef.current = null;
            event.preventDefault();
            dispatchCommand(id, getCommandContext);
        },
        [getCommandContext],
    );

    // Focus the field when the palette opens; start over when it closes.
    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(timer);
        }
        setQuery("");
        setComposing(false);
        setScope("all");
        setPinned(null);
        setScopeNotice("");
        setMessageTypeFilter("all");
        setExpanded({ query: "", groups: [] });
        return undefined;
    }, [isOpen]);

    // What the Messages group says, for screen readers (it changes with no
    // focus move). Silent below the search's minimum length.
    const liveText = (() => {
        switch (messageView.status) {
            case "loading":
                return t("globalSearch.messages.searching");
            case "error":
                return t("globalSearch.messages.failed");
            case "done":
                return messageView.results.length > 0
                    ? t("globalSearch.live.found", { count: messageView.results.length })
                    : t("globalSearch.messages.none");
            default:
                return "";
        }
    })();
    const messageCount = messageView.status === "done" ? messageView.results.length : 0;
    const trimmed = query.trim();
    const scopeProjectLabel = selectedProject ? getProjectDisplayName(selectedProject) : undefined;
    const pinnedLabel = pinned ? getProjectDisplayName(pinned) : "";
    const sessionsFailedText = pinnedSessionsFailed ? t("globalSearch.sessions.failed", { project: pinnedLabel }) : "";
    // The pill's text around the project name, which alone may shorten.
    const [pillBefore = "", pillAfter = ""] = pinned
        ? String(t("globalSearch.scope.pinned", { project: NAME_SLOT })).split(NAME_SLOT)
        : [];

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="sm:max-w-2xl p-0 gap-0 overflow-hidden"
                onKeyDown={handleKeyDown}
                onKeyDownCapture={noteModifier}
                onPointerDownCapture={noteModifier}
                onCloseAutoFocus={handleCloseAutoFocus}
                showCloseButton={false}
                aria-label={t("globalSearch.title")}
            >
              <CommandPrimitive
                value={selectedValue}
                onValueChange={handleSelectionChange}
                shouldFilter={false}
                vimBindings={false}
                loop
                label={t("common.commandPalette")}
                // min-w-0: the dialog is a grid; without it a long row (a
                // path, a title) widens the palette past a phone's screen.
                className="flex flex-col min-h-0 min-w-0 outline-none"
              >
                {/* Search Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                    {/* A combobox: PaletteComboboxLink adds aria-controls and
                        aria-activedescendant once cmdk has rendered the list. */}
                    <Input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded
                        aria-autocomplete="list"
                        type="text"
                        value={query}
                        onChange={handleInputChange}
                        onKeyDown={handleFieldKeyDown}
                        onCompositionStart={handleCompositionStart}
                        onCompositionEnd={handleCompositionEnd}
                        placeholder={t("globalSearch.placeholder")}
                        className="border-0 shadow-none focus-visible:ring-0 px-0 h-auto text-body"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                    />
                    {query && (
                        <button
                            type="button"
                            onKeyDown={keepKeysFromList}
                            onClick={clearQuery}
                            className="p-1 hover:bg-muted rounded"
                            aria-label={t("globalSearch.clearSearch")}
                        >
                            <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                    )}
                </div>

                {/* Filters Bar: its keys work its own controls, never the list */}
                <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 border-b border-border bg-muted/20"
                    onKeyDown={keepKeysFromList}
                >
                    {/* Message Type Filter */}
                    <div className="flex items-center gap-1">
                        {(["all", "user", "assistant"] as const).map((type) => (
                            <button
                                key={type}
                                type="button"
                                aria-pressed={messageTypeFilter === type}
                                onClick={() => setMessageTypeFilter(type)}
                                className={cn(
                                    "flex items-center gap-1 px-2 py-1 text-list rounded-md transition-colors",
                                    messageTypeFilter === type
                                        ? "bg-foreground/10 text-foreground font-medium"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                )}
                                aria-label={t(`globalSearch.filterType.${type}`)}
                            >
                                {type === "all" && <MessageSquare className="w-3.5 h-3.5" />}
                                {type === "user" && <User className="w-3.5 h-3.5" />}
                                {type === "assistant" && <Bot className="w-3.5 h-3.5" />}
                                <span>{t(`globalSearch.filterType.${type}`)}</span>
                            </button>
                        ))}
                    </div>

                    {/* Scope: a pill for a project scoped with Tab, else the chip -
                        Sessions and Messages search the open project or everything */}
                    {pinned ? (
                        <div className="segmented min-w-0 max-w-full">
                            <button
                                type="button"
                                data-active="true"
                                className="segmented-item flex items-center gap-1.5 min-w-0 px-2 py-0.5 text-list whitespace-nowrap"
                                aria-label={t("globalSearch.scope.pinnedAria", { project: pinnedLabel })}
                                title={pinned.actual_path || pinned.path}
                                onClick={clearPinned}
                            >
                                {/* One run of text; only the name gives way. */}
                                <span className="flex min-w-0">
                                    {pillBefore && <span className="shrink-0 whitespace-pre">{pillBefore}</span>}
                                    <span className="min-w-0 truncate">{pinnedLabel}</span>
                                    {pillAfter && <span className="shrink-0 whitespace-pre">{pillAfter}</span>}
                                </span>
                                <X className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            </button>
                        </div>
                    ) : (
                    <div className="segmented" role="group" aria-label={t("globalSearch.scope.label")}>
                        <button
                            type="button"
                            className="segmented-item px-2 py-0.5 text-list whitespace-nowrap"
                            aria-pressed={effectiveScope === "project"}
                            disabled={!selectedProject}
                            title={selectedProject ? scopeProjectLabel : t("globalSearch.scope.projectUnavailable")}
                            onClick={() => setScope("project")}
                        >
                            {t("globalSearch.scope.project")}
                        </button>
                        <button
                            type="button"
                            className="segmented-item px-2 py-0.5 text-list whitespace-nowrap"
                            aria-pressed={effectiveScope === "all"}
                            onClick={() => setScope("all")}
                        >
                            {t("globalSearch.scope.all")}
                        </button>
                    </div>
                    )}
                </div>

                {/* Commands, Projects, Sessions, Messages: one cmdk list */}
                <CommandPrimitive.List
                    ref={listRef}
                    label={t("globalSearch.title")}
                    className="max-h-100 overflow-y-auto"
                >
                    <PaletteCommandGroup entries={commandEntries} onRun={handleRunCommand} />
                    <PaletteProjectGroup
                        hits={projectHits}
                        query={query}
                        expanded={isExpanded("projects")}
                        onExpand={() =>
                            expand("projects", projectHits[GROUP_LIMIT] && projectItemValue(projectHits[GROUP_LIMIT].project))
                        }
                        onOpen={openProject}
                        onScope={(hit) => scopeTo(hit.project)}
                    />
                    <PaletteSessionGroup
                        hits={sessionHits}
                        query={query}
                        expanded={isExpanded("sessions")}
                        onExpand={() => expand("sessions", sessionHits[GROUP_LIMIT] && sessionItemValue(sessionHits[GROUP_LIMIT]))}
                        onOpen={openSession}
                        failed={pinnedSessionsFailed ? { project: pinnedLabel, onRetry: retryPinnedSessions } : undefined}
                    />
                    <PaletteMessageGroup
                        view={messageView}
                        expanded={isExpanded("messages")}
                        onExpand={() => expand("messages", messageGroupValues(messageView, true)[MESSAGE_PREVIEW_LIMIT])}
                        onOpen={openMessage}
                        onRetry={retryMessages}
                        // A scoped search reaches one project: other providers
                        // were never asked, so naming them would mislead.
                        notSearched={scopedProject ? [] : notSearched}
                        scopeProvider={scopedProject?.provider}
                    />

                    {/* Empty state with search tips */}
                    {!query && (
                        <div className="px-6 py-8 space-y-4">
                            <div className="text-center">
                                <Icon icon={Search} size={24} className="text-muted-foreground/40 mx-auto mb-3" />
                                <p className="text-body text-muted-foreground">
                                    {t("globalSearch.hint")}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-start gap-2 text-list text-muted-foreground/70">
                                    <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <span>{t("globalSearch.tips.minChars")}</span>
                                </div>
                                <div className="flex items-start gap-2 text-list text-muted-foreground/70">
                                    <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <span>{t("globalSearch.tips.filters")}</span>
                                </div>
                                <div className="flex items-start gap-2 text-list text-muted-foreground/70">
                                    <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <span>{t("globalSearch.tips.navigate")}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Typing, but too short for the message search */}
                    {trimmed.length > 0 && trimmed.length < MIN_MESSAGE_QUERY && (
                        <div className="px-4 py-3 text-list text-muted-foreground">
                            {t("globalSearch.messages.minChars")}
                        </div>
                    )}
                </CommandPrimitive.List>
                <PaletteComboboxLink inputRef={inputRef} listRef={listRef} selectedValue={selectedValue} />
                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {liveText}
                </div>
                {/* The scope's own region: its change is not the search's outcome;
                    nor is its session list failing, which it reports too. */}
                <div data-palette-scope-live aria-live="polite" aria-atomic="true" className="sr-only">
                    {sessionsFailedText || scopeNotice}
                </div>

                {/* Footer: keyboard hints (not on phones, which have no
                    keyboard to use them with) and the message count. */}
                <div
                    className={cn(
                        "items-center justify-between gap-3 px-4 py-2 border-t border-border bg-muted/30 text-list text-muted-foreground",
                        messageCount > 0 ? "flex" : "hidden sm:flex",
                    )}
                >
                    <div className="hidden sm:flex items-center gap-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono">
                                <ArrowUp className="w-3.5 h-3.5 inline" />
                            </kbd>
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono">
                                <ArrowDown className="w-3.5 h-3.5 inline" />
                            </kbd>
                            <span className="ml-1">
                                {t("globalSearch.navigate")}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono">
                                <CornerDownLeft className="w-3.5 h-3.5 inline" />
                            </kbd>
                            <span className="ml-1">
                                {t("globalSearch.select")}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-caption">
                                {isMacOS() ? "⌘" : "Ctrl"}
                            </kbd>
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono">
                                <CornerDownLeft className="w-3.5 h-3.5 inline" />
                            </kbd>
                            <span className="ml-1">
                                {t("globalSearch.openInNewTab")}
                            </span>
                        </div>
                        {highlightedProject && (
                            <div className="flex items-center gap-1">
                                <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-caption">
                                    Tab
                                </kbd>
                                <span className="ml-1">
                                    {t("globalSearch.scope.tabHint")}
                                </span>
                            </div>
                        )}
                        <div className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-caption">
                                esc
                            </kbd>
                            <span className="ml-1">
                                {t("globalSearch.close")}
                            </span>
                        </div>
                    </div>
                    {messageCount > 0 && (
                        <span className="ml-auto text-right">
                            {messageCount >= MAX_MESSAGE_RESULTS
                                ? t("globalSearch.resultsCapped", { count: MAX_MESSAGE_RESULTS })
                                : t("globalSearch.results", { count: messageCount })}
                        </span>
                    )}
                </div>
              </CommandPrimitive>
            </DialogContent>
        </Dialog>
    );
};
