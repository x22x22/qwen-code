**问题定位**

- `TaskToolInvocation.updateDisplay` 在子代理运行中会频繁推送最新的 `TaskResultDisplay`；`useReactToolScheduler` 把这些结果转换成 `HistoryItemToolGroup`，通过 `pendingHistoryItems` 传到 `MainContent` 的动态区域。
- `AppContainer.tsx` 第 701 行开始计算 `availableTerminalHeight`，并在 `constrainHeight` 为真时把这个高度一层层传给 `HistoryItemDisplay` → `ToolGroupMessage` → `ToolMessage`，期望下游组件据此裁剪输出，从而“把运行中的任务固定在视窗内”。
- `ToolMessage.tsx` 第 153～168 行正是把 `availableHeight` 传入 `AgentExecutionDisplay`，希望 Task 面板遵守这个高度。
- 但 `AgentExecutionDisplay.tsx`（第 20 行解构 `availableHeight`）从未真正使用这个值：组件始终按照自身内容高度渲染，没有任何 `MaxSizedBox` 或 `height` 限制，也不会在 `compact/default/verbose` 模式之间根据高度自动切换。
- 当 Task 状态为 `running` 且内容逐渐逼近可用高度时，Ink 会尝试同时满足“父级高度限制”与“子树无穷展开”这两个矛盾约束。结果是：每到任务输出新增一行，Ink 先回滚父级布局（屏幕上瞬间只剩先前的历史记录），随后再强行重绘 Task 卡片，于是用户就看到“历史内容 ↔ Task 面板”高速闪烁。任务完成后更新频率停止，闪屏现象随之消失。

**结论**

闪屏的根源不在于额外的滚动代码，而在于高度限制链路只在外层生效、最末端的 `AgentExecutionDisplay` 未配合裁剪，导致 Ink 在持续刷帧时前后两棵布局树不断被推翻与重建。要真正把 Task 稳定地固定在视窗里，需要让 `AgentExecutionDisplay` 尊重传下来的 `availableHeight`（例如包上一层 `MaxSizedBox` 或在 `compact` 模式下进一步压缩高度），否则当前“强制钉住视图”的设计就会继续触发上述闪烁。
