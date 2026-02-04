# Implementation Spec: Native Claude Code Session Renaming

> **Issue**: #83 - Chat renaming that's visible in Claude Code  
> **Status**: Ready for Implementation  
> **Priority**: Enhancement  
> **Complexity**: Medium

> ⚠️ **Disclaimer**: Code samples in this specification are **reference implementations** for guidance purposes. They have not been compiled or tested. Implementers should verify, adapt, and test all code before use.

---

## Executive Summary

This specification outlines the implementation of a native session renaming feature that persists rename operations directly to Claude Code's session files (JSONL), enabling renamed sessions to be visible in the Claude Code CLI—not just within this viewer application.

---

## 1. Problem Statement

### Current Behavior
- Session renaming stores metadata in `~/.claude/metadata.json` (app-specific storage)
- Renamed sessions only appear with custom names within this viewer application
- Claude Code CLI continues to display the original session name derived from the first user message

### User Requirement
- Users want session renames to be **visible in Claude Code CLI**
- Claude Code derives session names from the **first user message** in each JSONL file
- A mechanism to modify the source JSONL file is required

### Business Impact
- Improves workflow continuity between this viewer and Claude Code CLI
- Reduces user confusion from inconsistent naming across tools
- Enhances overall user experience and adoption

---

## 2. Technical Analysis

### Claude Code Session Naming Mechanism

Claude Code stores conversation history in JSONL format:
```
~/.claude/projects/{encoded-project-path}/{session-id}.jsonl
```

Each line represents a message. The **first user message** determines the session display name in Claude Code CLI:

```jsonl
{"type":"user","message":"Fix the authentication bug in login.ts","timestamp":"2024-01-15T10:30:00Z","uuid":"..."}
{"type":"assistant","message":"I'll analyze the login.ts file...","timestamp":"2024-01-15T10:30:05Z","uuid":"..."}
```

**Session name displayed**: `Fix the authentication bug in login.ts`

### Proposed Solution: Title Prefix Injection

Inject a bracketed title prefix into the first user message:

**Before:**
```jsonl
{"type":"user","message":"Fix the authentication bug in login.ts",...}
```

**After:**
```jsonl
{"type":"user","message":"[Auth Bug Fix] Fix the authentication bug in login.ts",...}
```

**Displayed in Claude Code**: `[Auth Bug Fix] Fix the authentication bug in login.ts`

### Why Prefix Injection (Not Replacement)?

| Approach | Data Preservation | Rollback Capability | Context Integrity |
|----------|-------------------|---------------------|-------------------|
| **Prefix Injection** ✅ | Original message preserved | Easy (remove prefix) | Full context maintained |
| Full Replacement ❌ | Original message lost | Requires backup | Context destroyed |

**Decision**: Prefix injection is the recommended approach for data safety and reversibility.

---

## 3. Architecture Design

### 3.1 System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                           │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │ Session     │───▶│ Rename Dialog    │───▶│ Confirmation  │  │
│  │ Context Menu│    │ (Native Option)  │    │ Modal         │  │
│  └─────────────┘    └──────────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend Layer (React)                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ useNativeRename Hook                                     │   │
│  │ - Input validation                                       │   │
│  │ - Tauri command invocation                              │   │
│  │ - Error handling & user feedback                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ IPC (Tauri Invoke)
┌─────────────────────────────────────────────────────────────────┐
│                     Backend Layer (Rust/Tauri)                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ rename_session_native Command                            │   │
│  │ - File read/parse                                        │   │
│  │ - JSON manipulation                                      │   │
│  │ - Atomic file write                                      │   │
│  │ - Error propagation                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     File System                                 │
│  ~/.claude/projects/{project}/{session}.jsonl                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| `SessionItem.tsx` | UI for rename option, user input collection |
| `useNativeRename.ts` | Business logic, validation, Tauri bridge |
| `rename.rs` | File I/O, JSON parsing, atomic write operations |
| `mod.rs` | Command registration and module exports |

---

## 4. Implementation Guide

### 4.1 Backend Implementation (Rust)

#### File: `src-tauri/src/commands/session/rename.rs`

