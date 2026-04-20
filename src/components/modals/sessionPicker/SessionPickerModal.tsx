import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui";
import { useAppStore } from "@/store/useAppStore";
import type { SessionPickerCandidate } from "@/store/slices/sessionPickerSlice";
import { cn } from "@/lib/utils";

/**
 * Opened automatically by `preloadSessionFromCli` when a `--session-title`
 * hint matches more than one session. Shows the matches and lets the user
 * pick one or dismiss; dismissal emits a toast so users know the startup
 * flag did nothing.
 */
export const SessionPickerModal: React.FC = () => {
    const { t } = useTranslation();
    const candidates = useAppStore((s) => s.sessionPickerCandidates);
    const hintValue = useAppStore((s) => s.sessionPickerHintValue);
    const closeSessionPicker = useAppStore((s) => s.closeSessionPicker);
    const selectProject = useAppStore((s) => s.selectProject);
    const selectSession = useAppStore((s) => s.selectSession);
    const getSessionDisplayName = useAppStore((s) => s.getSessionDisplayName);

    const isOpen = candidates !== null && candidates.length > 0;
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);

    // Reset selection when the candidate list changes (new invocation).
    useEffect(() => {
        if (isOpen) setSelectedIndex(0);
    }, [isOpen, candidates]);

    const handleSelect = useCallback(
        async (candidate: SessionPickerCandidate) => {
            closeSessionPicker();
            await selectProject(candidate.project);
            await selectSession(candidate.session);
        },
        [closeSessionPicker, selectProject, selectSession],
    );

    const handleDismiss = useCallback(() => {
        closeSessionPicker();
        toast(
            t(
                "sessionPicker.cancelled",
                "Startup session hint cancelled",
            ),
        );
    }, [closeSessionPicker, t]);

    // Keyboard navigation. The shadcn Dialog already handles ESC to close;
    // we hook that into the dismissal toast via the onOpenChange handler.
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (!candidates || candidates.length === 0) return;
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex((i) => (i < candidates.length - 1 ? i + 1 : 0));
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex((i) => (i > 0 ? i - 1 : candidates.length - 1));
                    break;
                case "Enter": {
                    e.preventDefault();
                    const picked = candidates[selectedIndex];
                    if (picked) void handleSelect(picked);
                    break;
                }
            }
        },
        [candidates, selectedIndex, handleSelect],
    );

    // Scroll the selected item into view on keyboard nav.
    useEffect(() => {
        const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
        el?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    const subtitle = useMemo(() => {
        if (!candidates || !hintValue) return "";
        return t("sessionPicker.subtitle", "{{count}} sessions match \"{{value}}\"", {
            count: candidates.length,
            value: hintValue,
        });
    }, [candidates, hintValue, t]);

    if (!isOpen) return null;

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(next) => {
                if (!next) handleDismiss();
            }}
        >
            <DialogContent className="max-w-2xl" onKeyDown={handleKeyDown}>
                <DialogHeader>
                    <DialogTitle>
                        {t("sessionPicker.title", "Choose a session")}
                    </DialogTitle>
                    <DialogDescription>{subtitle}</DialogDescription>
                </DialogHeader>
                <ul
                    ref={listRef}
                    role="listbox"
                    aria-label={t("sessionPicker.title", "Choose a session")}
                    className="max-h-[60vh] overflow-y-auto divide-y divide-border rounded-md border"
                >
                    {candidates!.map((c, i) => {
                        // Keyed by session_id to match the metadata store's
                        // keying used everywhere else in the UI.
                        const displayName =
                            getSessionDisplayName(c.session.session_id, c.session.summary)
                            ?? c.session.summary
                            ?? c.session.actual_session_id;
                        const lastMod = c.session.last_modified
                            ? new Date(c.session.last_modified).toLocaleString()
                            : "";
                        return (
                            <li
                                key={`${c.project.path}::${c.session.session_id}`}
                                role="option"
                                aria-selected={i === selectedIndex}
                                tabIndex={-1}
                                className={cn(
                                    "flex flex-col gap-1 p-3 cursor-pointer transition-colors",
                                    i === selectedIndex
                                        ? "bg-accent text-accent-foreground"
                                        : "hover:bg-accent/50",
                                )}
                                onClick={() => handleSelect(c)}
                                onMouseEnter={() => setSelectedIndex(i)}
                            >
                                <div className="font-medium text-sm truncate">
                                    {displayName}
                                </div>
                                <div className="text-xs text-muted-foreground flex gap-2">
                                    <span className="truncate">{c.project.name}</span>
                                    {lastMod && (
                                        <>
                                            <span aria-hidden>·</span>
                                            <span>{lastMod}</span>
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </DialogContent>
        </Dialog>
    );
};
