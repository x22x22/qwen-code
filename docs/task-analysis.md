**Task 状态**

- **任务主状态枚举**: `packages/core/src/tools/task.ts` 中的 `TaskResultDisplay` 仅允许 `running / completed / failed / cancelled`，`START` 事件设置为 `running`，`FINISH` 事件依据 `SubagentTerminateMode` 选择 `completed` 或 `failed`，`ERROR` 事件直接标记为 `failed`。
- **终止原因与结果**: `terminateReason` 会被写入失败原因或具体终止模式，成功时还会补充 `result` 与 `executionSummary`。
- **子调用状态**: `toolCalls` 数组记录子工具的 `executing / awaiting_approval / success / failed`，审批等待时还会挂接 `pendingConfirmation` 以触发行内权限提示。

**更新机制**

- **事件驱动刷新**: `SubAgentScope` 在 `subagents/subagent.ts` 内对工具调用全过程广播 `SubAgentEventType.*` 事件，`TaskToolInvocation.setupEventListeners` 监听这些事件并更新 `currentDisplay`，同时通过 `updateOutput` 把最新的 `TaskResultDisplay` 推送出去。
- **调度层桥接**: `CoreToolScheduler` 在 `coreToolScheduler.ts` 为支持流式输出的工具注入 `liveOutputCallback`，将 `updateOutput` 的结果写入当前执行中的 tool call。
- **UI 状态同步**: CLI 侧 `useReactToolScheduler`（`useReactToolScheduler.ts`）监听核心调度器，更新 `TrackedExecutingToolCall.liveOutput` 并驱动 `pendingHistoryItems`；`ToolGroupMessage` → `ToolMessage` → `AgentExecutionDisplay` 完成渲染。
- **追加式呈现**: 任务事件触发时 `currentToolCalls.push(...)` 并再次调用 `updateDisplay`，因此 `AgentExecutionDisplay` 接收到的新属性是“旧状态 + 新增项”的合并，Ink diff 只渲染增量。
- **显示模式切换**: `AgentExecutionDisplay` 在 `runtime/AgentExecutionDisplay.tsx` 中维护 `displayMode`（`compact`/`default`/`verbose`），`ctrl+r` 与 `ctrl+e` 仅切换前端截断策略（如 `MAX_TASK_PROMPT_LINES`、`MAX_TOOL_CALLS`），底层数据结构不变，新的任务内容照常写入同一份 `data`。

**滚动与高度控制**

- **全局高度约束**: `AppContainer.tsx` 按终端尺寸计算 `availableTerminalHeight`，并在 `constrainHeight` 为真（默认，`ctrl+s` 可关闭）时把该值下传到 `HistoryItemDisplay`，进而传入 `ToolGroupMessage`。
- **多工具分摊**: `ToolGroupMessage` 根据 `availableTerminalHeight` 求出每个子 ToolMessage 的可用高度。普通文本结果会由 `MaxSizedBox`（`shared/MaxSizedBox.tsx`）截断并上报 `OverflowProvider`，提示用户需要放宽高度。
- **Task 面板策略**: Task 输出本身通过显示模式控制行数；若用户在 `verbose` 模式下放开限制，`ctrl+s` 关闭 `constrainHeight` 后交由终端的天然滚动缓冲区处理，CLI 仍会持续重绘最新内容。
- **刷新与定位**: 由于 Ink 基于虚拟树 diff，Task 区域的坐标由布局重新计算；更新时不会重新输出整屏，只重画受影响的框体，从而保持界面在追加内容时的流畅刷新。
