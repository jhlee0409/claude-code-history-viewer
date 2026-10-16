import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  SquareTerminal,
  FileText,
  Search,
  Hash,
  List,
  MessageSquare,
  CircleAlert,
  CircleCheck,
  Play,
  Code,
  FingerprintPattern,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { TranslationKey } from '@/i18n/types.generated';

interface SmartJsonDisplayProps {
    data: Record<string, unknown> | null | undefined;
    className?: string;
}

interface KeyIcon {
    icon: LucideIcon;
    className: string;
    /** Tooltip, translated at render time. */
    titleKey: TranslationKey;
}

// Icon mapping for common keys
const KEY_ICONS: Record<string, KeyIcon> = {
    path: { icon: FileText, className: "text-tool-file", titleKey: "smartJsonDisplay.keys.path" },
    file_path: { icon: FileText, className: "text-tool-file", titleKey: "smartJsonDisplay.keys.filePath" },
    filename: { icon: FileText, className: "text-tool-file", titleKey: "smartJsonDisplay.keys.filename" },
    command: { icon: SquareTerminal, className: "text-tool-terminal", titleKey: "smartJsonDisplay.keys.command" },
    cmd: { icon: SquareTerminal, className: "text-tool-terminal", titleKey: "smartJsonDisplay.keys.command" },
    query: { icon: Search, className: "text-tool-search", titleKey: "smartJsonDisplay.keys.query" },
    id: { icon: Hash, className: "text-purple-600 dark:text-purple-400", titleKey: "smartJsonDisplay.keys.id" },
    task_id: { icon: Hash, className: "text-tool-task", titleKey: "smartJsonDisplay.keys.taskId" },
    uuid: { icon: FingerprintPattern, className: "text-purple-600 dark:text-purple-400", titleKey: "smartJsonDisplay.keys.uuid" },
    list: { icon: List, className: "text-info", titleKey: "smartJsonDisplay.keys.list" },
    prompt: { icon: MessageSquare, className: "text-muted-foreground", titleKey: "smartJsonDisplay.keys.prompt" },
    description: { icon: MessageSquare, className: "text-muted-foreground", titleKey: "smartJsonDisplay.keys.description" },
    error: { icon: CircleAlert, className: "text-destructive", titleKey: "smartJsonDisplay.keys.error" },
    status: { icon: CircleCheck, className: "text-success", titleKey: "smartJsonDisplay.keys.status" },
    code: { icon: Code, className: "text-tool-code", titleKey: "smartJsonDisplay.keys.code" },
    allowed_tools: { icon: Play, className: "text-tool-task", titleKey: "smartJsonDisplay.keys.allowedTools" },
};

const formatValue = (key: string, value: unknown): React.ReactNode => {
    if (value === null || value === undefined) return <span className="text-muted-foreground italic">null</span>;

    // Arrays (like allowed_tools) - render as tags
    if (Array.isArray(value)) {
        return (
            <div className="flex flex-wrap gap-1 mt-0.5">
                {value.map((v, i) => (
                    <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 text-caption text-foreground font-mono">
                        {String(v)}
                    </span>
                ))}
            </div>
        );
    }

    // Long text (description, prompt) - render normally with limited lines if needed
    if (typeof value === 'string') {
        if (key === 'description' || key === 'prompt' || key === 'summary') {
            return <div className="text-foreground/80 whitespace-pre-wrap leading-relaxed mt-0.5">{value}</div>;
        }
        // Short strings - syntax highlight slightly
        return <span className="text-emerald-600 dark:text-emerald-400 font-mono break-all">"{value}"</span>;
    }

    if (typeof value === 'number') return <span className="text-blue-600 dark:text-blue-400 font-mono">{value}</span>;
    if (typeof value === 'boolean') return <span className="text-purple-600 dark:text-purple-400 font-bold font-mono">{String(value)}</span>;

    // Nested objects - simple recursive flatten or generic json
    if (typeof value === 'object') {
        return <span className="text-muted-foreground font-mono">{JSON.stringify(value).slice(0, 50)}{JSON.stringify(value).length > 50 ? '...' : ''}</span>;
    }

    return String(value);
};

export const SmartJsonDisplay = ({ data, className }: SmartJsonDisplayProps) => {
    const { t } = useTranslation();

    if (!data || typeof data !== 'object') {
        return <div className="text-muted-foreground italic">{t('smartJsonDisplay.noData')}</div>;
    }

    // Prioritize keys: description/prompt first, then specific params, then others
    const keys = Object.keys(data);
    const priorityKeys = ['description', 'prompt', 'task'];
    const paramKeys = ['path', 'file_path', 'command', 'query', 'allowed_tools', 'task_id'];

    const sortedKeys = keys.sort((a, b) => {
        const aPrio = priorityKeys.indexOf(a);
        const bPrio = priorityKeys.indexOf(b);
        if (aPrio !== -1 && bPrio !== -1) return aPrio - bPrio;
        if (aPrio !== -1) return -1;
        if (bPrio !== -1) return 1;

        const aParam = paramKeys.indexOf(a);
        const bParam = paramKeys.indexOf(b);
        if (aParam !== -1 && bParam !== -1) return aParam - bParam;
        if (aParam !== -1) return -1;
        if (bParam !== -1) return 1;

        return a.localeCompare(b);
    });

    return (
        <div className={clsx("text-list flex flex-col gap-2", className)}>
            {sortedKeys.map(key => {
                const keyIcon = KEY_ICONS[key.toLowerCase()];
                const icon = keyIcon
                    ? <span title={t(keyIcon.titleKey)}><keyIcon.icon className={clsx("w-3.5 h-3.5", keyIcon.className)} /></span>
                    : <div className="w-3 h-3 opacity-20 bg-current rounded-full" />; // Dot fallback
                const value = (data as Record<string, unknown>)[key];

                // Special layout for 'description' or 'prompt' - full width block
                if (['description', 'prompt', 'task'].includes(key) && typeof value === 'string') {
                    return (
                        <div key={key} className="flex flex-col gap-1 pb-1 border-b border-border/10 last:border-0">
                            <div className="flex items-center gap-1.5 text-muted-foreground uppercase text-caption font-bold tracking-wider opacity-70">
                                {icon}
                                <span>{key.replace(/_/g, ' ')}</span>
                            </div>
                            <div className="pl-4 border-l-2 border-border/20 ml-1.5">
                                {formatValue(key, value)}
                            </div>
                        </div>
                    );
                }

                return (
                    <div key={key} className="flex gap-2 items-start group">
                        <div className="flex items-center gap-1.5 min-w-[100px] shrink-0 pt-0.5 select-none" title={key}>
                            {icon}
                            <span className="text-muted-foreground/80 font-medium group-hover:text-foreground transition-colors truncate">
                                {key.replace(/_/g, ' ')}
                            </span>
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                            {formatValue(key, value)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
