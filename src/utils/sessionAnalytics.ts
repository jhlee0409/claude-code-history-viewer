import { isClaudeAssistantMessage, isClaudeUserMessage } from "./messageUtils";
import type { ClaudeMessage } from "../types";

import { getToolVariant } from "@/utils/toolIconUtils";

export interface SessionStats {
    fileEditCount: number;
    shellCount: number;
    commitCount: number;
    errorCount: number;
    filesTouched: Set<string>;
    hasMarkdownEdits: boolean; // New Flag
    markdownEditCount: number;
    toolBreakdown: Record<string, number>;
    searchCount: number;
    webCount: number;
    mcpCount: number;
    fileToolCount: number;
    codeReadCount: number;
    gitToolCount: number;
}

export function analyzeSessionMessages(messages: ClaudeMessage[]): SessionStats {
    const stats: SessionStats = {
        fileEditCount: 0,
        shellCount: 0,
        commitCount: 0,
        errorCount: 0,
        filesTouched: new Set(),
        hasMarkdownEdits: false,
        markdownEditCount: 0,
        toolBreakdown: {},
        searchCount: 0,
        webCount: 0,
        mcpCount: 0,
        fileToolCount: 0,
        codeReadCount: 0,
        gitToolCount: 0
    };

    messages.forEach(msg => {
        // 1. Check for Errors
        let isError = false;

        if (msg.type === 'system' && msg.stopReasonSystem?.toLowerCase().includes("error")) {
            isError = true;
        }

        if (isClaudeUserMessage(msg) && msg.toolUseResult) {
            const result = msg.toolUseResult;
            if (typeof result === 'object' && result !== null) {
                const res = result as Record<string, unknown>;
                if (res.is_error === true || (typeof res.stderr === 'string' && res.stderr.trim().length > 0)) {
                    isError = true;
                }
            }
        }

        if (isError) {
            stats.errorCount++;
        }

        // 2. Scan Tool Usage
        if (isClaudeAssistantMessage(msg) && msg.toolUse) {
            const tool = msg.toolUse;
            const name = (tool.name as string) || "";
            const input = (tool.input as Record<string, unknown>) || {};

            // Track tool name in breakdown
            stats.toolBreakdown[name] = (stats.toolBreakdown[name] || 0) + 1;

            // Use shared categorization logic to ensure alignment with visuals
            const variant = getToolVariant(name);

            // 1. Terminal / Shell
            if (variant === 'terminal') {
                const cmd = input.CommandLine || input.command;
                const isGitCmd = typeof cmd === 'string' && cmd.trim().startsWith('git');

                if (isGitCmd) {
                    stats.gitToolCount++;
                    if (cmd.trim().includes('git commit')) {
                        stats.commitCount++;
                    }
                } else {
                    stats.shellCount++;
                }
            }

            // 2. Search (Strictly matches 'search' variant)
            if (variant === 'search') {
                stats.searchCount++;
            }

            // 3. Web
            if (variant === 'web') {
                stats.webCount++;
            }

            // 4. MCP
            if (variant === 'mcp') {
                stats.mcpCount++;
            }

            // 5. Git Tools (status, diff, etc - excludes generic shell commands unless tool name includes git)
            if (variant === 'git') {
                stats.gitToolCount++;
            }

            // 6. File Tools (ls, glob, create)
            if (variant === 'file') {
                stats.fileToolCount++;
            }

            // 7. File Usage (Reads fall into 'code', but here we specifically want to track EDITS for the stat)
            // We verify specific edit tools manually because 'fileEditCount' is specifically about mutations, 
            // whereas the 'code' variant includes non-mutating Reads.

            // Detect File Edits
            const isEdit = ['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file', 'edit_file', 'Edit', 'Replace'].includes(name) || /write|edit|replace|patch/i.test(name);

            if (isEdit) {
                stats.fileEditCount++;

                const path = input.path || input.file_path || input.TargetFile || input.key;
                if (typeof path === 'string' && path.trim().length > 0) {
                    stats.filesTouched.add(path);

                    // Markdown edit tracking
                    if (path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.markdown')) {
                        stats.hasMarkdownEdits = true;
                        stats.markdownEditCount++;
                    }
                }
            } else if (variant === 'code') {
                // If it's classified as 'code' but NOT an edit, it's a Read
                stats.codeReadCount++;
            }
        }
    });

    return stats;
}
