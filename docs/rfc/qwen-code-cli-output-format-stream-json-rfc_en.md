# RFC: Qwen-Code CLI Output Formats and IPC Stream JSON Capability

- **Status**: Draft
- **Last Updated**: 2025-10-13
- **Author**: x22x22
- **Tracking**: <https://github.com/QwenLM/qwen-code/issues/795>

## Summary

This RFC defines structured input/output capabilities at the CLI layer so that third-party systems can integrate with Qwen-Code programmatically and reliably. The key change is to add `--input-format/--output-format` (`text` / `stream-json` / `stream-chunk-json`) to the existing CLI, together with a symmetric structured-input protocol, JSON Lines output, error semantics, session metadata, and a staged rollout plan. These capabilities form the foundation for the IPC SDK, third-party backend services, UI components, and multilingual SDKs, directly addressing issue #795 (“provide `--input-format/--output-format json/stream-json`”) while staying consistent with the current architecture.

## Background

### Overview of Issue 795

Community members—referencing Claude Code—requested that the Qwen-Code CLI expose `--input-format/--output-format json/stream-json`, allowing third-party programs to consume CLI output automatically without UI intervention.

### Integration Scenarios

1. **Task-level orchestration with intermediate processing**: the SDK sends prompts one by one, receives multiple responses, post-processes them, and only then returns information to end-users.
2. **Task-level streaming to end-users**: the SDK streams intermediate responses directly to users in real time.
3. **In-place command shortcuts**: typing `/`, `@`, or `?` inside the input field must behave exactly as it does in the TUI.
4. **Terminal simulation**: a web UI (e.g., based on xterm.js) mirrors terminal output, while the input box remains separate from the terminal display.

### Integration Workflow

1. Third-party applications rely on future language-specific “qwen-code-agent-sdk” implementations.
2. Each SDK launches the “qwen code” binary as a subprocess and performs bidirectional IPC over stdio.
3. The SDK consumes results emitted by “qwen code”.
4. The host application retrieves these results from the SDK.

### Current Pain Points

1. The CLI only emits human-oriented plain-text STDOUT, which is brittle for programmatic consumption.
2. There is no symmetric structured-input protocol, making advanced automation hard to build.

## Design Goals

1. Offer configurable output formats in the CLI while keeping the default behavior backward compatible.
2. Implement a JSON Lines streaming protocol that matches the IPC SDK’s message semantics and control protocol.
3. Provide symmetric structured-input capabilities so the SDK can write prompts and control messages to STDIN.
4. Define schemas and error semantics that can be shared across languages.
5. Ensure the design is friendly to the future qwen-code-agent-sdk implementations.

## Non-Goals

- The SDK implementation itself is out of scope for this RFC.

## Solution Overview

