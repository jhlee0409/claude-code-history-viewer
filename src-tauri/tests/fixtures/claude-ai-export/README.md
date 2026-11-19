# claude.ai account export fixture (#674)

Synthetic files in the shape of the claude.ai account export (Settings →
Privacy → Export data). **No account data**: every uuid, name, text and the
`user@example.com` address are invented for these tests.

Shape sources (public documentation, read 2026-11-18):

- Anthropic, "Export your Claude data":
  <https://support.claude.com/en/articles/9450526-export-your-claude-data> —
  the export is a zip of conversation and user data, without uploaded files.
- WhyChose, "Claude Conversation Export Format — Field Reference":
  <https://whychose.com/seo/claude-conversation-export-format> — conversation
  fields (`uuid`, `name`, `summary`, `model`, `created_at`, `updated_at`,
  `project_uuid`, `current_leaf_message_uuid`, `chat_messages`) and message
  fields (`uuid`, `text`, `content[]`, `sender`, `created_at`, `stop_reason`,
  `attachments`, `files`, `files_v2`, `parent_message_uuid`).
- samvsnvsn/chatgpt-claude-export-to-markdown, `chat_export/loaders.py`:
  <https://github.com/samvsnvsn/chatgpt-claude-export-to-markdown> — content
  block types (`text`, `thinking`, `tool_use`, `tool_result`), `project` as an
  object with `uuid`, attachment `file_name` / `extracted_content`, and
  `projects.json` `{uuid, name}`.

Cases covered by `conversations.json`: a plain chat; a Project conversation
with thinking, a search `tool_use`/`tool_result` (with ids and `knowledge`
items), an id-less artifact call/result pair, an attachment and an upload
listed in both `files` and `files_v2`; an edited conversation whose
`current_leaf_message_uuid` selects one branch; an older text-only
conversation (`+00:00` offsets, no `content`, no model) in a Project missing
from `projects.json`; a non-object entry; and an empty draft.
