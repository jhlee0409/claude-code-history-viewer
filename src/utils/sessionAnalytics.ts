import type { ClaudeMessage } from "../types";

export interface SessionStats {
    fileEditCount: number;
    shellCount: number;
    commitCount: number;
    errorCount: number;
    filesTouched: Set<string>;
    hasMarkdownEdits: boolean; // New Flag
    toolBreakdown: Record<string, number>;
}

export function analyzeSessionMessages(messages: ClaudeMessage[]): SessionStats {
    const stats: SessionStats = {
        fileEditCount: 0,
        shellCount: 0,
        commitCount: 0,
        errorCount: 0,
        filesTouched: new Set(),
        hasMarkdownEdits: false,
        toolBreakdown: {}
    };

    messages.forEach(msg => {
        // 1. Check for Errors
        let isError = false;

        if (msg.type === 'system' && msg.stopReasonSystem?.toLowerCase().includes("error")) {
            isError = true;
        }

        if (msg.type === 'user' && msg.toolUseResult) {
            const result = msg.toolUseResult as any;
            if (result.is_error === true || (typeof result.stderr === 'string' && result.stderr.trim().length > 0)) {
                isError = true;
            }
        }

        if (isError) {
            stats.errorCount++;
        }

        // 2. Scan Tool Usage
        if (msg.type === 'assistant' && msg.toolUse) {
            const tool = msg.toolUse as any;
            const name = tool.name;
            const input = tool.input || {};

            // Track tool name in breakdown
            stats.toolBreakdown[name] = (stats.toolBreakdown[name] || 0) + 1;

            // Detect File Edits
            // Broaden detection to catch multi_replace, atomic writes, etc.
            if (['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file', 'edit_file', 'Edit', 'Replace'].includes(name) || /write|edit|replace|patch/i.test(name)) {
                stats.fileEditCount++;

                const path = input.path || input.file_path || input.TargetFile || input.key;
                if (typeof path === 'string' && path.trim().length > 0) {
                    stats.filesTouched.add(path);

                    if (path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.markdown')) {
                        stats.hasMarkdownEdits = true;
                    }
                }
            }

            // Detect Shell Commands
            if (['run_command', 'bash', 'execute_command'].includes(name)) {
                stats.shellCount++;

                const cmd = input.CommandLine || input.command;
                if (typeof cmd === 'string' && cmd.trim().startsWith('git commit')) {
                    stats.commitCount++;
                }
            }
        }
    });

    return stats;
}
