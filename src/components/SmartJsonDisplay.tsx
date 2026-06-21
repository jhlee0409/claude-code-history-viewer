import React from 'react';
import {
    Terminal, FileText, Search, Hash,
    List, MessageSquare, AlertCircle,
    CheckCircle2, Play, Code, Fingerprint
} from 'lucide-react';
import { clsx } from 'clsx';

interface SmartJsonDisplayProps {
    data: Record<string, unknown> | null | undefined;
    className?: string;
}

// Icon mapping for common keys
const KEY_ICONS: Record<string, React.ReactNode> = {
    path: <span title="Path"><FileText className="w-3 h-3 text-emerald-500" /></span>,
    file_path: <span title="File Path"><FileText className="w-3 h-3 text-emerald-500" /></span>,
    filename: <span title="Filename"><FileText className="w-3 h-3 text-emerald-500" /></span>,
    command: <span title="Command"><Terminal className="w-3 h-3 text-sky-500" /></span>,
    cmd: <span title="Command"><Terminal className="w-3 h-3 text-sky-500" /></span>,
    query: <span title="Query"><Search className="w-3 h-3 text-amber-500" /></span>,
    id: <span title="ID"><Hash className="w-3 h-3 text-purple-500" /></span>,
    task_id: <span title="Task ID"><Hash className="w-3 h-3 text-purple-500" /></span>,
    uuid: <span title="UUID"><Fingerprint className="w-3 h-3 text-purple-500" /></span>,
    list: <span title="List"><List className="w-3 h-3 text-blue-500" /></span>,
    prompt: <span title="Prompt"><MessageSquare className="w-3 h-3 text-slate-500" /></span>,
    description: <span title="Description"><MessageSquare className="w-3 h-3 text-slate-500" /></span>,
    error: <span title="Error"><AlertCircle className="w-3 h-3 text-red-500" /></span>,
    status: <span title="Status"><CheckCircle2 className="w-3 h-3 text-green-500" /></span>,
    code: <span title="Code"><Code className="w-3 h-3 text-pink-500" /></span>,
    allowed_tools: <span title="Allowed Tools"><Play className="w-3 h-3 text-orange-500" /></span>
};

const formatValue = (key: string, value: unknown): React.ReactNode => {
    if (value === null || value === undefined) return <span className="text-muted-foreground italic">null</span>;

    // Arrays (like allowed_tools) - render as tags
    if (Array.isArray(value)) {
        return (
            <div className="flex flex-wrap gap-1 mt-0.5">
                {value.map((v, i) => (
                    <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 text-px10 text-foreground font-mono">
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
    if (!data || typeof data !== 'object') {
        return <div className="text-muted-foreground italic">No structured data</div>;
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
        <div className={clsx("text-xs flex flex-col gap-2", className)}>
            {sortedKeys.map(key => {
                const icon = KEY_ICONS[key.toLowerCase()] || <div className="w-3 h-3 opacity-20 bg-current rounded-full" />; // Dot fallback
                const value = (data as Record<string, unknown>)[key];

                // Special layout for 'description' or 'prompt' - full width block
                if (['description', 'prompt', 'task'].includes(key) && typeof value === 'string') {
                    return (
                        <div key={key} className="flex flex-col gap-1 pb-1 border-b border-border/10 last:border-0">
                            <div className="flex items-center gap-1.5 text-muted-foreground uppercase text-px10 font-bold tracking-wider opacity-70">
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
