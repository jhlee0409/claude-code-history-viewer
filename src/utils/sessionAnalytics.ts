import type { ClaudeMessage } from "../types";

export interface SessionStats {
    fileEditCount: number;
    commitCount: number;
    errorCount: number;
    filesTouched: Set<string>;
}

export function analyzeSessionMessages(messages: ClaudeMessage[]): SessionStats {
    const stats: SessionStats = {
        fileEditCount: 0,
        commitCount: 0,
        errorCount: 0,
        filesTouched: new Set()
    };

    messages.forEach(msg => {
        // 1. Check for Errors (System stops, tool errors, stderr)
        let isError = false;

        // System stop reasons often indicate failures
        if (msg.stopReasonSystem?.toLowerCase().includes("error")) {
            isError = true;
        }

        // Check tool results for error flags or stderr output
        if (msg.toolUseResult) {
            const result = msg.toolUseResult as any;
            if (result.is_error === true || (typeof result.stderr === 'string' && result.stderr.trim().length > 0)) {
                isError = true;
            }
        }

        if (isError) {
            stats.errorCount++;
        }

        // 2. Scan Tool Usage
        if (msg.toolUse) {
            const tool = msg.toolUse as any;
            const name = tool.name;
            const input = tool.input || {};

            // Detect File Edits
            // Common MCP tool names for file manipulation
            if (['write_to_file', 'replace_file_content', 'create_file', 'edit_file', 'Edit', 'Replace'].includes(name)) {
                stats.fileEditCount++;

                // Extract file path from various possible input fields
                const path = input.path || input.file_path || input.TargetFile || input.key; // 'key' sometimes used in other contexts
                if (typeof path === 'string' && path.trim().length > 0) {
                    stats.filesTouched.add(path);
                }
            }

            // Detect Commits (via run_command or bash)
            // Check for git commit execution
            if (['run_command', 'bash', 'execute_command'].includes(name)) { // Covering variations
                const cmd = input.CommandLine || input.command;
                if (typeof cmd === 'string' && cmd.trim().startsWith('git commit')) {
                    stats.commitCount++;
                }
            }
        }
    });

    return stats;
}
