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

    if (lower.includes("read") || lower.includes("write") || lower.includes("edit") || lower.includes("lsp") || lower.includes("notebook") || lower.includes("replace")) {
        return "code";
    }
    if (lower.includes("grep") || lower.includes("search")) {
        return "search";
    }
    if (lower.includes("glob") || lower.includes("ls") || lower === "file" || lower.includes("create")) {
        return "file";
    }
    if (lower.includes("task") || lower.includes("todo") || lower.includes("agent")) {
        return "task";
    }
    if (lower.includes("bash") || lower.includes("command") || lower.includes("shell") || lower.includes("kill")) {
        return "terminal";
    }
    if (lower.includes("git")) {
        return "git";
    }
    if (lower.includes("web") || lower.includes("fetch") || lower.includes("http")) {
        return "web";
    }
    if (lower.includes("mcp") || lower.includes("server")) {
        return "mcp";
    }
    if (lower.includes("document") || lower.includes("pdf")) {
        return "document";
    }

    return "neutral";
};
