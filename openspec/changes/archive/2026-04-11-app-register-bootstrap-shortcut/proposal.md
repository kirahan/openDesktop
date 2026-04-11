## Why

当前注册应用后仍需单独创建 Profile 再 `session create`，步骤多；CLI 亦缺少 `profile list` 等与用户心智对齐的入口。用户希望将「注册 App + 默认 Profile + 可选启动会话」收敛为一条快乐路径，并把「同一套 exe 多套配置」明确为**多次注册、各带独立调用名**，与 `yarn oc <appId> <子命令>` 的 App-first 模型一致。同时自动生成的应用 ID 过长、过随机不利于记忆与输入，且需在注册前校验 ID 是否已被占用。

## What Changes

- 新增（或增强）CLI：**一条命令**完成 `POST /v1/apps` + 默认 `POST /v1/profiles` + 可选 `POST /v1/sessions`（由标志位控制是否启动会话），并约定默认 Profile 的命名规则。
- **应用调用名（快捷指令）**：注册时必填、唯一，即 Core 中的 `app.id`，直接对应 `oc <appId> …`；文档与表单中说明用途与格式建议。
- **自动生成 ID**：简化为短、可读的形式（例如短随机后缀或规则化 slug），避免当前过长十六进制串；仍保证与已有 ID 冲突时可重试或提示用户修改。
- **注册前校验**：CLI 与 Web 在提交创建前查询已有应用列表（或 `GET /v1/apps` / 轻量 HEAD 校验），若 `id` 已存在则明确报错并提示换名，而非仅依赖服务端 409。
- 可选：补充 **Profile 列表类 CLI**（如 `profile list`）或仅在 README 中指向 `GET /v1/profiles`，避免与本次范围耦合时可放入后续任务。

## Capabilities

### New Capabilities

- `app-register-bootstrap`：应用注册快乐路径（CLI 组合、默认 Profile、可选 Session、调用名校验与唯一性、简化自动生成 ID 规则、Web 表单必填与说明）。

### Modified Capabilities

- `cli-oc-app-first`：补充或交叉引用「注册时 `appId` 即 App-first 子命令前缀」的约定；若有行为变更（如新子命令名）在 delta 中说明。

## Impact

- **代码**：`packages/core/src/cli.ts`（及可能的 `package.json` scripts）、`packages/web/src/App.tsx` 注册弹层。
- **API**：沿用现有 `POST /v1/apps`、`POST /v1/profiles`、`POST /v1/sessions`；无强制新 HTTP 端点（若校验仅客户端用 `GET /v1/apps` 即可）。
- **文档**：README、OpenSpec 本变更下的 spec。