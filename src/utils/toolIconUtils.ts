import { TOOL_VARIANTS, type RendererVariant } from "@/components/renderers/types";

/**
 * Get tool variant from tool name.
 * Delegates to the canonical TOOL_VARIANTS map first (exact match),
 * then falls back to fuzzy matching for unknown/MCP tool names.
 */
export const getToolVariant = (name: string): RendererVariant => {
    // Canonical exact match (covers all known Claude Code tools)
    if (name in TOOL_VARIANTS) {
        return TOOL_VARIANTS[name] as RendererVariant;
    }

    // Fuzzy fallback for unknown tools (MCP plugins, custom tools, legacy names)
    const lower = name.toLowerCase();

    // Helper to check if a keyword matches (underscore-separated OR PascalCase OR word boundary)
    const matches = (keyword: string) => {
        const pattern = new RegExp(`(^|_)${keyword}($|_)`, 'i');
        const pascalPattern = new RegExp(`(^|[A-Z])${keyword}`, 'i');
        return pattern.test(name) || pascalPattern.test(name);
    };

    // Use word boundaries treating underscores/PascalCase as separators to avoid false positives
    if (matches('read') || matches('write') || matches('edit') || matches('lsp') || matches('notebook') || matches('replace')) {
        return "code";
    }
    if (matches('grep') || matches('search')) {
        return "search";
    }
    if (matches('glob') || matches('ls') || matches('create') || lower === "file") {
        return "file";
    }
    if (matches('task') || matches('todo') || matches('agent')) {
        return "task";
    }
    if (matches('bash') || matches('command') || matches('shell') || matches('kill')) {
        return "terminal";
    }
    if (matches('git')) {
        return "git";
    }
    if (matches('web') || matches('fetch') || matches('http')) {
        return "web";
    }
    if (matches('mcp') || matches('server')) {
        return "mcp";
    }
    if (matches('document') || matches('pdf')) {
        return "document";
    }

    return "neutral";
};
