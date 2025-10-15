# RFC: Qwen-Code CLI 结构化输入输出规范（整理版）

## 概览

| 字段 | 详情 |
| --- | --- |
| 状态 | Draft |
| 更新时间 | 2025-10-13 |
| 作者 | x22x22 |
| 追踪 | <https://github.com/QwenLM/qwen-code/issues/795> |
| 范围 | CLI 层 `--input-format/--output-format` 结构化协议、事件语义、错误规范与落地计划 |

- 目标是为第三方系统与多语言 Agent SDK 提供稳定、可编程的 IPC Stream JSON 能力。
- 协议保持与 TUI 相同的行为，补齐 JSON Lines 输出、对称输入以及控制通道，回应社区关于 `--input-format/--output-format json/stream-json` 的诉求。
- 文档聚焦 CLI 侧能力，不涵盖 SDK 内部设计。

## 目标与范围

| 类型 | 内容 |
| --- | --- |
| 设计目标 | 可配置输出格式、JSON Lines 流式协议、对称结构化输入、通用 schema、面向 SDK 友好化 |
| 非目标 | 描述 SDK 具体实现（另见 Agent 框架文档） |
| 核心痛点 | 仅有人机交互 STDOUT、缺少结构化输入、无法驱动自动化流程 |
| 场景示例 | SDK 分批发送 prompt 并处理多段响应；流式直传用户；`/`,`@`,`?` 指令与 TUI 对齐；xterm.js 前端分离输入与终端 |

## 接口总览

| 类别 | 关键项 | 说明 |
| --- | --- | --- |
| CLI 参数 | `--input-format`、`--output-format` | 取值 `text` / `stream-json` / `stream-chunk-json`，结构化模式自动禁用 TUI |
| 输出事件 | `chat.completion*`、`result/*`、`control_request` | 全部以 JSON Lines 逐行写入 STDOUT |
| 输入事件 | `*request`、`control_response`、Qwen Chat Request | JSON 行写入 STDIN，对称驱动 CLI 行为 |
| 通道语义 | 结果事件、请求事件、控制通道 | 明确回执要求，防止 CLI 阻塞 |
| 协议扩展 | 握手元数据、版本协商、错误语义 | 与 OpenAI `/chat/completions` 保持兼容扩展 |

- 通信仍使用标准输入输出，未引入额外套接字。
- `text` 模式保留原行为，结构化模式提供稳定 schema 与可观测字段。

## 输出格式语义

| 格式 | 适用场景 | 行为概要 | 兼容性 |
| --- | --- | --- | --- |
| `text` | 人机交互兼容模式 | 输出原有 TUI 文本 | 默认模式，后续标记为手动使用 |
| `stream-json` | 消息级 JSONL | 每行 `chat.completion`，含初始化回执、助手回复、工具调用、收尾摘要 | 对齐 OpenAI `/chat/completions` |
| `stream-chunk-json` | 增量 chunk JSONL | 每行 `chat.completion.chunk`，`choices[].delta` 承载 token/块增量 | 对齐 OpenAI 流式响应，覆盖完整会话 ID |

### `stream-json` 示例

```json
{"object":"chat.completion","id":"chatcmpl-session-123","created":1739430000,"model":"qwen-coder","choices":[{"index":0,"message":{"role":"assistant","content":"正在分析...","tool_calls":null},"finish_reason":"stop"}],"usage":{"prompt_tokens":1200,"completion_tokens":80,"total_tokens":1280}}
{"object":"chat.completion","id":"chatcmpl-session-123","created":1739430002,"model":"qwen-coder","choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"tool-1","type":"function","function":{"name":"edit_file","arguments":"..."}}]},"finish_reason":"tool_calls"}]}
{"object":"chat.completion","id":"chatcmpl-session-123","created":1739430010,"model":"qwen-coder","choices":[{"index":0,"message":{"role":"assistant","content":"修复完成，已更新文件。"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1600,"completion_tokens":200,"total_tokens":1800}}
```

### `stream-chunk-json` 行为要点

- 首行发送 `{"object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"}}]}` 声明角色。
- 按需输出文本 token、工具调用增量、`tool_calls` 更新。
- 最后一行包含 `{"choices":[{"delta":{},"finish_reason":"stop"}]}`，并在 `usage` 或 `metadata` 中附带总结。
- 可选 `annotations`、`spans` 字段详述终端样式（见下节）。

