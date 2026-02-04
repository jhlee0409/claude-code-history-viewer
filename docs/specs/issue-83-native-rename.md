# Issue #83: Native Claude Code Chat Renaming

## 🎯 관련 이슈
Closes #83

## 📋 문제 분석

### 현재 동작
- 세션 이름 변경 시 `~/.claude/metadata.json`에 `customName` 저장
- **앱 내에서만** 변경된 이름 표시
- Claude Code CLI에서는 여전히 **원래 이름** 표시

### 사용자 요청
- Claude Code가 세션 이름을 **첫 번째 메시지**에서 가져옴
- JSONL 파일의 첫 번째 라인을 수정하면 Claude Code에서도 변경된 이름 표시
- "Rename Claude Chat" 옵션 추가 요청

### 기술적 배경
Claude Code는 `~/.claude/projects/*/` 내의 JSONL 파일에서 첫 번째 user 메시지를 세션 이름으로 사용.

```jsonl
{"type":"user","message":"Fix the login bug","timestamp":"..."}  // ← 이게 세션 이름
{"type":"assistant","message":"I'll help...","timestamp":"..."}
```

## 💡 제안 솔루션

### 옵션 A: 첫 번째 메시지 앞에 제목 Prepend (권장)
```jsonl
{"type":"user","message":"[My Custom Title] Fix the login bug","timestamp":"..."}
```

**장점:**
- 원본 메시지 내용 보존
- Claude Code에서 `[My Custom Title] Fix the login bug` 표시
- Rollback 쉬움 (prefix 제거)

### 옵션 B: 첫 번째 메시지 완전 교체
```jsonl
{"type":"user","message":"My Custom Title","timestamp":"..."}
```

**단점:**
- 원본 컨텍스트 손실
- Rollback 불가능 (원본 저장 필요)

### 결론: **옵션 A 채택**

## 📁 수정 필요 파일

### Backend (Rust/Tauri)

| 파일 | 변경 내용 |
|-----|----------|
| `src-tauri/src/commands/session/mod.rs` | 새 command 모듈 등록 |
| `src-tauri/src/commands/session/rename.rs` | **[NEW]** Native rename command 구현 |
| `src-tauri/src/lib.rs` | Command 등록 |

### Frontend (React/TypeScript)

| 파일 | 변경 내용 |
|-----|----------|
| `src/components/SessionItem.tsx` | "Rename in Claude Code" 옵션 추가 |
| `src/hooks/useSessionMetadata.ts` | Native rename 함수 추가 |
| `src/i18n/locales/en/translation.json` | 번역 키 추가 |
| `src/i18n/locales/ko/translation.json` | 한국어 번역 |

## 🔧 구현 단계

### Step 1: Rust Backend - Native Rename Command

**파일:** `src-tauri/src/commands/session/rename.rs`

```rust
use std::fs;
use std::io::{BufRead, BufReader, Write};
use tauri::command;

#[derive(serde::Serialize)]
pub struct RenameResult {
    success: bool,
    original_title: Option<String>,
    new_title: String,
}

/// Renames a Claude Code session by modifying the first user message
/// 
/// # Arguments
/// * `file_path` - Path to the JSONL session file
/// * `new_title` - The new title to prepend (wrapped in brackets)
/// 
/// # Format
/// Original: "Fix the login bug"
/// Modified: "[My Title] Fix the login bug"
#[command]
pub async fn rename_session_native(
    file_path: String,
    new_title: String,
) -> Result<RenameResult, String> {
    // 1. Read all lines from JSONL
    let file = fs::File::open(&file_path)
        .map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines: Vec<String> = reader.lines()
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Failed to read lines: {}", e))?;
    
    if lines.is_empty() {
        return Err("Empty session file".to_string());
    }
    
    // 2. Parse first line and find user message
    let first_line = &lines[0];
    let mut json: serde_json::Value = serde_json::from_str(first_line)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    // 3. Extract original message
    let original_message = json.get("message")
        .and_then(|m| m.as_str())
        .ok_or("No message field found")?
        .to_string();
    
    // 4. Remove existing bracket prefix if present
    let clean_message = if original_message.starts_with('[') {
        if let Some(end) = original_message.find("] ") {
            original_message[end + 2..].to_string()
        } else {
            original_message.clone()
        }
    } else {
        original_message.clone()
    };
    
    // 5. Create new message with title prefix
    let new_message = if new_title.is_empty() {
        clean_message.clone()
    } else {
        format!("[{}] {}", new_title, clean_message)
    };
    
    // 6. Update JSON
    json["message"] = serde_json::Value::String(new_message.clone());
    
    // 7. Update first line
    lines[0] = serde_json::to_string(&json)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
    
    // 8. Write back to file
    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            writeln!(file).map_err(|e| format!("Failed to write: {}", e))?;
        }
        write!(file, "{}", line).map_err(|e| format!("Failed to write: {}", e))?;
    }
    
    Ok(RenameResult {
        success: true,
        original_title: Some(original_message),
        new_title: new_message,
    })
}

/// Removes the bracket prefix from a session, restoring original title
#[command]
pub async fn reset_session_native_name(file_path: String) -> Result<RenameResult, String> {
    rename_session_native(file_path, String::new()).await
}
```

