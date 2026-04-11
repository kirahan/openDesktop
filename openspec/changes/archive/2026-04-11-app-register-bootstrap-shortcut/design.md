## Context

OpenDesktop Core 已通过 `POST /v1/apps`、`POST /v1/profiles`、`POST /v1/sessions` 提供完整能力；CLI 仅有 `app create`、`app init-demo` 与 `session create <profileId>`，未组合快乐路径。Web 注册表单已支持解析快捷方式等，但自动生成应用 ID 偏长，且未在提交前强校验 ID 唯一性。`cli-oc-app-first` 规范已定义 `yarn oc <appId> <子命令>`，与「注册时填写的调用名」应对齐。

## Goals / Non-Goals

**Goals:**

- 提供 **一条 CLI 命令**（名称待定，如 `app bootstrap` 或扩展 `app create` 的 flags）顺序完成：创建 App、创建默认 Profile、可选创建 Session。
- 约定 **默认 Profile id**（例如 `{appId}-default` 或与 `appId` 相同，需与现有存储唯一性一致）及 **409 幂等**行为（已存在则跳过或失败，文档写明）。
- **调用名**：用户显式输入的 `app.id`，简短可读；**自动生成**仅在用户未填或选「生成」时使用，格式 **短**（例如 `basename-短后缀` 或 `basename` + 4 位 alphanumeric），避免 8 位 hex。
- **注册前校验**：CLI/Web 在 `POST /v1/apps` 前执行 `GET /v1/apps`，若 `apps[].id` 已包含目标 id，则 **不发送创建** 并输出明确错误。
- Web：应用 ID 字段 **必填**（或「调用名」与自动生成二选一且说明清楚）、帮助文案说明其即为 `oc <appId>` 前缀。

**Non-Goals:**

- 不在本变更中强制实现「一 App 多 Profile」的一等 UI；多配置继续通过 **多次注册（不同 app id）** 表达（与提案一致）。
- 不强制新增 HTTP API（除非校验必须服务端短路；默认客户端 `GET /v1/apps` 足够）。

## Decisions

| 决策 | 选项 | 理由 |
|------|------|------|
| 默认 Profile id | `{appId}-default`（若与 profile id 全局唯一约束冲突再调整） | 可读、可预测；与 `session create` 参数一致 |
| 自动启动会话 | `--start` 默认 `true` 或 `false` | 需产品拍板：默认启动可能误开进程；建议默认 **false** 或 **true** 并在 help 标明 |
| CLI 子命令形态 | 新子命令 `app bootstrap` **或** `app create --with-profile --start` | `bootstrap` 语义清晰；扩展 `create` 减少入口数量 |
| 唯一性校验 | 客户端 `GET /v1/apps` | 无新 API；Bearer 已有 |

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 默认 Profile id 与历史数据冲突 | 首次实现前检查 `POST /v1/profiles` 的 id 唯一性范围；409 时提示换 app id 或 profile id 策略 |
| 短随机 id 碰撞概率 | 校验失败则重试生成或要求用户改手动 id |
| 多次注册同一 exe 导致列表冗长 | 文档说明为有意模型；后续可加「克隆自」元数据（非本变更） |

## Migration Plan

- 纯增量功能：旧脚本 `app create` + 手动 profile 仍可用。
- README 与变更 spec 同步「推荐路径」。

## Open Questions

- `app bootstrap` 与现有 `app create` 是否长期并存：**建议并存**，`create` 保持最小行为，`bootstrap` 为快乐路径。
- `--start` 默认值：实现前与产品确认。

## Testing Strategy

- **CLI**：对 bootstrap 流程做集成风格单测或脚本化测试（mock `fetch` / 内存 store 若项目已有模式）；覆盖：成功链路、app id 冲突提前退出、409 分支。
- **Web**：组件级或手测清单：必填、GET 校验冲突、简化后的 id 生成单元测试（若有纯函数）。
- **Spec**：验收场景与 tasks 中测试子任务一一对应。
