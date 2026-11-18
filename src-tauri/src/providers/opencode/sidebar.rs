//! Sidebar projection of the same store hierarchy used by token statistics.
use super::{
    epoch_ms_to_rfc3339, global_directory_project_id, load_sessions_at, open_db,
    opencode_project_display_name, OpenCodeProjectRef, SessionTree, StoreSchema,
    OPENCODE_GLOBAL_DIRECTORY_PREFIX, OPENCODE_GLOBAL_PROJECT_ID,
};
use crate::models::{ClaudeProject, ClaudeSession};
use rusqlite::Connection;
use serde::Serialize;
use std::{collections::HashMap, ops::Deref};

#[derive(Serialize)]
pub struct ListedProject {
    #[serde(flatten)]
    pub project: ClaudeProject,
    #[serde(skip_serializing_if = "is_zero")]
    pub subagent_count: usize,
}

#[allow(clippy::trivially_copy_pass_by_ref)] // Serde's skip predicate takes a reference.
fn is_zero(value: &usize) -> bool {
    *value == 0
}

impl From<ClaudeProject> for ListedProject {
    fn from(project: ClaudeProject) -> Self {
        Self {
            project,
            subagent_count: 0,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ListedSession {
    #[serde(flatten)]
    pub session: ClaudeSession,
    /// The unique (provider-qualified) session id, not the transcript path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
}

impl From<ClaudeSession> for ListedSession {
    fn from(session: ClaudeSession) -> Self {
        Self {
            session,
            parent_session_id: None,
        }
    }
}

impl Deref for ListedSession {
    type Target = ClaudeSession;

    fn deref(&self) -> &ClaudeSession {
        &self.session
    }
}

type Links = Vec<(String, Option<String>)>;

#[derive(Default)]
struct DirectorySummary {
    sessions: usize,
    runs: usize,
    activity: u64,
    display_name: String,
}

struct Placement {
    root: usize,
    activity: u64,
}

pub(super) struct ProjectGroup {
    tree: SessionTree,
    placements: HashMap<String, Placement>,
    directories: Vec<String>,
    directory_summaries: HashMap<String, DirectorySummary>,
    run_count: usize,
}

impl ProjectGroup {
    fn new(
        links: Links,
        mut details: HashMap<String, (String, u64)>,
        split_directories: bool,
    ) -> Self {
        let tree = SessionTree::from_links(&links);
        let mut placements = HashMap::with_capacity(links.len());
        let mut directories = Vec::new();
        let mut directory_summaries = HashMap::<String, DirectorySummary>::new();
        let mut run_count = 0;
        // Iterative pre/post-order traversal: the root decides ownership,
        // and activity propagates from each descendant to its ancestors.
        let mut pending = Vec::new();
        for (root_id, _) in &links {
            let root_id = root_id.as_str();
            if tree.parent(root_id).is_some() {
                continue;
            }
            let root = directories.len();
            if split_directories {
                directories.push(global_directory_project_id(&details[root_id].0));
                let summary = directory_summaries
                    .entry(directories[root].clone())
                    .or_default();
                if summary.sessions == 0 {
                    summary.display_name = opencode_project_display_name(None, &details[root_id].0);
                }
            }
            let mut runs = 0;
            pending.push((root_id, false));
            while let Some((id, visited)) = pending.pop() {
                if visited {
                    let (_, own_activity) = details.remove(id).expect("session has details");
                    let activity = tree.children(id).fold(own_activity, |latest, child| {
                        let placement: &Placement = &placements[child];
                        latest.max(placement.activity)
                    });
                    placements.insert(id.to_owned(), Placement { root, activity });
                } else {
                    pending.push((id, true));
                    pending.extend(tree.children(id).map(|child| (child, false)));
                    runs += usize::from(id != root_id);
                }
            }
            run_count += runs;
            if let Some(directory) = directories.get(root) {
                let summary = directory_summaries.entry(directory.clone()).or_default();
                summary.sessions += 1;
                summary.runs += runs;
                summary.activity = summary.activity.max(placements[root_id].activity);
            }
        }
        Self {
            tree,
            placements,
            directories,
            directory_summaries,
            run_count,
        }
    }

    pub(super) fn directory_project(&self, session_id: &str) -> Option<&str> {
        let root = self.placements.get(session_id)?.root;
        self.directories.get(root).map(String::as_str)
    }
}

pub(super) fn load_groups(
    conn: &Connection,
    schema: StoreSchema,
    project_id: Option<&str>,
) -> HashMap<String, ProjectGroup> {
    let Some(sessions) = schema.sessions_sql() else {
        return HashMap::new();
    };
    let filter = if project_id.is_some() {
        "WHERE project_id = ?1"
    } else {
        ""
    };
    let Ok(mut stmt) = conn.prepare(&format!(
        "SELECT project_id, id, parent_id, directory, time_updated FROM ({sessions})
         {filter} ORDER BY time_created, id"
    )) else {
        return HashMap::new();
    };
    let params = rusqlite::params_from_iter(project_id);
    let Ok(rows) = stmt.query_map(params, |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
        ))
    }) else {
        return HashMap::new();
    };
    let mut projects = HashMap::<String, (Links, HashMap<String, (String, u64)>)>::new();
    for (project, id, parent, directory, activity) in rows.flatten() {
        let (links, details) = projects.entry(project).or_default();
        details.insert(id.clone(), (directory, activity));
        links.push((id, parent));
    }
    projects
        .into_iter()
        .map(|(id, (links, details))| {
            let group = ProjectGroup::new(links, details, id == OPENCODE_GLOBAL_PROJECT_ID);
            (id, group)
        })
        .collect()
}