### Step 2: Register Command in Tauri

**파일:** `src-tauri/src/commands/session/mod.rs`

```rust
mod rename;
pub use rename::{rename_session_native, reset_session_native_name};
```

**파일:** `src-tauri/src/lib.rs`

```rust
// Add to invoke_handler
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    commands::session::rename_session_native,
    commands::session::reset_session_native_name,
])
```

### Step 3: Frontend - Add Native Rename Hook

**파일:** `src/hooks/useSessionMetadata.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

interface NativeRenameResult {
  success: boolean;
  original_title?: string;
  new_title: string;
}

/**
 * Rename session in Claude Code (modifies JSONL file)
 * This change will be visible in Claude Code CLI
 */
export const renameSessionNative = async (
  filePath: string,
  newTitle: string
): Promise<NativeRenameResult> => {
  return await invoke<NativeRenameResult>("rename_session_native", {
    filePath,
    newTitle,
  });
};

/**
 * Reset native session name (removes bracket prefix)
 */
export const resetSessionNativeName = async (
  filePath: string
): Promise<NativeRenameResult> => {
  return await invoke<NativeRenameResult>("reset_session_native_name", {
    filePath,
  });
};
```

### Step 4: Update SessionItem UI

**파일:** `src/components/SessionItem.tsx`

```tsx
// Add to DropdownMenuContent
<DropdownMenuItem onClick={handleNativeRenameClick}>
  <Terminal className="w-3 h-3 mr-2" />
  {t("session.renameNative", "Rename in Claude Code")}
</DropdownMenuItem>
```

**Dialog for Native Rename:**
```tsx
<Dialog open={isNativeRenameOpen} onOpenChange={setIsNativeRenameOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{t("session.renameNativeTitle")}</DialogTitle>
      <DialogDescription>
        {t("session.renameNativeDescription")}
      </DialogDescription>
    </DialogHeader>
    <Input
      value={nativeTitle}
      onChange={(e) => setNativeTitle(e.target.value)}
      placeholder={t("session.renameNativePlaceholder")}
    />
    <DialogFooter>
      <Button variant="outline" onClick={() => setIsNativeRenameOpen(false)}>
        {t("common.cancel")}
      </Button>
      <Button onClick={handleNativeRenameSave}>
        {t("common.save")}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Step 5: i18n Translations

**파일:** `src/i18n/locales/en/translation.json`
```json
{
  "session": {
    "renameNative": "Rename in Claude Code",
    "renameNativeTitle": "Rename in Claude Code",
    "renameNativeDescription": "This will modify the session file so the name appears in Claude Code CLI. The change is reversible.",
    "renameNativePlaceholder": "Enter session title...",
    "renameNativeSuccess": "Session renamed successfully",
    "renameNativeReset": "Reset native name"
  }
}
```

**파일:** `src/i18n/locales/ko/translation.json`
```json
{
  "session": {
    "renameNative": "Claude Code에서 이름 변경",
    "renameNativeTitle": "Claude Code에서 이름 변경",
    "renameNativeDescription": "세션 파일을 수정하여 Claude Code CLI에서도 변경된 이름이 표시됩니다. 변경사항은 되돌릴 수 있습니다.",
    "renameNativePlaceholder": "세션 제목 입력...",
    "renameNativeSuccess": "세션 이름이 변경되었습니다",
    "renameNativeReset": "기본 이름으로 복원"
  }
}
```

## ✅ 수락 기준

- [ ] "Rename in Claude Code" 메뉴 옵션 추가
- [ ] JSONL 파일 수정으로 Claude Code에서 변경된 이름 표시
- [ ] `[Title] Original message` 포맷으로 원본 보존
- [ ] 기존 bracket prefix 있을 경우 교체
- [ ] "Reset native name" 옵션으로 원본 복원 가능
- [ ] 다국어 지원 (en, ko, ja, zh-CN, zh-TW)
- [ ] 에러 핸들링 (파일 없음, 권한 오류 등)

## 🧪 테스트 방법

1. 앱에서 세션 선택
2. 컨텍스트 메뉴 > "Rename in Claude Code" 클릭
3. 새 이름 입력 후 저장
4. Claude Code CLI에서 확인: `claude --continue`
5. 세션 목록에서 변경된 이름 확인
6. "Reset native name"으로 원본 복원 테스트

## ⚠️ 주의사항

1. **파일 수정 경고**: 사용자에게 JSONL 파일이 수정됨을 명확히 안내
2. **백업 권장**: 중요한 세션은 수정 전 백업 권장
3. **동시성**: Claude Code가 세션 사용 중일 때 충돌 가능성 → 경고 표시

## 📝 추가 참고사항

- 기존 "Rename" 기능 (메타데이터 방식)은 그대로 유지
- 새 기능은 별도 메뉴 옵션으로 추가
- 두 가지 이름 변경 방식 공존:
  1. **App-only rename**: 빠르고 안전, 앱 내에서만 표시
  2. **Native rename**: Claude Code에서도 표시, 파일 수정 필요

---
_이 스펙은 JJ (AI Assistant)가 자동 생성했습니다. 구현 시작 전 내용을 검토해주세요._
