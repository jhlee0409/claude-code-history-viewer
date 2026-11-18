import type { ClaudeSession } from "@/types";

export const usesSessionBranches = (provider?: string) =>
  provider === "opencode" || provider === "kilo";

export const newestSessionFirst = (a: ClaudeSession, b: ClaudeSession) =>
  Date.parse(b.last_modified) - Date.parse(a.last_modified);

interface BranchIndex {
  byId: Map<string, ClaudeSession>;
  children: Map<string, ClaudeSession[]>;
  roots: ClaudeSession[];
}

/** Sessions remain flat in the store. Only the sidebar projects the forest. */
export function indexSessionBranches(sessions: readonly ClaudeSession[]): BranchIndex {
  const byId = new Map(sessions.map((session) => [session.session_id, session]));
  const children = new Map<string, ClaudeSession[]>();
  const roots: ClaudeSession[] = [];
  for (const session of sessions) {
    const parent = session.parent_session_id;
    if (!parent || !byId.has(parent)) {
      roots.push(session);
    } else {
      const siblings = children.get(parent);
      if (siblings) siblings.push(session);
      else children.set(parent, [session]);
    }
  }
  return { byId, roots, children };
}
export function ancestorIds(byId: ReadonlyMap<string, ClaudeSession>, id: string): string[] {
  const ancestors: string[] = [];
  let parent = byId.get(id)?.parent_session_id;
  while (parent && byId.has(parent)) {
    ancestors.push(parent);
    parent = byId.get(parent)?.parent_session_id;
  }
  return ancestors;
}

export interface SessionBranchRow {
  session: ClaudeSession;
  depth: number;
  runCount: number;
  expanded: boolean;
}

/** `matchingIds` keeps only matching rows and the ancestor paths to reach them. */
export function sessionBranchRows(
  tree: BranchIndex,
  roots: readonly ClaudeSession[],
  expandedIds: ReadonlySet<string>,
  matchingIds?: ReadonlySet<string>,
): SessionBranchRow[] {
  const included = matchingIds ? new Set(matchingIds) : undefined;
  const reveal = new Set<string>();
  for (const id of matchingIds ?? []) {
    for (const parent of ancestorIds(tree.byId, id)) {
      included?.add(parent);
      reveal.add(parent);
    }
  }
  const rows: SessionBranchRow[] = [];
  const pending = roots.slice().reverse().map((session) => ({ session, depth: 0 }));
  while (pending.length > 0) {
    const { session, depth } = pending.pop()!;
    if (included && !included.has(session.session_id)) continue;
    const children = tree.children.get(session.session_id);
    const expanded = expandedIds.has(session.session_id) || reveal.has(session.session_id);
    const visibleChildren = included ? children?.filter((child) => included.has(child.session_id)) : children;
    rows.push({ session, depth, runCount: visibleChildren?.length ?? 0, expanded });
    if (expanded && visibleChildren) {
      for (let i = visibleChildren.length - 1; i >= 0; i--) {
        pending.push({ session: visibleChildren[i]!, depth: depth + 1 });
      }
    }
  }
  return rows;
}