```rust
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use tauri::command;

/// Result structure for rename operations
#[derive(Debug, Serialize, Deserialize)]
pub struct NativeRenameResult {
    pub success: bool,
    pub previous_title: String,
    pub new_title: String,
    pub file_path: String,
}

/// Error types for rename operations
#[derive(Debug, Serialize)]
pub enum RenameError {
    FileNotFound(String),
    PermissionDenied(String),
    InvalidJsonFormat(String),
    IoError(String),
    EmptySession,
}

impl std::fmt::Display for RenameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenameError::FileNotFound(path) => write!(f, "Session file not found: {}", path),
            RenameError::PermissionDenied(path) => write!(f, "Permission denied: {}", path),
            RenameError::InvalidJsonFormat(msg) => write!(f, "Invalid JSON format: {}", msg),
            RenameError::IoError(msg) => write!(f, "I/O error: {}", msg),
            RenameError::EmptySession => write!(f, "Session file is empty"),
        }
    }
}

/// Renames a Claude Code session by modifying the first user message.
/// 
/// # Arguments
/// * `file_path` - Absolute path to the session JSONL file
/// * `new_title` - Title to prepend (empty string to reset)
/// 
/// # Returns
/// * `Ok(NativeRenameResult)` - Success with previous and new titles
/// * `Err(String)` - Error description
/// 
/// # Example
/// ```
/// // Rename session
/// rename_session_native("/path/to/session.jsonl", "My Custom Title")
/// 
/// // Reset to original
/// rename_session_native("/path/to/session.jsonl", "")
/// ```
#[command]
pub async fn rename_session_native(
    file_path: String,
    new_title: String,
) -> Result<NativeRenameResult, String> {
    // 1. Validate file exists and is readable
    if !std::path::Path::new(&file_path).exists() {
        return Err(RenameError::FileNotFound(file_path).to_string());
    }

    // 2. Read all lines from JSONL file
    let file = File::open(&file_path)
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
    let reader = BufReader::new(file);
    let mut lines: Vec<String> = reader
        .lines()
        .collect::<Result<_, _>>()
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

    if lines.is_empty() {
        return Err(RenameError::EmptySession.to_string());
    }

    // 3. Parse first line as JSON
    let mut first_message: serde_json::Value = serde_json::from_str(&lines[0])
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 4. Extract current message content
    let current_message = first_message
        .get("message")
        .and_then(|m| m.as_str())
        .ok_or_else(|| RenameError::InvalidJsonFormat("No 'message' field".to_string()).to_string())?
        .to_string();

    // 5. Strip existing bracket prefix if present
    let base_message = strip_title_prefix(&current_message);

    // 6. Construct new message with title prefix
    let new_message = if new_title.trim().is_empty() {
        base_message.clone()
    } else {
        format!("[{}] {}", new_title.trim(), base_message)
    };

    // 7. Update JSON object
    first_message["message"] = serde_json::Value::String(new_message.clone());

    // 8. Serialize back to JSON string
    lines[0] = serde_json::to_string(&first_message)
        .map_err(|e| RenameError::InvalidJsonFormat(e.to_string()).to_string())?;

    // 9. Write atomically (write to temp, then rename)
    let temp_path = format!("{}.tmp", file_path);
    {
        let mut temp_file = File::create(&temp_path)
            .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
        
        for (i, line) in lines.iter().enumerate() {
            if i > 0 {
                writeln!(temp_file)
                    .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
            }
            write!(temp_file, "{}", line)
                .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;
        }
    }

    // 10. Atomic rename
    fs::rename(&temp_path, &file_path)
        .map_err(|e| RenameError::IoError(e.to_string()).to_string())?;

    Ok(NativeRenameResult {
        success: true,
        previous_title: current_message,
        new_title: new_message,
        file_path,
    })
}

/// Strips existing [Title] prefix from message
fn strip_title_prefix(message: &str) -> String {
    if message.starts_with('[') {
        if let Some(end_bracket) = message.find(']') {
            let after_bracket = &message[end_bracket + 1..];
            return after_bracket.trim_start().to_string();
        }
    }
    message.to_string()
}

/// Resets session name to original (removes title prefix)
#[command]
pub async fn reset_session_native_name(file_path: String) -> Result<NativeRenameResult, String> {
    rename_session_native(file_path, String::new()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_title_prefix() {
        assert_eq!(
            strip_title_prefix("[My Title] Original message"),
            "Original message"
        );
        assert_eq!(
            strip_title_prefix("No prefix here"),
            "No prefix here"
        );
        assert_eq!(
            strip_title_prefix("[Nested [brackets]] Message"),
            "Message" // Takes first ]
        );
    }
}
```

#### File: `src-tauri/src/commands/session/mod.rs`

```rust
// Add to existing module
mod rename;

pub use rename::{rename_session_native, reset_session_native_name, NativeRenameResult};
```

#### File: `src-tauri/src/lib.rs`

```rust
// Add to invoke_handler macro
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    commands::session::rename_session_native,
    commands::session::reset_session_native_name,
])
```

### 4.2 Frontend Implementation (React/TypeScript)

#### File: `src/hooks/useNativeRename.ts`

```typescript
import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NativeRenameResult {
  success: boolean;
  previous_title: string;
  new_title: string;
  file_path: string;
}

