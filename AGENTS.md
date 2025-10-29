# Repository Guidelines

## 国际化

这是一个国际项目，如果没有特殊标记，请用英文编写文档、注释、数据示例、脚本示例。

## 项目结构与模块职能

- `packages/cli`: CLI 客户端入口与命令路由，依赖核心能力。
- `packages/core`: 核心执行管线、沙箱控制与模型交互逻辑。
- `packages/test-utils`: 共享测试夹具与模拟器，供 Vitest 场景复用。
- `packages/vscode-ide-companion`: VS Code 扩展伴侣构建与打包脚本。
- `integration-tests`: 端到端与终端基准测试用例，覆盖不同沙箱模式。
- `scripts`: 构建、发布、认证等 Node 脚本；`bundle/` 存放生成产物。

## 构建、测试与开发命令

- `npm run build`: 聚合构建核心包并执行 `scripts/build.js`，生成分发工件。
- `npm run start`: 本地启动 CLI 体验脚本，适合调试交互流程。
- `npm run build:vscode`: 独立打包 VS Code Companion，确保扩展可用。
- `npm run test`: 在所有工作区运行 Vitest 单元与集成测试。
- `npm run test:e2e`: 执行端到端脚本，验证沙箱禁用场景功能。
- `npm run lint` / `npm run format`: 运行 ESLint 与 Prettier 保持代码风格一致。

## 代码风格与命名约定

- TypeScript 为主语言，使用 ECMAScript 模块与严格 TypeScript 配置。
- 统一使用 2 空格缩进；命名采用 `camelCase` 函数、`PascalCase` 类型、`SCREAMING_SNAKE_CASE` 常量。
- 通过 ESLint + Prettier 自动校验，提交前运行 `npm run lint:fix` 或 `npm run format`。
- 文件命名遵循功能语义，例如 `*-service.ts`、`*-spec.ts`。

## 测试策略

- 采用 Vitest，聚焦 CLI 行为与沙箱交互；补充端到端覆盖 `integration-tests`。
- 新增功能应提供 `*.test.ts` 或 `*.spec.ts`，并记录关键路径。
- 保持测试可并行运行，不依赖全局状态；必要时使用 `packages/test-utils` 提供的模拟器。
- 目标是维持终端基准测试通过率 100%，CI 将在 `npm run test:ci` 中执行。

## 提交与 Pull Request 规范

- 遵循 Conventional Commits 样式：`feat: ...`、`refactor: ...`、`fix: ...` 等。
- 提交信息需突出范围与影响，例如 `feat(cli): add sandbox opt-in flag`。
- PR 描述包括：变更摘要、验证步骤、相关 Issue 与截图/终端输出（若适用）。
- 在 PR 检查清单中确认已运行构建、lint、测试命令，确保无多余生成文件。

## 安全与配置提示

- 本地运行需要 Node.js ≥20；全局依赖通过 `npm install` 解决。
- 认证脚本位于 `scripts/auth*.js`，请勿在仓库中提交密钥或 `.env`。
- 使用沙箱相关命令前，确保 Docker/Podman 环境已配置；CI 默认禁用沙箱。