## 事件载荷与注解

| 类型 | 主要字段 | 用途 |
| --- | --- | --- |
| `chat.completion.chunk` 注解 | `annotations`、`spans` | 复刻终端风格、ANSI 控制、来源标记 |
| `x-qwen-terminal` | `channel`、`source`、`console_level`、`ansi` | 输出终端流（stdout/stderr/console/system） |
| `x-qwen-tool-display` | `tool_call_id`、`status`、`result_display` | 呈现工具 diff、字符串、TODO、计划摘要、任务执行等 |
| `x-qwen-thought` | `subject`、`description` | 展示思考中提示（GeminiEventType.Thought） |
| `x-qwen-session-event` | `event`、`message`、`metrics` | 会话级提示，如压缩、取消、token 限制 |

### 终端注解结构

```json
{
  "type": "x-qwen-terminal",
  "channel": "stdout",
  "source": "assistant",
  "spans": [
    {"start": 0, "end": 24, "style": {"theme_token": "AccentGreen"}}
  ],
  "ansi": [
    {"offset": 0, "code": "\u001b[32m"},
    {"offset": 24, "code": "\u001b[0m"}
  ],
  "console_level": "info",
  "exit_code": null,
  "prompt_id": "session-123########7"
}
```

- `channel`: `stdout` / `stderr`，控制台日志通过 `ConsolePatcher` 注入 `stderr` 与 `console_level`。
- `source`: `assistant`、`tool`、`console`、`system`；便于前端分层展示。
- `spans.style.theme_token`: 复用 CLI 主题 (`AccentGreen`、`DiffAdded` 等)。
- `ansi`: 原始 ANSI 序列位置，方便前端重放。
- `exit_code`: 当 `source=system` 且流程结束时给出退出码。
- `prompt_id`: 关联到具体回合。

### 工具结果展示

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
  },
  "confirmation": null,
  "pending": false,
  "timestamp": 1739430005
}
```

- `status` 取自 `ToolCallStatus`（`Pending`、`Executing`、`Success`、`Error`、`Canceled`、`Confirming`）。
- `result_display` 支持 `string`、`file_diff`、`todo_list`、`plan_summary`、`task_execution` 等 union。
- `confirmation` 描述待确认的 diff/命令/MCP 信息；`pending=true` 表示尚未执行。
- `timestamp` 用于排序，与 `useReactToolScheduler` 记录一致。

### 思考与会话事件

```json
{
  "type": "x-qwen-thought",
  "subject": "Analyzing repo",
  "description": "Listing tsconfig patterns..."
}
```

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

- `event` 取值来自 `GeminiEventType`，包括 `Finished`、`ChatCompressed`、`MaxSessionTurns`、`USER_CANCELLED` 等。
- `metrics` 可选地提供压缩前后 token 数等统计。

## 输入格式（Qwen 会话协议）

| 模式 | 行为 | 说明 |
| --- | --- | --- |
| `text` | 保留原始 TUI 文本输入 | 解析自然语言或命令行文本 |
| `stream-json` / `stream-chunk-json` | 采用 Qwen Chat Request | 每行 JSON 描述一次增量输入 |

### Qwen Chat Request 模式

```jsonc
{
  "session_id": "session-123",
  "prompt_id": "session-123########7",
  "model": "qwen-coder",
  "input": {
    "origin": "user",
    "parts": [
      {"type": "text", "text": "请修复 @main.py 的 bug"}
    ],
    "command": null
  },
  "options": {
    "temperature": 0.2,
    "tool_overrides": ["EditTool"]
  }
}
```

- `session_id`：会话主键（`config.getSessionId()`），传入 `"_new"` 可创建新会话。
- `prompt_id`：区分回合；默认格式 `<session_id>########<turn>`，须在工具续写时复用。
- `input.origin`：`user` / `tool_response` / `system`，决定会话续写逻辑。
- `input.parts`：兼容 `@google/genai` PartListUnion，允许 `text`、`function_response`、`file_data` 等。
- `options`：单次请求参数覆写（模型、采样、工具白名单）。
- 扩展字段：
  - `tool_call_id`：`origin=tool_response` 时必填，用于匹配输出事件。
  - `continuation`: 布尔值，等价 `submitQuery(...,{isContinuation:true})`。
  - `tool_request`: 镜像 `ToolCallRequestInfo`，支撑并发工具与子代理。