export interface UseNativeRenameReturn {
  isRenaming: boolean;
  error: string | null;
  renameNative: (filePath: string, newTitle: string) => Promise<NativeRenameResult>;
  resetNativeName: (filePath: string) => Promise<NativeRenameResult>;
}

/**
 * Hook for native Claude Code session renaming operations.
 * 
 * This hook provides functionality to rename sessions at the file level,
 * making the rename visible in Claude Code CLI.
 * 
 * @example
 * ```tsx
 * const { renameNative, isRenaming, error } = useNativeRename();
 * 
 * const handleRename = async () => {
 *   try {
 *     const result = await renameNative(session.file_path, "My New Title");
 *     toast.success(`Renamed: ${result.new_title}`);
 *   } catch (err) {
 *     toast.error(`Failed: ${err}`);
 *   }
 * };
 * ```
 */
export const useNativeRename = (): UseNativeRenameReturn => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renameNative = useCallback(
    async (filePath: string, newTitle: string): Promise<NativeRenameResult> => {
      setIsRenaming(true);
      setError(null);

      try {
        const result = await invoke<NativeRenameResult>("rename_session_native", {
          filePath,
          newTitle: newTitle.trim(),
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        throw new Error(errorMessage);
      } finally {
        setIsRenaming(false);
      }
    },
    []
  );

  const resetNativeName = useCallback(
    async (filePath: string): Promise<NativeRenameResult> => {
      return renameNative(filePath, "");
    },
    [renameNative]
  );

  return {
    isRenaming,
    error,
    renameNative,
    resetNativeName,
  };
};
```

#### File: `src/components/NativeRenameDialog.tsx`

```tsx
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Terminal } from "lucide-react";
import { useNativeRename } from "@/hooks/useNativeRename";

interface NativeRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  currentName: string;
  onSuccess?: (newTitle: string) => void;
}

