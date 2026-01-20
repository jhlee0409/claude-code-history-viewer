use crate::models::*;
use crate::commands::session::load_session_messages;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use walkdir::WalkDir;
use chrono::{DateTime, Datelike, Timelike, Utc};

fn extract_token_usage(message: &ClaudeMessage) -> TokenUsage {
    if let Some(usage) = &message.usage {
        return usage.clone();
    }
    
    let mut usage = TokenUsage {
        input_tokens: None,
        output_tokens: None,
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        service_tier: None,
    };

    if let Some(content) = &message.content {
        let usage_obj = if content.is_object() && content.get("usage").is_some() {
            content.get("usage")
        } else {
            None
        };
        
        if let Some(usage_obj) = usage_obj {
            if let Some(input) = usage_obj.get("input_tokens").and_then(|v| v.as_u64()) {
                usage.input_tokens = Some(input as u32);
            }
            if let Some(output) = usage_obj.get("output_tokens").and_then(|v| v.as_u64()) {
                usage.output_tokens = Some(output as u32);
            }
            if let Some(tier) = usage_obj.get("service_tier").and_then(|v| v.as_str()) {
                usage.service_tier = Some(tier.to_string());
            }
            if let Some(cache_creation) = usage_obj.get("cache_creation_input_tokens").and_then(|v| v.as_u64()) {
                usage.cache_creation_input_tokens = Some(cache_creation as u32);
            }
            if let Some(cache_read) = usage_obj.get("cache_read_input_tokens").and_then(|v| v.as_u64()) {
                usage.cache_read_input_tokens = Some(cache_read as u32);
            }
        }
    }

    if let Some(tool_result) = &message.tool_use_result {
        if let Some(usage_obj) = tool_result.get("usage") {
            if let Some(input) = usage_obj.get("input_tokens").and_then(|v| v.as_u64()) {
                usage.input_tokens = Some(input as u32);
            }
            if let Some(output) = usage_obj.get("output_tokens").and_then(|v| v.as_u64()) {
                usage.output_tokens = Some(output as u32);
            }
            if let Some(cache_creation) = usage_obj.get("cache_creation_input_tokens").and_then(|v| v.as_u64()) {
                usage.cache_creation_input_tokens = Some(cache_creation as u32);
            }
            if let Some(cache_read) = usage_obj.get("cache_read_input_tokens").and_then(|v| v.as_u64()) {
                usage.cache_read_input_tokens = Some(cache_read as u32);
            }
        }

        if let Some(total_tokens) = tool_result.get("totalTokens").and_then(|v| v.as_u64()) {
            if usage.input_tokens.is_none() && usage.output_tokens.is_none() {
                if message.message_type == "assistant" {
                    usage.output_tokens = Some(total_tokens as u32);
                } else {
                    usage.input_tokens = Some(total_tokens as u32);
                }
            }
        }
    }

    usage
}

#[tauri::command]
pub async fn get_session_token_stats(session_path: String) -> Result<SessionTokenStats, String> {
    let messages = load_session_messages(session_path.clone()).await?;

    if messages.is_empty() {
        return Err("No valid messages found in session".to_string());
    }

    let session_id = messages[0].session_id.clone();
    let project_name = PathBuf::from(&session_path)
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let mut total_input_tokens = 0u32;
    let mut total_output_tokens = 0u32;
    let mut total_cache_creation_tokens = 0u32;
    let mut total_cache_read_tokens = 0u32;

    let mut first_time: Option<String> = None;
    let mut last_time: Option<String> = None;

    for message in &messages {
        let usage = extract_token_usage(message);

        total_input_tokens += usage.input_tokens.unwrap_or(0);
        total_output_tokens += usage.output_tokens.unwrap_or(0);
        total_cache_creation_tokens += usage.cache_creation_input_tokens.unwrap_or(0);
        total_cache_read_tokens += usage.cache_read_input_tokens.unwrap_or(0);

        if first_time.is_none() || message.timestamp < first_time.as_ref().unwrap().clone() {
            first_time = Some(message.timestamp.clone());
        }
        if last_time.is_none() || message.timestamp > last_time.as_ref().unwrap().clone() {
            last_time = Some(message.timestamp.clone());
        }
    }

    let total_tokens = total_input_tokens + total_output_tokens + total_cache_creation_tokens + total_cache_read_tokens;

    Ok(SessionTokenStats {
        session_id,
        project_name,
        total_input_tokens,
        total_output_tokens,
        total_cache_creation_tokens,
        total_cache_read_tokens,
        total_tokens,
        message_count: messages.len(),
        first_message_time: first_time.unwrap_or_else(|| "unknown".to_string()),
        last_message_time: last_time.unwrap_or_else(|| "unknown".to_string()),
    })
}