fn groups_at(base: &str, db_file: &str, project_id: Option<&str>) -> HashMap<String, ProjectGroup> {
    let Some(conn) = open_db(base, db_file) else {
        return HashMap::new();
    };
    StoreSchema::read(&conn).map_or_else(
        |_| HashMap::new(),
        |schema| load_groups(&conn, schema, project_id),
    )
}

pub(crate) fn group_projects(
    base: &str,
    db_file: &str,
    projects: Vec<ClaudeProject>,
) -> Vec<ListedProject> {
    let groups = groups_at(base, db_file, None);
    projects
        .into_iter()
        .map(|mut project| {
            // Kilo has the same storage ids as OpenCode.
            let id = project.path.split_once("://").map_or("", |(_, id)| id);
            let mut subagent_count = 0;
            if let Some(hash) = id.strip_prefix(OPENCODE_GLOBAL_DIRECTORY_PREFIX) {
                if super::is_safe_global_directory_hash(hash) {
                    if let Some(group) = groups.get(OPENCODE_GLOBAL_PROJECT_ID) {
                        let summary = group.directory_summaries.get(id);
                        project.session_count = summary.map_or(0, |summary| summary.sessions);
                        if let Some(summary) = summary {
                            subagent_count = summary.runs;
                            project.last_modified = epoch_ms_to_rfc3339(summary.activity);
                        }
                    }
                }
            } else if let Some(group) = groups.get(id) {
                subagent_count = group.run_count;
                project.session_count = project.session_count.saturating_sub(subagent_count);
            }
            ListedProject {
                project,
                subagent_count,
            }
        })
        .collect()
}

pub(crate) fn load_listed_sessions_at(
    base: &str,
    db_file: &str,
    project_path: &str,
) -> Result<Vec<ListedSession>, String> {
    let project_ref = OpenCodeProjectRef::parse(project_path)?;
    let storage_id = project_ref.storage_id();
    let groups = groups_at(base, db_file, Some(storage_id));
    let group = groups.get(storage_id);
    let virtual_id = project_path.strip_prefix("opencode://");
    // Load the store project so a child whose cwd differed from its parent
    // still comes back in the parent's virtual directory project.
    let store_path = (project_ref.is_virtual_global_directory() && group.is_some())
        .then(|| format!("opencode://{storage_id}"));
    let sessions = load_sessions_at(
        base,
        db_file,
        store_path.as_deref().unwrap_or(project_path),
        false,
    )?;
    Ok(sessions
        .into_iter()
        .filter_map(|mut session| {
            let placement = group.and_then(|group| {
                group
                    .placements
                    .get(&session.actual_session_id)
                    .map(|p| (p, group))
            });
            if let Some(virtual_id) =
                virtual_id.filter(|_| project_ref.is_virtual_global_directory() && group.is_some())
            {
                let (_, group) = placement?;
                if group.directory_project(&session.actual_session_id) != Some(virtual_id) {
                    return None;
                }
                session
                    .project_name
                    .clone_from(&group.directory_summaries[virtual_id].display_name);
            }
            let parent_session_id = placement.and_then(|(placement, group)| {
                session.last_modified = epoch_ms_to_rfc3339(placement.activity);
                group
                    .tree
                    .parent(&session.actual_session_id)
                    .map(|parent| format!("opencode://{parent}"))
            });
            Some(ListedSession {
                session,
                parent_session_id,
            })
        })
        .collect())
}

/// Offsets count roots, never child rows. An optional anchored branch is
/// included even outside the page; it does not advance the page cursor.
pub(crate) fn page(
    mut sessions: Vec<ListedSession>,
    offset: usize,
    limit: usize,
    anchor_path: Option<&str>,
) -> crate::commands::session::SessionPage<ListedSession> {
    let listing_size = sessions.len();
    sessions.sort_unstable_by(|a, b| {
        b.last_modified
            .cmp(&a.last_modified)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    let anchor_root = anchor_path.and_then(|path| {
        let anchored = sessions.iter().find(|row| row.file_path == path)?;
        let parents: HashMap<_, _> = sessions
            .iter()
            .filter_map(|row| Some((row.session_id.as_str(), row.parent_session_id.as_deref()?)))
            .collect();
        let mut root = anchored.session_id.as_str();
        while let Some(parent) = parents.get(root) {
            root = parent;
        }
        Some(root.to_owned())
    });
    let mut roots = Vec::new();
    let mut children = HashMap::<String, Vec<ListedSession>>::new();
    for row in sessions {
        if let Some(parent) = &row.parent_session_id {
            children.entry(parent.clone()).or_default().push(row);
        } else {
            roots.push(row);
        }
    }
    let total = roots.len();
    let next_offset = offset.saturating_add(limit.min(total.saturating_sub(offset)));
    let mut sessions = Vec::new();
    let mut pending = Vec::new();
    for (index, root) in roots.into_iter().enumerate() {
        if (offset..next_offset).contains(&index) || anchor_root.as_ref() == Some(&root.session_id)
        {
            pending.push(root);
            while let Some(row) = pending.pop() {
                if let Some(runs) = children.remove(&row.session_id) {
                    pending.extend(runs.into_iter().rev());
                }
                sessions.push(row);
            }
        }
    }
    crate::commands::session::SessionPage {
        sessions,
        total,
        subagent_count: Some(listing_size - total),
        offset,
        limit,
        next_offset,
        has_more: next_offset < total,
    }
}