### 命令与 `@` 引用

| 模式 | 触发方式 | 行为 |
| --- | --- | --- |
| 隐式解析 | `origin="user"` + 文本以 `/`/`?`/`@` 开头 | CLI 自动走 slash/at 流程，调用 `handleAtCommand` 等逻辑 |
| 显式声明 | `input.command` 描述命令 | 推荐给第三方，避免字符串解析歧义 |

显式命令示例：

```jsonc
{
  "session_id": "session-123",
  "prompt_id": "session-123########8",
  "input": {
    "origin": "user",
    "parts": [{"type": "text", "text": ""}],
    "command": {
      "kind": "slash",
      "path": ["chat", "list"],
      "args": ""
    }
  }
}
```

CLI 输出对应 `result/command`：

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
    "content": "当前会话共有 3 条历史记录"
  }
}
```

- `command.result.type` 支持 `message`、`dialog`、`tool`、`submit_prompt` 等枚举，方便 UI 渲染。
- 若命令触发模型调用，后续输出会继续附带 `assistant`、`tool_call`、`result/*`，顺序与 TUI 一致。

## 实时提示、心跳与中断

| 能力 | 请求 | 响应 | 说明 |
| --- | --- | --- | --- |
| 命令提示 | `command_hint_request` | `result/command_hint` | 字符触发提示；`trigger` 支持 `slash`、`at`；`status` 可为 `ok` / `loading` / `error` |
| 心跳 | `heartbeat_request` | `result/heartbeat` | 定期保活；CLI 可主动推送同结构事件 |
| 中断/取消 | `control/cancel` | `result/cancel` + `control_response` | 模拟 ESC；`reason` 当前固定 `escape` |

### 提示请求示例（`/c`）

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

### 提示响应示例

```jsonc
{
  "type": "result/command_hint",
  "session_id": "session-123",
  "prompt_id": "session-123########preview",
  "trigger": "slash",
  "status": "ok",
  "suggestions": [
    {"label": "chat", "value": "chat", "description": "Manage conversation history."},
    {"label": "clear", "value": "clear", "description": "clear the screen and conversation history"},
    {"label": "compress", "value": "compress", "description": "Compresses the context by replacing it with a summary."},
    {"label": "copy", "value": "copy", "description": "Copy the last result or code snippet to clipboard"},
    {"label": "corgi", "value": "corgi", "description": "Toggles corgi mode."}
  ],
  "metadata": {
    "is_perfect_match": false
  }
}
```

- `suggestions` 结构复用 TUI `Suggestion`，`status="loading"` 表示 CLI 正在准备数据，`error` 时附带 message。
- 触发字符变化时可不断请求；取消时发送 `command_hint_cancel`。

### 心跳请求与响应

```jsonc
{"type":"heartbeat_request","session_id":"session-123"}
{"type":"result/heartbeat","session_id":"session-123","status":"ok","ts":1739430123}
```

- 第三方可配置超时（如 10 秒）判断 CLI 是否挂起并执行重启。
- 规划允许 SDK 自定义心跳频率。

### 中断示例

```jsonc
{
  "type": "control/cancel",
  "session_id": "session-123",
  "prompt_id": "session-123########8",
  "reason": "escape"
}
```

- CLI 必须调用 `cancelOngoingRequest`，中止 `AbortController`，补齐历史项并发出 `result/cancel`。
- 若当前无可取消请求，CLI 应返回 `{"type":"result/cancel","status":"noop"}` 并说明原因。

## 事件分类与通道

| 类别 | 方向 | 代表事件 | 回执要求 | 作用 |
| --- | --- | --- | --- | --- |
| 结果事件 | CLI → STDOUT | `result/command`、`result/command_hint`、`result/heartbeat`、`result/cancel`、`x-qwen-session-event` | 无需回执 | 发布命令输出、状态提示、心跳结果 |
| 请求事件 | SDK/第三方 → STDIN | `command_hint_request`、`heartbeat_request`、`control/cancel` | CLI 返回对应 `result/*` | 触发即时行为或控制 |
| 控制通道 | CLI ↔ STDIN/STDOUT | `control_request` / `control_response` | 必须匹配 `request_id` | 权限审批、Hook 回调、MCP 调用 |

- 事件通过统一 JSON Lines 传输，SDK 应基于 `type`/`subtype` 做路由。
- 控制通道不写入会话历史，与 TUI 行为一致，需实现超时与错误回退。

## 控制请求与响应

| 字段 | 说明 |
| --- | --- |
| `type` | 固定 `control_request` 或 `control_response` |
| `request_id` | 唯一标识，请求与响应配对 |
| `subtype` | `can_use_tool`、`hook_callback`、`mcp_message` 等 |
| `payload` / `response` | 携带事件明细或回执内容 |

- `control_request` 示例：

```jsonc
{
  "type": "control_request",
  "request_id": "req-1",
  "subtype": "can_use_tool",
  "session_id": "session-123",
  "prompt_id": "session-123########8",
  "tool": {
    "name": "edit_file",
    "arguments": {"path": "main.py", "patch": "..."}
  },
  "metadata": {
    "reason": "apply_diff"
  }
}
```

- 对应 `control_response`：

```jsonc
{
  "type": "control_response",
  "request_id": "req-1",
  "response": {
    "subtype": "success",
    "result": {
      "behavior": "approve",
      "message": "允许执行"
    }
  }
}
```

- 若回调异常，SDK 需返回 `{"subtype":"error","error":{"message":"...", "retryable":false}}`，CLI 按协议走安全回退（自动拒绝或提示失败）。
- MCP 集成：`subtype:"mcp_message"` 承载 JSON-RPC (`tools/list`、`tools/call` 等)，SDK 将结果封装为 `control_response` 内的 `mcp_response`。
- 后续需要在 CLI 内抽象统一分发层，使 TUI 与结构化模式共享逻辑。

## 版本协商与错误语义

| 项目 | 说明 |
| --- | --- |
| 协议版本 | 首个 `chat.completion` 的 `metadata` / `system_fingerprint` 携带 `protocol_version`、`input_format`、`output_format`、`capabilities` |
| 版本不匹配 | 若 SDK 请求超出能力，CLI 返回 `finish_reason="error"`，在 `metadata.error` 中标记 `unsupported_protocol` 并以非零退出码终止 |
| 致命错误 | 输出 OpenAI 风格错误对象并退出 |
| 可恢复错误 | 通过 `chat.completion` 返回错误信息，`finish_reason` 为 `stop/tool_calls`，进程保持健康 |
| 控制协议错误 | 在 `metadata.control_errors` 中附带详情，供 SDK 决定重试或终止 |

致命错误示例：

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

## 安全与资源控制

| 领域 | 策略 |
| --- | --- |
| 权限 | 结构化模式仍遵循 CLI 现有 Approval / 工具白名单；无回执时默认拒绝高风险操作 |
| 审计 | 控制通道允许 SDK 在敏感动作前进行审计；未启用时需在 `result/command` 明确提示 |
| 保活 | `heartbeat` 事件可触发进程回收、避免资源泄漏 |

## 日志分层与可观测

| 组件 | 要点 |
| --- | --- |
| ConsolePatcher | 拦截 `console.*`，在 `x-qwen-terminal` 中记录 `channel="stderr"`、`console_level` |
| log_scope 扩展 | 建议在结构化模式下为注解附加 `log_scope`（`system`、`tool`、`debug`），与 `ConfigLogger` 级别对齐 |
| 工具日志 | 通过 `ToolResultDisplay` 输出，可在 `result_display` 中附带 `log_scope` 便于过滤 |
| OTel 规划 | SDK/CLI 分别接入 OpenTelemetry，串联 Trace/Span |

- 建议第三方记录完整消息序列到审计日志，便于重放。

## 调试示例

```bash
echo '{"model":"qwen-coder","messages":[{"role":"user","content":"你好"}]}' \
  | qwen --input-format stream-json --output-format stream-json

echo '{"model":"qwen-coder","messages":[{"role":"user","content":"逐字输出问候"}]}' \
  | qwen --input-format stream-json --output-format stream-chunk-json
```

- 命令可用于快速验证输出格式与事件流。