export const NativeRenameDialog: React.FC<NativeRenameDialogProps> = ({
  open,
  onOpenChange,
  filePath,
  currentName,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const { renameNative, isRenaming, error } = useNativeRename();
  const [title, setTitle] = useState("");

  // Extract existing title if present
  useEffect(() => {
    if (open) {
      const match = currentName.match(/^\[(.+?)\]/);
      setTitle(match ? match[1] : "");
    }
  }, [open, currentName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await renameNative(filePath, title);
      onSuccess?.(result.new_title);
      onOpenChange(false);
    } catch {
      // Error is handled by the hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            {t("session.nativeRename.title", "Rename in Claude Code")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "session.nativeRename.description",
              "This will modify the session file directly. The change will be visible in Claude Code CLI."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t(
                  "session.nativeRename.warning",
                  "This operation modifies the original session file. The change is reversible."
                )}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("session.nativeRename.label", "Session Title")}
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t(
                  "session.nativeRename.placeholder",
                  "Enter a title (leave empty to reset)"
                )}
                disabled={isRenaming}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "session.nativeRename.preview",
                  "Preview: [{title}] {original}",
                  {
                    title: title || "Title",
                    original: currentName.replace(/^\[.+?\]\s*/, "").slice(0, 30),
                  }
                )}
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isRenaming}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button type="submit" disabled={isRenaming}>
              {isRenaming
                ? t("common.saving", "Saving...")
                : t("common.save", "Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
```

### 4.3 i18n Translations

#### File: `src/i18n/locales/en/translation.json` (additions)

```json
{
  "session": {
    "nativeRename": {
      "title": "Rename in Claude Code",
      "description": "This will modify the session file directly. The change will be visible in Claude Code CLI.",
      "warning": "This operation modifies the original session file. The change is reversible.",
      "label": "Session Title",
      "placeholder": "Enter a title (leave empty to reset)",
      "preview": "Preview: [{{title}}] {{original}}...",
      "success": "Session renamed successfully",
      "menuItem": "Rename in Claude Code",
      "resetMenuItem": "Reset native name"
    }
  }
}
```

---

## 5. Testing Strategy

### 5.1 Unit Tests (Rust)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use std::io::Write;

    #[tokio::test]
    async fn test_rename_session_native_adds_prefix() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, r#"{{"type":"user","message":"Original message","uuid":"123"}}"#).unwrap();
        writeln!(temp, r#"{{"type":"assistant","message":"Response","uuid":"456"}}"#).unwrap();

        let result = rename_session_native(
            temp.path().to_string_lossy().to_string(),
            "My Title".to_string(),
        ).await.unwrap();

        assert!(result.success);
        assert_eq!(result.new_title, "[My Title] Original message");
    }

    #[tokio::test]
    async fn test_rename_session_native_replaces_existing_prefix() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, r#"{{"type":"user","message":"[Old Title] Original message","uuid":"123"}}"#).unwrap();

        let result = rename_session_native(
            temp.path().to_string_lossy().to_string(),
            "New Title".to_string(),
        ).await.unwrap();

        assert_eq!(result.new_title, "[New Title] Original message");
    }

    #[tokio::test]
    async fn test_reset_removes_prefix() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, r#"{{"type":"user","message":"[Title] Original message","uuid":"123"}}"#).unwrap();

        let result = reset_session_native_name(
            temp.path().to_string_lossy().to_string(),
        ).await.unwrap();

        assert_eq!(result.new_title, "Original message");
    }
}
```

### 5.2 Integration Tests

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Basic rename | 1. Open session menu<br>2. Click "Rename in Claude Code"<br>3. Enter title<br>4. Save | File modified, new title visible |
| Reset name | 1. Rename a session<br>2. Click "Reset native name" | Original message restored |
| Empty title | 1. Open rename dialog<br>2. Clear input<br>3. Save | Prefix removed (reset) |
| File not found | 1. Delete session file<br>2. Try to rename | Error message displayed |
| Claude Code verification | 1. Rename session<br>2. Run `claude --continue` | New title visible in CLI |

---

## 6. Acceptance Criteria

- [ ] "Rename in Claude Code" menu option available in session context menu
- [ ] Title prefix format: `[Title] Original message`
- [ ] Existing prefix is replaced (not stacked)
- [ ] Empty title input resets to original message
- [ ] Atomic file write prevents corruption
- [ ] Error handling with user-friendly messages
- [ ] i18n support for EN, KO, JA, ZH-CN, ZH-TW
- [ ] Unit tests pass with >90% coverage for rename module
- [ ] Integration test confirms Claude Code CLI visibility
- [ ] No regression in existing rename (metadata) functionality

---

## 7. Performance Considerations

| Operation | Complexity | Notes |
|-----------|------------|-------|
| File read | O(n) | n = number of lines in JSONL |
| JSON parse (first line) | O(m) | m = first message length |
| File write | O(n) | Full file rewrite required |
| Atomic rename | O(1) | OS-level operation |

**Optimization Notes:**
- For large sessions (>10MB), consider streaming write
- First-line-only modification minimizes memory footprint
- Temp file approach prevents partial write corruption

---

## 8. Rollback Plan

In case of issues post-deployment:

1. **Immediate rollback**: Revert the PR, redeploy
2. **Data recovery**: Original message preserved in `[Title] Original` format
3. **User communication**: In-app notification explaining the rollback
4. **Logs**: All rename operations should be logged for audit

**Rollback command** (manual recovery):
```bash
# Find all modified sessions
grep -r '^\[' ~/.claude/projects/*/\*.jsonl

# Script to remove all prefixes (emergency use only)
find ~/.claude/projects -name "*.jsonl" -exec sed -i '' 's/^\(\[.*\] \)//' {} \;
```

---

## 9. Security Considerations

| Risk | Mitigation |
|------|------------|
| File path traversal | Validate path is within `~/.claude/` directory |
| Concurrent access | Use atomic write (temp file + rename) |
| Data loss | Preserve original message content within prefix |
| Permission issues | Check file permissions before write attempt |

---

## 10. Future Enhancements

1. **Batch rename**: Rename multiple sessions at once
2. **Sync with metadata**: Option to sync native name with app metadata
3. **Name templates**: Predefined naming patterns (date, project, etc.)
4. **Undo history**: Track rename history for multi-level undo

---

## References

- [Claude Code Documentation](https://docs.anthropic.com/claude-code)
- [Tauri File System API](https://tauri.app/v1/api/js/fs)
- [Issue #83](https://github.com/jhlee0409/claude-code-history-viewer/issues/83)

---

*This specification was generated by JJ (OpenClaw AI Assistant) and reviewed for enterprise-grade implementation standards.*
