# CLI TODO 任务渲染闪烁问题分析

## 问题概述

- **现象**：在交互界面执行 TODO 类工具或任务时，只要任务条目的文本内容总高度超过当前终端窗口可见区域，主内容区会持续刷新，表现为明显的闪烁。
- **影响范围**：所有返回 `todo_list` 类型结果的工具（例如待办规划器、合规检查清单等），在 `Ctrl+S` 展开前都可能触发该问题。

## 触发条件

- 进入默认的高度约束模式（`UIState.constrainHeight === true`，CLI 默认状态）。
- 某次工具调用的 `resultDisplay.type === 'todo_list'`，且 `todos` 列表合计渲染行数 > `availableTerminalHeightPerToolMessage`。
- Ink 在渲染 `ToolGroupMessage` 时尝试维持边框高度，实际内容溢出导致布局不断重算。

## 关键代码路径

- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx`
  - 计算 `availableTerminalHeightPerToolMessage`，并假定每个 `ToolMessage` 会自行裁剪内容高度。
- `packages/cli/src/ui/components/messages/ToolMessage.tsx`
  - `availableHeight = availableTerminalHeight - STATIC_HEIGHT - RESERVED_LINE_COUNT`，随后传入不同的结果渲染器。
  - 对字符串、Markdown、Diff、ANSI 输出等类型都会调用 `MaxSizedBox` 或按高度截取。
  - `TodoResultRenderer` 仅返回 `<TodoDisplay todos={data.todos} />`，完全忽略 `availableHeight`。
- `packages/cli/src/ui/components/TodoDisplay.tsx`
  - 将所有待办项逐条渲染到 `<Box flexDirection="column">` 中，无高度限制、无溢出标记。

## 根因分析

- UI 布局假设：当 `constrainHeight` 为真时，主内容区最多只能占用 `availableTerminalHeight` 行；`ToolGroupMessage` 会将这部分高度均分给每个带结果的工具消息。
- 对于 `todo_list`，实际渲染高度未受任何限制，导致真实占用行数远超分配值。
- Ink 会尝试调和“边框高度”与“子节点高度”间的矛盾，每一帧都重新排版，表现为边框及正文不断闪烁。
- 同时，由于 `TodoDisplay` 未通过 `MaxSizedBox` 报告溢出，`OverflowProvider` 不会记录 `overflowingIds`，用户也看不到 “Press ctrl-s to show more lines” 提示，误导使用者以为 CLI 出现异常刷新。

## 改进建议

- 将 `todo_list` 渲染路径改为使用 `MaxSizedBox`（或等效的高度截断逻辑），与其他结果类型保持一致：
  - 仅显示最近的 N 行或根据 `availableHeight` 截取，并在顶部或底部提示隐藏的条目数量。
  - 向 `OverflowProvider` 注册溢出信息，让底部提示正确出现。
- 可选的 UX 优化：
  - 为长任务条目提供“展开/收起”快捷键，复用 `ctrl+r / ctrl+e` 行为。
  - 在溢出提示中加入 `todo` 任务数量信息，便于用户判断是否需要展开。

## 验证与回归建议

- 单元测试：为 `TodoResultRenderer` 新增渲染测试，验证在限定高度下只渲染指定行数并显示溢出提示。
- 手动验证：
  1. 在窄终端（如 24 行）执行会返回 10 条以上 TODO 的工具。
  2. 观察默认模式下不再闪烁，底部提示出现。
  3. 使用 `ctrl-s` 关闭高度约束，确认仍可查看完整列表，无卡顿。

## 备忘

- 不引入新的快捷键或额外 UX 扩展；仅聚焦高度约束与溢出提示的修复。