#[tauri::command]
pub async fn get_project_token_stats(project_path: String) -> Result<Vec<SessionTokenStats>, String> {
    let mut session_stats = Vec::new();

    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        let session_path = entry.path().to_string_lossy().to_string();

        match get_session_token_stats(session_path).await {
            Ok(stats) => session_stats.push(stats),
            Err(_) => continue, 
        }
    }

    session_stats.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    Ok(session_stats)
}

#[tauri::command]
pub async fn get_project_stats_summary(project_path: String) -> Result<ProjectStatsSummary, String> {
    let project_name = PathBuf::from(&project_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut summary = ProjectStatsSummary::default();
    summary.project_name = project_name;

    let mut session_durations: Vec<u32> = Vec::new();
    let mut tool_usage_map: HashMap<String, (u32, u32)> = HashMap::new();
    let mut daily_stats_map: HashMap<String, DailyStats> = HashMap::new();
    let mut activity_map: HashMap<(u8, u8), (u32, u64)> = HashMap::new();
    let mut session_dates: HashSet<String> = HashSet::new();

    for entry in WalkDir::new(&project_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
    {
        summary.total_sessions += 1;
        let session_path = entry.path();
        let file = fs::File::open(session_path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);

        let mut session_timestamps: Vec<DateTime<Utc>> = Vec::new();
        let mut session_has_messages = false;

        for line in reader.lines() {
            let line = line.map_err(|e| e.to_string())?;
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(log_entry) = serde_json::from_str::<RawLogEntry>(&line) {
                if let Ok(message) = ClaudeMessage::try_from(log_entry) {
                    summary.total_messages += 1;
                    session_has_messages = true;

                    if let Ok(timestamp) = DateTime::parse_from_rfc3339(&message.timestamp) {
                        let timestamp = timestamp.with_timezone(&Utc);

                        // Collect timestamp for session duration calculation
                        session_timestamps.push(timestamp);

                        let hour = timestamp.hour() as u8;
                        let day = timestamp.weekday().num_days_from_sunday() as u8;
                        let usage = extract_token_usage(&message);
                        let tokens = usage.input_tokens.unwrap_or(0)
                            + usage.output_tokens.unwrap_or(0)
                            + usage.cache_creation_input_tokens.unwrap_or(0)
                            + usage.cache_read_input_tokens.unwrap_or(0);

                        let activity_entry = activity_map.entry((hour, day)).or_insert((0, 0));
                        activity_entry.0 += 1;
                        activity_entry.1 += tokens as u64;

                        let date = timestamp.format("%Y-%m-%d").to_string();
                        session_dates.insert(date.clone());

                        let daily_entry = daily_stats_map.entry(date.clone()).or_insert_with(|| DailyStats {
                            date, ..Default::default()
                        });

                        daily_entry.total_tokens += tokens as u64;
                        daily_entry.input_tokens += usage.input_tokens.unwrap_or(0) as u64;
                        daily_entry.output_tokens += usage.output_tokens.unwrap_or(0) as u64;
                        daily_entry.message_count += 1;

                        summary.token_distribution.input += usage.input_tokens.unwrap_or(0) as u64;
                        summary.token_distribution.output += usage.output_tokens.unwrap_or(0) as u64;
                        summary.token_distribution.cache_creation += usage.cache_creation_input_tokens.unwrap_or(0) as u64;
                        summary.token_distribution.cache_read += usage.cache_read_input_tokens.unwrap_or(0) as u64;
                    }

                    if message.message_type == "assistant" {
                        if let Some(content) = &message.content {
                            if let Some(content_array) = content.as_array() {
                                for item in content_array {
                                    if let Some(item_type) = item.get("type").and_then(|v| v.as_str()) {
                                        if item_type == "tool_use" {
                                            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                                                let tool_entry = tool_usage_map.entry(name.to_string()).or_insert((0, 0));
                                                tool_entry.0 += 1;
                                                tool_entry.1 += 1;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if let Some(tool_use) = &message.tool_use {
                        if let Some(name) = tool_use.get("name").and_then(|v| v.as_str()) {
                            let tool_entry = tool_usage_map.entry(name.to_string()).or_insert((0, 0));
                            tool_entry.0 += 1;
                            if let Some(result) = &message.tool_use_result {
                                let is_error = result.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                                if !is_error {
                                    tool_entry.1 += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Calculate session duration using new algorithm (split at long breaks)
        const SESSION_BREAK_THRESHOLD_MINUTES: i64 = 120; // 2 hours - increased from 60 min

        if session_timestamps.len() >= 2 {
            session_timestamps.sort();

            let mut current_period_start = session_timestamps[0];
            let mut session_total_minutes = 0u32;

            for i in 0..session_timestamps.len() - 1 {
                let current = session_timestamps[i];
                let next = session_timestamps[i + 1];
                let gap_minutes = (next - current).num_minutes();

                if gap_minutes > SESSION_BREAK_THRESHOLD_MINUTES {
                    // Close current period
                    let period_duration = (current - current_period_start).num_minutes();
                    session_total_minutes += period_duration.max(1) as u32;
                    current_period_start = next;
                }
            }

            // Close final period
            let last = session_timestamps[session_timestamps.len() - 1];
            let final_period = (last - current_period_start).num_minutes();
            session_total_minutes += final_period.max(1) as u32;

            session_durations.push(session_total_minutes);
        } else if session_timestamps.len() == 1 {
            session_durations.push(1); // Single message = 1 minute
        }

        if session_has_messages && !session_timestamps.is_empty() {
            let date = session_timestamps[0].format("%Y-%m-%d").to_string();
            session_dates.insert(date);
        }
    }

    for (date, daily_stat) in daily_stats_map.iter_mut() {
        daily_stat.session_count = session_dates.iter().filter(|&d| d == date).count();
        daily_stat.active_hours = if daily_stat.message_count > 0 {
            std::cmp::min(24, std::cmp::max(1, daily_stat.message_count / 10))
        } else {
            0
        };
    }

    summary.most_used_tools = tool_usage_map
        .into_iter()
        .map(|(name, (usage, success))| ToolUsageStats {
            tool_name: name,
            usage_count: usage,
            success_rate: if usage > 0 { (success as f32 / usage as f32) * 100.0 } else { 0.0 },
            avg_execution_time: None,
        })
        .collect();
    summary.most_used_tools.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));

    summary.daily_stats = daily_stats_map.into_values().collect();
    summary.daily_stats.sort_by(|a, b| a.date.cmp(&b.date));

    summary.activity_heatmap = activity_map
        .into_iter()
        .map(|((hour, day), (count, tokens))| ActivityHeatmap {
            hour,
            day,
            activity_count: count,
            tokens_used: tokens,
        })
        .collect();

    summary.total_tokens = summary.token_distribution.input + summary.token_distribution.output + summary.token_distribution.cache_creation + summary.token_distribution.cache_read;
    summary.avg_tokens_per_session = if summary.total_sessions > 0 { summary.total_tokens / summary.total_sessions as u64 } else { 0 };
    summary.total_session_duration = session_durations.iter().sum::<u32>();
    summary.avg_session_duration = if !session_durations.is_empty() {
        summary.total_session_duration / session_durations.len() as u32
    } else {
        0
    };

    summary.most_active_hour = summary.activity_heatmap
        .iter()
        .max_by_key(|a| a.activity_count)
        .map(|a| a.hour)
        .unwrap_or(0);

    Ok(summary)
}

#[tauri::command]
pub async fn get_session_comparison(
    session_id: String,
    project_path: String,
) -> Result<SessionComparison, String> {
    let all_sessions = get_project_token_stats(project_path).await?;
    
    let target_session = all_sessions
        .iter()
        .find(|s| s.session_id == session_id)
        .ok_or("Session not found in project")?;
    
    let total_project_tokens: u32 = all_sessions.iter().map(|s| s.total_tokens).sum();
    let total_project_messages: usize = all_sessions.iter().map(|s| s.message_count).sum();
    
    let percentage_of_project_tokens = if total_project_tokens > 0 {
        (target_session.total_tokens as f32 / total_project_tokens as f32) * 100.0
    } else {
        0.0
    };
    
    let percentage_of_project_messages = if total_project_messages > 0 {
        (target_session.message_count as f32 / total_project_messages as f32) * 100.0
    } else {
        0.0
    };
    
    let rank_by_tokens = all_sessions
        .iter()
        .position(|s| s.session_id == session_id)
        .unwrap_or(0) + 1;
    
    let mut sessions_by_duration = all_sessions.clone();
    sessions_by_duration.sort_by(|a, b| {
        let a_duration = chrono::DateTime::parse_from_rfc3339(&a.last_message_time)
            .ok()
            .zip(chrono::DateTime::parse_from_rfc3339(&a.first_message_time).ok())
            .map(|(end, start)| (end - start).num_seconds())
            .unwrap_or(0);
        let b_duration = chrono::DateTime::parse_from_rfc3339(&b.last_message_time)
            .ok()
            .zip(chrono::DateTime::parse_from_rfc3339(&b.first_message_time).ok())
            .map(|(end, start)| (end - start).num_seconds())
            .unwrap_or(0);
        b_duration.cmp(&a_duration)
    });
    
    let rank_by_duration = sessions_by_duration
        .iter()
        .position(|s| s.session_id == session_id)
        .unwrap_or(0) + 1;
    
    let avg_tokens = if !all_sessions.is_empty() {
        total_project_tokens / all_sessions.len() as u32
    } else {
        0
    };
    let is_above_average = target_session.total_tokens > avg_tokens;
    
    Ok(SessionComparison {
        session_id,
        percentage_of_project_tokens,
        percentage_of_project_messages,
        rank_by_tokens,
        rank_by_duration,
        is_above_average,
    })
}

impl TryFrom<RawLogEntry> for ClaudeMessage {
    type Error = String;

    fn try_from(log_entry: RawLogEntry) -> Result<Self, Self::Error> {
        if log_entry.message_type == "summary" {
            return Err("Summary entries should be handled separately".to_string());
        }
        if log_entry.session_id.is_none() && log_entry.timestamp.is_none() {
            return Err("Missing session_id and timestamp".to_string());
        }

        let (role, message_id, model, stop_reason, usage) = if let Some(ref msg) = log_entry.message {
            (
                Some(msg.role.clone()),
                msg.id.clone(),
                msg.model.clone(),
                msg.stop_reason.clone(),
                msg.usage.clone()
            )
        } else {
            (None, None, None, None, None)
        };

        Ok(ClaudeMessage {
            uuid: log_entry.uuid.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            parent_uuid: log_entry.parent_uuid,
            session_id: log_entry.session_id.unwrap_or_else(|| "unknown-session".to_string()),
            timestamp: log_entry.timestamp.unwrap_or_else(|| Utc::now().to_rfc3339()),
            message_type: log_entry.message_type.clone(),
            content: log_entry.message.map(|m| m.content).or(log_entry.content),
            tool_use: log_entry.tool_use,
            tool_use_result: log_entry.tool_use_result,
            is_sidechain: log_entry.is_sidechain,
            usage,
            role,
            message_id,
            model,
            stop_reason,
            cost_usd: log_entry.cost_usd,
            duration_ms: log_entry.duration_ms,
            // System message fields
            subtype: log_entry.subtype,
            level: log_entry.level,
            hook_count: log_entry.hook_count,
            hook_infos: log_entry.hook_infos,
            stop_reason_system: log_entry.stop_reason_system,
            prevented_continuation: log_entry.prevented_continuation,
            compact_metadata: log_entry.compact_metadata,
            microcompact_metadata: log_entry.microcompact_metadata,
        })
    }
}

#[tauri::command]
pub async fn get_global_stats_summary(claude_path: String) -> Result<GlobalStatsSummary, String> {
    let projects_path = PathBuf::from(&claude_path).join("projects");

    if !projects_path.exists() {
        return Err("Projects directory not found".to_string());
    }

    let mut summary = GlobalStatsSummary::default();

    let mut tool_usage_map: HashMap<String, (u32, u32)> = HashMap::new();
    let mut daily_stats_map: HashMap<String, DailyStats> = HashMap::new();
    let mut activity_map: HashMap<(u8, u8), (u32, u64)> = HashMap::new();
    let mut model_usage_map: HashMap<String, (u32, u64, u64, u64, u64, u64)> = HashMap::new(); // (message_count, total_tokens, input_tokens, output_tokens, cache_creation, cache_read)
    let mut project_stats_map: HashMap<String, (u32, u32, u64)> = HashMap::new();
    let mut global_first_message: Option<DateTime<Utc>> = None;
    let mut global_last_message: Option<DateTime<Utc>> = None;

    for project_entry in fs::read_dir(&projects_path).map_err(|e| e.to_string())? {
        let project_entry = project_entry.map_err(|e| e.to_string())?;
        let project_path = project_entry.path();

        if !project_path.is_dir() {
            continue;
        }

        let project_name = project_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        summary.total_projects += 1;

        let mut project_sessions = 0u32;
        let mut project_messages = 0u32;
        let mut project_tokens = 0u64;

        for entry in WalkDir::new(&project_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
        {
            summary.total_sessions += 1;
            project_sessions += 1;

            let session_path = entry.path();
            let file = match fs::File::open(session_path) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let reader = BufReader::new(file);

            let mut session_timestamps: Vec<DateTime<Utc>> = Vec::new();

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => continue,
                };

                if line.trim().is_empty() {
                    continue;
                }

                if let Ok(log_entry) = serde_json::from_str::<RawLogEntry>(&line) {
                    if let Ok(message) = ClaudeMessage::try_from(log_entry) {
                        summary.total_messages += 1;
                        project_messages += 1;

                        if let Ok(timestamp) = DateTime::parse_from_rfc3339(&message.timestamp) {
                            let timestamp = timestamp.with_timezone(&Utc);

                            // Collect timestamp for active time calculation
                            session_timestamps.push(timestamp);

                            if global_first_message.is_none() || timestamp < global_first_message.unwrap() {
                                global_first_message = Some(timestamp);
                            }
                            if global_last_message.is_none() || timestamp > global_last_message.unwrap() {
                                global_last_message = Some(timestamp);
                            }

                            let hour = timestamp.hour() as u8;
                            let day = timestamp.weekday().num_days_from_sunday() as u8;
                            let usage = extract_token_usage(&message);
                            let tokens = usage.input_tokens.unwrap_or(0) as u64
                                + usage.output_tokens.unwrap_or(0) as u64
                                + usage.cache_creation_input_tokens.unwrap_or(0) as u64
                                + usage.cache_read_input_tokens.unwrap_or(0) as u64;
                            let input_tokens = usage.input_tokens.unwrap_or(0) as u64;
                            let output_tokens = usage.output_tokens.unwrap_or(0) as u64;
                            let cache_creation_tokens = usage.cache_creation_input_tokens.unwrap_or(0) as u64;
                            let cache_read_tokens = usage.cache_read_input_tokens.unwrap_or(0) as u64;

                            summary.total_tokens += tokens;
                            project_tokens += tokens;

                            let activity_entry = activity_map.entry((hour, day)).or_insert((0, 0));
                            activity_entry.0 += 1;
                            activity_entry.1 += tokens;

                            let date = timestamp.format("%Y-%m-%d").to_string();
                            let daily_entry = daily_stats_map.entry(date.clone()).or_insert_with(|| DailyStats {
                                date, ..Default::default()
                            });

                            daily_entry.total_tokens += tokens as u64;
                            daily_entry.input_tokens += usage.input_tokens.unwrap_or(0) as u64;
                            daily_entry.output_tokens += usage.output_tokens.unwrap_or(0) as u64;
                            daily_entry.message_count += 1;

                            summary.token_distribution.input += usage.input_tokens.unwrap_or(0) as u64;
                            summary.token_distribution.output += usage.output_tokens.unwrap_or(0) as u64;
                            summary.token_distribution.cache_creation += usage.cache_creation_input_tokens.unwrap_or(0) as u64;
                            summary.token_distribution.cache_read += usage.cache_read_input_tokens.unwrap_or(0) as u64;

                            if let Some(model_name) = &message.model {
                                let model_entry = model_usage_map.entry(model_name.clone()).or_insert((0, 0, 0, 0, 0, 0));
                                model_entry.0 += 1; // message_count
                                model_entry.1 += tokens; // total_tokens
                                model_entry.2 += input_tokens; // input_tokens
                                model_entry.3 += output_tokens; // output_tokens
                                model_entry.4 += cache_creation_tokens; // cache_creation_tokens
                                model_entry.5 += cache_read_tokens; // cache_read_tokens
                            }
                        }

                        if message.message_type == "assistant" {
                            if let Some(content) = &message.content {
                                if let Some(content_array) = content.as_array() {
                                    for item in content_array {
                                        if let Some(item_type) = item.get("type").and_then(|v| v.as_str()) {
                                            if item_type == "tool_use" {
                                                if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                                                    let tool_entry = tool_usage_map.entry(name.to_string()).or_insert((0, 0));
                                                    tool_entry.0 += 1;
                                                    tool_entry.1 += 1;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if let Some(tool_use) = &message.tool_use {
                            if let Some(name) = tool_use.get("name").and_then(|v| v.as_str()) {
                                let tool_entry = tool_usage_map.entry(name.to_string()).or_insert((0, 0));
                                tool_entry.0 += 1;
                                if let Some(result) = &message.tool_use_result {
                                    let is_error = result.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                                    if !is_error {
                                        tool_entry.1 += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Calculate session time by counting time spans between messages
            // Split sessions at breaks >120 minutes (overnight, long breaks, etc.)
            const SESSION_BREAK_THRESHOLD_MINUTES: i64 = 120;

            if session_timestamps.len() >= 2 {
                session_timestamps.sort();

                // Track active periods (split at long breaks)
                let mut current_period_start = session_timestamps[0];
                let mut total_active_minutes = 0u64;

                for i in 0..session_timestamps.len() - 1 {
                    let current = session_timestamps[i];
                    let next = session_timestamps[i + 1];
                    let gap_minutes = (next - current).num_minutes();

                    // If gap >60 minutes, it's a session break (lunch, pause, etc.)
                    if gap_minutes > SESSION_BREAK_THRESHOLD_MINUTES {
                        // Close current active period
                        let period_duration = (current - current_period_start).num_minutes();
                        total_active_minutes += period_duration.max(1) as u64; // Minimum 1 minute

                        // Start new active period after the break
                        current_period_start = next;
                    }
                }

                // Close final active period
                let last_timestamp = session_timestamps[session_timestamps.len() - 1];
                let final_period = (last_timestamp - current_period_start).num_minutes();
                total_active_minutes += final_period.max(1) as u64;

                summary.total_session_duration_minutes += total_active_minutes;
            } else if session_timestamps.len() == 1 {
                // Single message session = 1 minute minimum
                summary.total_session_duration_minutes += 1;
            }
        }

        project_stats_map.insert(project_name, (project_sessions, project_messages, project_tokens));
    }

    summary.most_used_tools = tool_usage_map
        .into_iter()
        .map(|(name, (usage, success))| ToolUsageStats {
            tool_name: name,
            usage_count: usage,
            success_rate: if usage > 0 { (success as f32 / usage as f32) * 100.0 } else { 0.0 },
            avg_execution_time: None,
        })
        .collect();
    summary.most_used_tools.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));

    summary.model_distribution = model_usage_map
        .into_iter()
        .map(|(model_name, (message_count, token_count, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens))| ModelStats {
            model_name,
            message_count,
            token_count,
            input_tokens,
            output_tokens,
            cache_creation_tokens,
            cache_read_tokens,
        })
        .collect();
    summary.model_distribution.sort_by(|a, b| b.token_count.cmp(&a.token_count));

    summary.top_projects = project_stats_map
        .into_iter()
        .map(|(project_name, (sessions, messages, tokens))| ProjectRanking {
            project_name,
            sessions,
            messages,
            tokens,
        })
        .collect();
    summary.top_projects.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    summary.top_projects.truncate(10);

    summary.daily_stats = daily_stats_map.into_values().collect();
    summary.daily_stats.sort_by(|a, b| a.date.cmp(&b.date));

    summary.activity_heatmap = activity_map
        .into_iter()
        .map(|((hour, day), (count, tokens))| ActivityHeatmap {
            hour,
            day,
            activity_count: count,
            tokens_used: tokens,
        })
        .collect();

    if let (Some(first), Some(last)) = (global_first_message, global_last_message) {
        summary.date_range.first_message = Some(first.to_rfc3339());
        summary.date_range.last_message = Some(last.to_rfc3339());
        summary.date_range.days_span = (last - first).num_days() as u32;
    }

    Ok(summary)
}