### CLI Flags

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--input-format` | `text` / `stream-json` | `text` | Controls how STDIN is parsed. |
| `--output-format` | `text` / `stream-json` / `stream-chunk-json` | `text` | Controls how STDOUT is emitted. |
| *(Automatic)* |  |  | When either format is `stream-json` or `stream-chunk-json`, the CLI disables the TUI and switches to structured mode. Only `text` mode preserves the original TUI. **Communication still occurs through standard input/output; no additional channels are introduced.** |

The CLI help text will document these flags. `text` mode retains the existing experience for full backward compatibility; no extra `--stdio` toggle is needed.

### Output Semantics

1. **`text` (compatibility mode)**  
   - Matches the current STDOUT behavior for human users.  
   - Structured semantics are not guaranteed and will eventually be marked “manual use only”.

2. **`stream-json` (message-level JSON Lines)**  
   - Each line is an object compatible with OpenAI’s `/chat/completions` response format (`object = "chat.completion"`).  
   - A single run emits, in order: an initialization receipt (capabilities), each assistant/tool message, and a final summary object.  
   - Example:
     ```json
     {"object":"chat.completion","id":"chatcmpl-session-123","created":1739430000,"model":"qwen-coder","choices":[{"index":0,"message":{"role":"assistant","content":"Running analysis...","tool_calls":null},"finish_reason":"stop"}],"usage":{"prompt_tokens":1200,"completion_tokens":80,"total_tokens":1280}}
     {"object":"chat.completion","id":"chatcmpl-session-123","created":1739430002,"model":"qwen-coder","choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"tool-1","type":"function","function":{"name":"edit_file","arguments":"..."}}]},"finish_reason":"tool_calls"}]}
     {"object":"chat.completion","id":"chatcmpl-session-123","created":1739430010,"model":"qwen-coder","choices":[{"index":0,"message":{"role":"assistant","content":"Fix complete. Files updated."},"finish_reason":"stop"}],"usage":{"prompt_tokens":1600,"completion_tokens":200,"total_tokens":1800}}
     ```
   - Still emitted as JSONL so backend services and SDKs can consume messages incrementally.

3. **`stream-chunk-json` (incremental JSON Lines)**  
   - Follows OpenAI’s streaming format; each line is a `chat.completion.chunk`. `choices[].delta` carries token/chunk diffs, and a single `id` spans the entire conversation.  
   - The CLI first declares the role via an empty `delta: {}` chunk, streams incremental content and tool-call payloads, and ends with a chunk containing only `finish_reason` (plus optional `usage`).  
   - Example:
     ```json
     {"object":"chat.completion.chunk","id":"chatcmpl-session-123","created":1739430000,"model":"qwen-coder","choices":[{"index":0,"delta":{"role":"assistant"}}]}
     {"object":"chat.completion.chunk","id":"chatcmpl-session-123","created":1739430001,"model":"qwen-coder","choices":[{"index":0,"delta":{"content":"Running"}},{"index":1,"delta":{"content":""}}]}
     {"object":"chat.completion.chunk","id":"chatcmpl-session-123","created":1739430001,"model":"qwen-coder","choices":[{"index":0,"delta":{"content":" analysis..."},"finish_reason":null}]}
     {"object":"chat.completion.chunk","id":"chatcmpl-session-123","created":1739430003,"model":"qwen-coder","choices":[{"index":0,"delta":{"tool_calls":[{"id":"tool-1","type":"function","function":{"name":"edit_file","arguments":"..."}}]}}]}
     {"object":"chat.completion.chunk","id":"chatcmpl-session-123","created":1739430008,"model":"qwen-coder","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}}
     {"object":"chat.completion.chunk","id":"chatcmpl-session-123","created":1739430008,"model":"qwen-coder","usage":{"prompt_tokens":1600,"completion_tokens":200,"total_tokens":1800},"choices":[]}
     ```
   - A separate full `chat.completion` is **not** emitted at the end; the final chunk holds the `finish_reason` and optional `usage` (consistent with OpenAI’s `/chat/completions`).

#### Consumption Patterns

- **Message-level JSONL (`stream-json`)** suits agent servers or wrappers that need stable staging outputs. This is the default and remains compatible with existing JSONL tooling.
- **Incremental chunks (`stream-chunk-json`)** suit IDEs or UI components that stream tokens progressively. SDKs must watch `chat.completion.chunk`, handle incremental content, and finalize on `finish_reason`.
- **Terminal simulation**: Regardless of the CLI’s original mode, SDKs can consume both `chat.completion` and `chat.completion.chunk`. For CLI scenarios, `stream-json` / `stream-chunk-json` must encode everything that TUI mode prints (plain text, ANSI/Vt100 control, tool hints, exit codes, etc.) via `choices[].message.content`, `choices[].delta.content`, and `choices[].delta.annotations` (e.g., `{"type":"x-qwen-ansi","value":"\u001b[32m"}`) so that xterm.js-like frontends can reproduce color, cursor navigation, and incremental output without relying on the legacy `text` mode.

### Frontend Terminal Annotations (`annotations`)

`packages/cli/src/nonInteractiveCli.ts` together with `packages/cli/src/ui/utils/ConsolePatcher.ts` governs textual output. Model content is appended to STDOUT via `GeminiEventType.Content`; tool execution status/errors/logs are emitted through `ConsolePatcher`; structured tool results (`ToolResultDisplay`, etc.) drive UI rendering. To ensure `stream-json` / `stream-chunk-json` preserves all information, we extend OpenAI’s `annotations` with custom types:

| Annotation Type | Purpose | Code Source |
|-----------------|---------|-------------|
| `x-qwen-terminal` | Terminal channel/style + ANSI/Vt100 metadata | `process.stdout/stderr` interception (`nonInteractiveCli.ts`, `ConsolePatcher`) |
| `x-qwen-tool-display` | Structured tool execution/result data | `ToolResultDisplay` / `ToolCallStatus` (`packages/core/src/tools/tools.ts`, `packages/cli/src/ui/hooks/useReactToolScheduler.ts`) |
| `x-qwen-thought` | `GeminiEventType.Thought` reasoning summaries | `packages/core/src/core/turn.ts` |
| `x-qwen-session-event` | Human-readable session events (`Finished`, `ChatCompressed`, etc.) | `packages/core/src/core/turn.ts`, `useGeminiStream.ts` |

#### `x-qwen-terminal`

```json
{
  "type": "x-qwen-terminal",
  "channel": "stdout",
  "source": "assistant",
  "spans": [
    {
      "start_index": 0,
      "end_index": 5,
      "style": {
        "theme_token": "AccentGreen",
        "bold": false
      }
    }
  ],
  "ansi": [
    {"offset": 0, "sequence": "\u001b[32m"},
    {"offset": 5, "sequence": "\u001b[0m"}
  ]
}
```

- `channel`: `stdout` / `stderr` (logs and errors captured by `ConsolePatcher` are marked `stderr` with an additional `console_level`).
- `source`: `assistant` (model output), `tool` (tool streaming output/results), `console` (`console.*` calls), `system` (startup/shutdown/fatal errors).
- `spans.style.theme_token`: reuse theme tokens (e.g., `AccentGreen`, `DiffAdded`) defined in `packages/cli/src/ui/colors.ts` and theme files. Third parties can map them to their own palettes.
- `ansi`: raw ANSI escape sequences with offsets so xterm.js can replay them. Empty if no ANSI control is present.
- Extra fields:
  - `console_level`: present when `source = console`, indicating `log`, `warn`, `error`, `info`, or `debug`.
  - `exit_code`: included when `source = system` and the process finishes.
  - `prompt_id`: links terminal output to a specific user turn (`nonInteractiveCli.ts`).

> Example: `packages/cli/index.ts` emits `FatalError` in red. In `stream-chunk-json`, this becomes `delta.content:"Configuration missing"` and `annotations:[{type:"x-qwen-terminal",channel:"stderr",source:"system",ansi:[...]}]`.

#### `x-qwen-tool-display`

```json
{
  "type": "x-qwen-tool-display",
  "tool_call_id": "call_tool-1",
  "session_id": "session-123",
  "status": "executing",
  "result_display": {
    "kind": "file_diff",
    "file_name": "src/main.py",
    "diff": "--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1 @@\n-print('Hi')\n+print('Hello')",
    "original": "print('Hi')\n",
    "modified": "print('Hello')\n",
    "stat": {
      "ai_added_lines": 1,
      "ai_removed_lines": 1,
      "user_added_lines": 0,
      "user_removed_lines": 0
    }
  }
}
```

- `status`: corresponds to `ToolCallStatus` (`Pending`, `Executing`, `Success`, `Error`, `Canceled`, `Confirming`) from `packages/cli/src/ui/types.ts`.
- `tool_call_id`: reuses the OpenAI field name; combined with `session_id`, uniquely identifies a call. In test or sessionless modes, `tool_call_id` alone is acceptable.
- `result_display` (union):
  - `kind: "string"` → `{ "text": "Captured stdout..." }`.
  - `kind: "file_diff"` → Git-style diff metadata.
  - `kind: "todo_list"` → `{ "todos": [{id, content, status}] }`.
  - `kind: "plan_summary"` → `{ "message": "...", "plan_markdown": "..."}`
  - `kind: "task_execution"` → mirrors `TaskResultDisplay` (with `subagentName`, `status`, `toolCalls`, etc.).
- `confirmation`: when `ToolCallConfirmationDetails` awaits user approval (`edit`, `exec`, `mcp`, `info`, `plan`), include relevant payloads (diffs, commands, prompts) so third parties can render dialogs.
- `pending`: indicates the call is still `validating`/`scheduled` and not yet running.
- `timestamp`: optional millisecond timestamp for ordering (`useReactToolScheduler`).

#### `x-qwen-thought`

```json
{
  "type": "x-qwen-thought",
  "subject": "Analyzing repo",
  "description": "Listing tsconfig patterns..."
}
```

- Mirrors reasoning summaries from `GeminiEventType.Thought` (`packages/core/src/core/turn.ts`), shown as “thinking” tips in the UI.

#### `x-qwen-session-event`

- Conveys session-level events (`Finished`, `ChatCompressed`, `SessionTokenLimitExceeded`, etc.) as human-readable messages.

```json
{
  "type": "x-qwen-session-event",
  "event": "MAX_TOKENS",
  "message": "Response truncated due to token limits.",
  "metrics": {
    "original_tokens": 12000,
    "compressed_tokens": 8000
  }
}
```

`event` values derive from `GeminiEventType`. `message` matches the UI copy built in `useGeminiStream.ts`. When a user or integration issues ESC cancellation, the CLI must emit `event: "USER_CANCELLED"` together with `message: "User cancelled the request."` to stay aligned with the TUI UX.

#### `x-qwen-ansi`

- Carries raw ANSI strings (colors, cursor movement, etc.) so terminal simulations can replay them exactly.

```json
{"type": "x-qwen-ansi", "value": "\u001b[?2004l"}
```

> This is used when the CLI exits and restores terminal modes.

### Input Semantics (Qwen Session Protocol)

> Transport stays identical to today’s CLI: structured input is still newline-terminated JSON strings sent to STDIN. The CLI selects a parser based on `--input-format`. This mirrors `@anthropics/claude-agent-sdk-python`’s `SubprocessCLITransport`, which writes each message as `json.dumps(...) + "\n"` in streaming mode.

- **`text`**: unchanged; STDIN is treated as natural language and the legacy TUI behavior is preserved.
- **`stream-json` / `stream-chunk-json`**: the CLI expects each line to follow the **Qwen Chat Request** protocol. It borrows from OpenAI’s `/chat/completions`, but callers only send incremental input rather than the full conversation. The CLI maintains context using the session ID and its internal `GeminiChat` history (`GeminiChat.sendMessageStream`).

#### Qwen Chat Request Structure

```jsonc
{
  "session_id": "session-123",          // Required; generated or reused by the CLI/SDK
  "prompt_id": "session-123########7",  // Optional; auto-generated if omitted; reuse when tied to tool calls
  "model": "qwen-coder",               // Optional; defaults to the current session model
  "input": {
    "origin": "user",                  // user | tool_response | system
    "parts": [                         // Matches @google/genai PartListUnion
      {"type": "text", "text": "Please fix the bug in @main.py"}
    ],
    "command": null                    // Optional; explicit slash/@ command descriptor (see below)
  },
  "options": {
    "temperature": 0.2,
    "tool_overrides": ["EditTool"]
  }
}
```

- `session_id`: maps to `config.getSessionId()` and is the primary key for all conversation state. Third parties can ask the CLI to create a new session or reuse the one generated by the TUI.
- `prompt_id`: identifies a single user turn or tool continuation. A single `prompt_id` can span multiple tool calls. The CLI defaults to `<session_id>########<turn>`; custom formats must stay unique.
- `input.origin`:
  - `user`: regular user input (typically a list of `{"type":"text"}` parts).
  - `tool_response`: used when third parties feed tool results back to the model. Include `{"type":"function_response","function_response":{...}}` in `parts` and provide `tool_call_id`.
  - `system`: CLI control messages (e.g., slash commands that restore history). Third parties only use this for system-level injections.
- `input.parts`: may include `text`, `function_response`, `file_data`, etc., as supported by `@google/genai`. When `origin = "user"`, the CLI concatenates text parts to reuse legacy TUI semantics (`prepareQueryForGemini`).
- `options`: per-request overrides (model, sampling, tool restrictions). Defaults come from the active config.
- Additional fields:
  - `tool_call_id`: required for `origin = "tool_response"` to correlate with outgoing `tool_call_id`s (`CoreToolScheduler`).
  - `continuation`: mirrors `submitQuery(..., { isContinuation: true })`; by default the CLI infers it from `origin`.
  - `tool_request`: optional object reflecting `ToolCallRequestInfo` (`args`, `isClientInitiated`, `prompt_id`, etc.), letting third parties reuse CLI scheduling (parallel tools, subagents). If omitted, the CLI infers it.

#### Session Control

- If `session_id` is absent or set to `"_new"`, the CLI creates a new session and returns the actual ID in the first response.
- `input.origin="system"` with `{"type":"instruction","text":"/clear"}` clears history (equivalent to `/clear`).
- `prompt_id` plus `tool_call_id` prevent concurrency conflicts: both `CoreToolScheduler` and subagents rely on `callId`, so third parties must retain these identifiers when sending tool results.

#### Slash and `@` Commands

In text mode, the TUI automatically parses slash commands and `@` references:

- Slash (`/` or `?`) commands are handled by `useSlashCommandProcessor`, triggering built-in commands, subcommands, and tool scheduling.
- `@` references are handled by `handleAtCommand`, using file services plus `read_many_files`, `glob`, etc., to enrich user prompts.

The structured protocol preserves the same semantics:

1. **Implicit mode**: if `origin="user"` and the first text part starts with `/` or `?`, the CLI invokes the slash flow. Unescaped `@` strings trigger `handleAtCommand`, which pre-processes file references before calling the model.
2. **Explicit mode (recommended)**: describe commands in `input.command` to avoid parsing raw strings:
   ```jsonc
   {
     "session_id": "session-123",
     "input": {
       "origin": "user",
       "parts": [{"type": "text", "text": "/chat list"}],
       "command": {
         "kind": "slash",
         "path": ["chat", "list"],
         "args": ""
       }
     }
   }
   ```
   - `kind`: `slash` or `at`.
   - `path`: for slash commands, the command path array (equivalent to `commandPath`); omitted for `at`.
   - `args`: remaining argument string.
   - `references`: optional when `kind="at"` to pre-resolve references (e.g., `{"original":"@foo","resolved":"./src/foo.ts"}`); if omitted, the CLI falls back to implicit parsing.

Example of explicit file references:

```jsonc
{
  "session_id": "session-123",
  "input": {
    "origin": "user",
    "parts": [{"type": "text", "text": "Please review @src/main.py"}],
    "command": {
      "kind": "at",
      "references": [
        {"original": "@src/main.py", "resolved": "src/main.py"}
      ]
    }
  }
}
```

#### SDK Coordination for Commands

`useSlashCommandProcessor` may return many actions (messages, dialogs, tool calls, prompt submissions, history loading, quit flows, etc.). In structured mode, these are sent via `action`, and the SDK must interpret them locally—invoking dialogs, approving operations, resubmitting prompts, and so forth—to match the TUI experience.

| `command.result.type` | Description | SDK Guidance |
|-----------------------|-------------|--------------|
| `handled` | Already completed inside the CLI | No action needed |
| `message` | Informational or error text | Show notification |
| `dialog` (`auth`, `theme`, `editor`, `privacy`, `settings`, `model`, `subagent_create`, `subagent_list`, `help`) | Requires UI | Render appropriate dialog/page |
| `tool` | Trigger a tool call | Convert `tool_request` or command args into a tool invocation, send to CLI, monitor results |
| `submit_prompt` | Immediately send parts to the model | Submit as the next `input.parts`, set `continuation=true` |
| `load_history` | Replace conversation history | Use CLI APIs or reload UI history |
| `quit` / `quit_confirmation` | Exit flow | Control host lifecycle and optionally request CLI shutdown |
| `confirm_shell_commands` | Confirm shell commands | Prompt user; on approval, resend with `approvedCommands` / `confirmationOutcome` |
| `confirm_action` | Confirm non-shell actions | Same as above with appropriate UI |

The SDK should expose a unified command API that maps user input to `command` descriptors, processes `action`, and, when required, sends follow-up requests so that behavior matches the TUI.

If `resolved` values are supplied, the CLI uses them directly to read files; otherwise it falls back to `handleAtCommand`.

#### STDIN Command Responses

- When `--input-format = stream-json`, the CLI must respond instantly to `/`, `?`, and `@` commands received via STDIN, using the same parsing logic (`useSlashCommandProcessor`, `handleAtCommand`).
- After parsing, the CLI emits structured responses such as:
  ```jsonc
  {
    "type": "result/command",
    "session_id": "session-123",
    "prompt_id": "session-123########8",
    "command": {
      "kind": "slash",
      "path": ["chat", "list"],
      "args": ""
    },
    "result": {
      "type": "message",
      "level": "info",
      "content": "Current session contains 3 saved checkpoints."
    }
  }
  ```
  The `result` field uses the same `command.result.type` enumeration, enabling SDKs to drive UI or follow-up requests immediately.
- If a command triggers further model interaction (e.g., `/submit`, `@file` expansion), subsequent `assistant` / `tool_call` / `result` messages follow in the same order and with the same session metadata as the TUI, allowing pure text input + JSON output to reproduce the full experience.

#### Real-Time Command Hints

- Structured mode must support “character-triggered hints”: when users type `/`, `@`, or `?` without pressing Enter, integrators send a **Command Hint Request**, and the CLI responds without touching conversation history.
- Slash request example (`/c`):
  ```jsonc
  {
    "type": "command_hint_request",
    "session_id": "session-123",
    "prompt_id": "session-123########preview",
    "trigger": "slash",
    "text": "/c",
    "cursor": 2,
    "context": {
      "cwd": "/workspace/demo",
      "selected_text": ""
    }
  }
  ```
- Slash response example (built-in commands starting with `c`):
  ```jsonc
  {
    "type": "result/command_hint",
    "session_id": "session-123",
    "prompt_id": "session-123########preview",
    "trigger": "slash",
    "status": "ok",
    "suggestions": [
      {"label": "chat", "value": "chat", "description": "Manage conversation history."},
      {"label": "clear", "value": "clear", "description": "Clear the screen and conversation history"},
      {"label": "compress", "value": "compress", "description": "Compresses the context by replacing it with a summary."},
      {"label": "copy", "value": "copy", "description": "Copy the last result or code snippet to clipboard"},
      {"label": "corgi", "value": "corgi", "description": "Toggles corgi mode."}
    ],
    "metadata": {"is_perfect_match": false}
  }
  ```
- `@` request example (`@src/co`):
  ```jsonc
  {
    "type": "command_hint_request",
    "session_id": "session-123",
    "prompt_id": "session-123########preview",
    "trigger": "at",
    "text": "@src/co",
    "cursor": 7,
    "context": {
      "cwd": "/workspace/demo",
      "selected_text": ""
    }
  }
  ```
- `@` response example (from `useAtCompletion` file search):
  ```jsonc
  {
    "type": "result/command_hint",
    "session_id": "session-123",
    "prompt_id": "session-123########preview",
    "trigger": "at",
    "status": "ok",
    "suggestions": [
      {"label": "src/components/", "value": "src/components/"},
      {"label": "src/components/Button.tsx", "value": "src/components/Button.tsx"},
      {"label": "src/components/Button with spaces.tsx", "value": "src/components/Button\\ with\\ spaces.tsx"}
    ],
    "metadata": {"is_perfect_match": false}
  }
  ```
- `?` request example (`/?`, alias of `/help`):
  ```jsonc
  {
    "type": "command_hint_request",
    "session_id": "session-123",
    "prompt_id": "session-123########preview",
    "trigger": "slash",
    "text": "/?",
    "cursor": 2,
    "context": {
      "cwd": "/workspace/demo",
      "selected_text": ""
    }
  }
  ```
- `?` response example (alias resolved to `help`):
  ```jsonc
  {
    "type": "result/command_hint",
    "session_id": "session-123",
    "prompt_id": "session-123########preview",
    "trigger": "slash",
    "status": "ok",
    "suggestions": [
      {"label": "help", "value": "help", "description": "For help on Qwen Code", "matchedIndex": 0}
    ],
    "metadata": {"is_perfect_match": true}
  }
  ```
- `suggestions` reuse the TUI’s `Suggestion` type. `status="loading"` indicates the CLI is still preparing data (e.g., `useAtCompletion` initializing file search); `error` includes a `message`.
- The CLI reuses `useSlashCompletion` / `useAtCompletion` internally. These requests are not added to conversation history; `prompt_id` can carry an `_preview` suffix and is echoed back.
- Integrators may resend `command_hint_request` whenever the text or cursor changes. The CLI should throttle and return the latest result. Sending `{ "type": "command_hint_cancel", ... }` stops long-running searches.

#### Logging Strategy

- The CLI still intercepts `console.log` / `warn` / `error` via `ConsolePatcher` and emits `x-qwen-terminal` annotations with `channel="stderr"`, `source="console"`, and `console_level`.
- To ease filtering, structured mode can add `annotations[].log_scope` (values such as `system`, `tool`, `debug`), mirroring the levels defined by `ConfigLogger` (`packages/cli/src/config/config.ts`).
- Tool-generated logs continue to flow through `ToolResultDisplay`; if finer filtering is needed, `result_display` entries may include `log_scope`.

#### Heartbeat / Keepalive

- A separate event channel—similar to command hints—avoids polluting conversation history:
  - Integrators may periodically send `{"type":"heartbeat_request","session_id":"session-123"}` (optionally with `prompt_id`).
- The CLI responds with `{"type":"result/heartbeat","session_id":"session-123","status":"ok","ts":1739430123}`; it may also push such events proactively.
- If no heartbeat response arrives within an agreed window (e.g., 10 seconds), integrators can assume the subprocess is stuck and restart it.
- `@third-party/anthropics/claude-agent-sdk-python` currently lacks a heartbeat mechanism, so the CLI/SDK must implement it themselves in P1.1, defining default intervals, timeouts, and whether SDKs can customize the cadence.

#### Real-Time Interrupts (Escape Command)

- Structured mode must expose the same “cancel current response” capability as the TUI. In the TUI, `useGeminiStream.ts` listens for the Escape key and invokes `cancelOngoingRequest`, which aborts the `AbortController`, records an `ApiCancelEvent`, flushes any `pendingHistoryItem`, and pushes “Request cancelled.” into history.
- Integrations can trigger the identical behavior at any time by writing this control message to STDIN:
  ```jsonc
  {
    "type": "control/cancel",
    "session_id": "session-123",
    "prompt_id": "session-123########8",
    "reason": "escape"
  }
  ```
  - `session_id`: required; identifies which session to cancel.
  - `prompt_id`: optional; if present the CLI cancels only when that prompt is currently in `Responding` / `WaitingForConfirmation`. If omitted, the most recent in-flight request is cancelled.
  - `reason`: reserved enum; currently must be `"escape"` but can later expand to values like `"keyboard_interrupt"` or `"timeout"`.
- CLI obligations:
  - When a cancellable stream is active, reuse the same `cancelOngoingRequest` pipeline: call `AbortController.abort()`, emit the `ApiCancelEvent`, flush `pendingHistoryItem`, and reset completion state.
  - Immediately write `{"type":"result/cancel","session_id":"session-123","prompt_id":"session-123########8","status":"ok","message":"Request cancelled."}` to STDOUT so SDKs can refresh their UI.
  - When the underlying stream yields `GeminiEventType.UserCancelled`, also send `{"type":"x-qwen-session-event","event":"USER_CANCELLED","message":"User cancelled the request."}` to announce the interruption.
  - If nothing is running, respond with `{"type":"result/cancel","session_id":"session-123","status":"noop"}` and take no further action.
- Double-Escape clearing of the input buffer remains a local UX feature; integrations can mimic it client-side without involving the CLI.

#### Bidirectional Control Channel

- **Current state**: `third-party/qwen-code` only supports one-way output (CLI → STDOUT). Confirmations and dialogs are handled inside the TUI; no `control_request` / `control_response` hook exists like Claude Code.
- **Design requirement**: To reach TUI parity (command confirmations, sensitive-operation approvals, subagent orchestration, etc.), the protocol must adopt the same “out-of-band event + STDIN response” approach used for hints/heartbeats, enabling true bidirectional control.
  - When the CLI requires input, it emits `{"type":"control_request","session_id":"session-123","request_id":"req-1","request":{"subtype":"confirm_shell_commands",...}}`.
  - Third-party apps respond via STDIN with `{"type":"control_response","request_id":"req-1","response":{"subtype":"success","result":{"behavior":"approve"}}}`.  
  - These control events do not touch conversation history, staying in the same side channel as hints and heartbeats.
- **Covered scenarios**:
  - `/confirm_shell_commands`, `confirm_action`, `quit_confirmation`, and other flows requiring user decisions.
  - Tool permission checks (similar to `can_use_tool`), plan execution, or subagent coordination that needs external approval.
  - Future modal dialogs, forms, or authentication steps.
- **Fallback strategy**: If the control channel is unavailable, the CLI should enforce explicit defaults (e.g., deny risky actions, ask the user to switch back to TUI) and return clear errors in `result/command` to avoid silent failures.
- **Follow-up work**:
  1. Extend the RFC with JSON Schemas for `control_request` / `control_response` (borrowing from Claude Code).
  2. Refactor the CLI to share a unified control-dispatch layer so TUI and CLI reuse the same logic.
  3. Implement listeners and callbacks in the SDK, exposing hooks to host applications.

### JSON Schema and Version Negotiation

- Publish `docs/ipc/qwen-chat-request-schema.json` (maintained by SDK teams) as a “delta input” model inspired by OpenAI’s `/chat/completions`, keeping `model`, `tools`, etc., and adding `session_id`, `prompt_id`, `origin`, `tool_call_id`.
- The first `chat.completion` response can include metadata (or use `system_fingerprint`) describing `protocol_version`, `output_format`, `input_format`, and capabilities (e.g., support for `chat.completion.chunk`).
- If a caller requests unsupported features (e.g., `protocol_version=3`), the CLI returns a `chat.completion` where `choices[0].finish_reason="error"` and `usage`/`metadata.error` contain `unsupported_protocol`, then exits with a non-zero code.

### Error Semantics

- **Fatal errors**: emit OpenAI-style error objects and exit with a non-zero status.
  ```json
  {
    "error": {
      "message": "invalid tool input",
      "type": "invalid_request_error",
      "param": "tools[0].function.arguments",
      "code": "QWEN_INVALID_TOOL_ARGS"
    }
  }
  ```
- **Recoverable errors / task failures**: return a `chat.completion` with `choices[0].finish_reason = "stop"` (or `"tool_calls"`), describing the failure in `choices[0].message.content` or `metadata.error`, while the CLI stays healthy.
- **Control-protocol issues**: if a tool authorization or hook callback fails, the CLI embeds details in `metadata.control_errors`, letting SDKs decide to retry or abort.

## Security and Resource Management

- In `stream-json` mode the CLI still respects approval modes and tool allowlists.
- Until the control channel lands, sensitive actions that require confirmation should either be denied or prompt users to fall back to TUI mode; afterwards, `control_request` / `control_response` will allow SDKs/third parties to review them.
- Heartbeat support helps detect hung processes and reclaim resources promptly.

## Observability and Debugging

- SDKs or backend services should record the message stream for auditing and replay purposes.
- Example commands:

    ```bash
    echo '{"model":"qwen-coder","messages":[{"role":"user","content":"Hello"}]}' \
  | qwen --input-format stream-json --output-format stream-json

    echo '{"model":"qwen-coder","messages":[{"role":"user","content":"Greet me word by word"}]}' \
  | qwen --input-format stream-json --output-format stream-chunk-json
    ```
