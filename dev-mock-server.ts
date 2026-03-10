/**
 * Vite dev server mock middleware for browser testing.
 *
 * Provides mock API responses so the app can render in a browser
 * without Tauri runtime. Used for UI development and testing only.
 *
 * Usage: set VITE_MOCK=1 environment variable, then `pnpm dev`
 */

import type { Plugin } from "vite";

function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function makeMessage(
  type: "user" | "assistant",
  content: string,
  timestamp: string,
  parentUuid?: string,
) {
  const uuid = makeUuid();
  return {
    uuid,
    parentUuid: parentUuid ?? null,
    sessionId: "mock-session-001",
    timestamp,
    type,
    isSidechain: false,
    message: {
      role: type === "user" ? "user" : "assistant",
      content:
        type === "assistant"
          ? [{ type: "text", text: content }]
          : content,
      ...(type === "assistant"
        ? {
            id: `msg_${uuid.slice(0, 8)}`,
            model: "claude-sonnet-4-20250514",
            stop_reason: "end_turn",
            usage: {
              input_tokens: 1200,
              output_tokens: 350,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          }
        : {}),
    },
    content:
      type === "assistant"
        ? [{ type: "text", text: content }]
        : content,
    model: type === "assistant" ? "claude-sonnet-4-20250514" : undefined,
    usage:
      type === "assistant"
        ? {
            input_tokens: 1200,
            output_tokens: 350,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          }
        : undefined,
  };
}

/** Generate mock messages spanning 3 days */
function generateMockMessages() {
  const messages = [];
  let prevUuid: string | undefined;

  // Day 1: March 7
  const day1Pairs = [
    ["프로젝트 구조를 분석해줘", "프로젝트 구조를 분석하겠습니다. src/ 디렉토리 아래에 components, hooks, store, utils가 있습니다."],
    ["컴포넌트 목록을 보여줘", "주요 컴포넌트는 MessageViewer, ProjectTree, SettingsManager 등이 있습니다."],
    ["테스트는 어떻게 되어있어?", "현재 Vitest를 사용하고 있으며, src/test/ 디렉토리에 테스트 파일이 있습니다."],
  ];

  for (let i = 0; i < day1Pairs.length; i++) {
    const [userMsg, assistantMsg] = day1Pairs[i]!;
    const hour = 10 + i;
    const userM = makeMessage("user", userMsg!, `2026-03-07T${String(hour).padStart(2, "0")}:${String(i * 15).padStart(2, "0")}:00.000Z`, prevUuid);
    messages.push(userM);
    const assistantM = makeMessage("assistant", assistantMsg!, `2026-03-07T${String(hour).padStart(2, "0")}:${String(i * 15 + 2).padStart(2, "0")}:00.000Z`, userM.uuid);
    messages.push(assistantM);
    prevUuid = assistantM.uuid;
  }

  // Day 2: March 8
  const day2Pairs = [
    ["i18n 설정 방법을 알려줘", "react-i18next를 사용하고 있습니다. src/i18n/locales/ 아래에 5개 언어가 있습니다."],
    ["새로운 키를 추가하려면?", "각 locale 폴더의 해당 namespace JSON 파일에 키를 추가하고, generate:i18n-types를 실행하세요."],
    ["빌드 명령어가 뭐야?", "just dev로 개발 모드, just tauri-build로 프로덕션 빌드를 할 수 있습니다."],
    ["ESLint 설정은?", "TypeScript ESLint를 사용하고 있으며, no-explicit-any가 활성화되어 있습니다."],
  ];

  for (let i = 0; i < day2Pairs.length; i++) {
    const [userMsg, assistantMsg] = day2Pairs[i]!;
    const hour = 9 + i * 2;
    const userM = makeMessage("user", userMsg!, `2026-03-08T${String(hour).padStart(2, "0")}:30:00.000Z`, prevUuid);
    messages.push(userM);
    const assistantM = makeMessage("assistant", assistantMsg!, `2026-03-08T${String(hour).padStart(2, "0")}:32:00.000Z`, userM.uuid);
    messages.push(assistantM);
    prevUuid = assistantM.uuid;
  }

  // Day 3: March 10 (today)
  const day3Pairs = [
    ["오늘 할 일 정리해줘", "Issue #170 날짜 표시 개선 작업을 진행합니다. 날짜 구분선과 floating overlay를 추가합니다."],
    ["구현 시작해줘", "Phase 1부터 시작하겠습니다. time.ts에 formatDateDivider 함수를 추가합니다."],
    ["잘 동작하는지 확인해봐", "TypeScript 빌드, ESLint, i18n 검증 모두 통과했습니다."],
  ];

  for (let i = 0; i < day3Pairs.length; i++) {
    const [userMsg, assistantMsg] = day3Pairs[i]!;
    const hour = 14 + i;
    const userM = makeMessage("user", userMsg!, `2026-03-10T${String(hour).padStart(2, "0")}:00:00.000Z`, prevUuid);
    messages.push(userM);
    const assistantM = makeMessage("assistant", assistantMsg!, `2026-03-10T${String(hour).padStart(2, "0")}:02:00.000Z`, userM.uuid);
    messages.push(assistantM);
    prevUuid = assistantM.uuid;
  }

  return messages;
}

const MOCK_MESSAGES = generateMockMessages();

const MOCK_SESSION = {
  session_id: "mock-session-001",
  actual_session_id: "mock-session-001",
  project_name: "mock-project",
  file_path: "/mock/.claude/projects/-Users-mock-projects-mock-project/mock-session.jsonl",
  message_count: MOCK_MESSAGES.length,
  first_message_time: "2026-03-07T10:00:00.000Z",
  last_message_time: "2026-03-10T16:02:00.000Z",
  last_modified: "2026-03-10T16:02:00.000Z",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
};

const MOCK_PROJECT = {
  name: "mock-project",
  path: "/mock/.claude/projects/-Users-mock-projects-mock-project",
  actual_path: "/Users/mock/projects/mock-project",
  session_count: 1,
  message_count: MOCK_MESSAGES.length,
  last_modified: "2026-03-10T16:02:00.000Z",
  provider: "claude",
};

/** API route handlers */
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_claude_folder_path: () => "/mock/.claude",
  validate_claude_folder: () => true,
  scan_projects: () => [MOCK_PROJECT],
  scan_all_projects: () => [MOCK_PROJECT],
  detect_providers: () => [{ id: "claude", name: "Claude Code", is_available: true, session_count: 1 }],
  load_project_sessions: () => [MOCK_SESSION],
  load_provider_sessions: () => [MOCK_SESSION],
  load_session_messages: () => MOCK_MESSAGES,
  load_provider_messages: () => MOCK_MESSAGES,
  search_messages: () => [],
  get_session_token_stats: () => ({
    total_input_tokens: 12000,
    total_output_tokens: 3500,
    total_cache_creation: 0,
    total_cache_read: 0,
    message_count: MOCK_MESSAGES.length,
    model_breakdown: {},
  }),
  get_project_token_stats: () => ({
    sessions: [],
    total_sessions: 0,
    page: 1,
    page_size: 20,
  }),
  get_project_stats_summary: () => ({
    total_sessions: 1,
    total_messages: MOCK_MESSAGES.length,
    total_input_tokens: 12000,
    total_output_tokens: 3500,
    date_range: { start: "2026-03-07", end: "2026-03-10" },
  }),
  get_global_stats_summary: () => ({
    total_projects: 1,
    total_sessions: 1,
    total_messages: MOCK_MESSAGES.length,
  }),
  get_session_comparison: () => [],
  get_recent_edits: () => [],
  load_mcp_presets: () => [],
  load_presets: () => [],
  get_all_mcp_servers: () => [],
  load_metadata: () => ({}),
  save_metadata: () => ({}),
  load_user_metadata: () => ({ version: 1, sessions: {}, projects: {}, settings: {} }),
  save_user_metadata: () => ({}),
  load_settings: () => null,
  save_settings: () => ({}),
  load_session_metadata: () => ({}),
  save_session_metadata: () => ({}),
  rename_session_native: () => ({}),
  read_text_file: () => "",
};

export function mockApiPlugin(): Plugin {
  return {
    name: "mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          next();
          return;
        }

        const command = req.url.replace("/api/", "").split("?")[0]!;
        const handler = handlers[command];

        if (!handler) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown command: ${command}` }));
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const args = body ? (JSON.parse(body) as Record<string, unknown>) : {};
            const result = handler(args);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}
