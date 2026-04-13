# mac-native-a11y-tree

## 概述

**一句话**：在 **macOS** 上通过系统 **Accessibility（AX）** 接口，按 **OpenDesktop 会话子进程 PID** 拉取 **Qt 等原生应用** 的 UI 结构树，经 Core **HTTP** 以 JSON 返回，补全「仅有 CDP、无 DOM」场景的观测能力。

**背景与动机**：用户已可注册并启动如 OBS 等 Qt 应用；CDP 无法覆盖其原生窗口。需要 **系统级无障碍树** 作为结构化观测与后续自动化（本变更仅 **读树**，不执行点击）。

**影响范围**：`packages/core`（采集模块、路由、测试、文档）；`**packages/web`（Studio）必做**：会话区「一键拉取原生无障碍树」+ 结果展示；可能增加极小 **Swift 辅助二进制** 或构建步骤。

## 设计方案

### 改动点


| #   | 改动           | 说明                                                   | 涉及文件（预期）                                           |
| --- | ------------ | ---------------------------------------------------- | -------------------------------------------------- |
| 1   | AX 枚举与 JSON  | Swift CLI 或等价，`AXUIElement`* 递归 + 上限                 | `packages/core/src/nativeAccessibility/`*（路径以实现为准） |
| 2   | HTTP API     | `GET .../native-accessibility-tree` + 鉴权 + 会话/pid 校验 | `packages/core/src/http/createApp.ts` 等            |
| 3   | capabilities | `/v1/version` 声明是否支持                                 | 同上或 `version` 组装处                                  |
| 4   | 测试           | HTTP 层 mock + 错误码                                    | `packages/core/src/http/*.http.test.ts`            |
| 5   | 文档           | API + 系统「辅助功能」授权说明                                   | `docs/API.md` 等                                    |
| 6   | Studio UI    | 一键拉取 + 树/JSON 展示，`capabilities` 与会话状态联动              | `packages/web/src/App.tsx` 等                       |


### 关键决策


| 决策   | 选择                 | 为什么不选其他方案               |
| ---- | ------------------ | ----------------------- |
| 采集实现 | Swift 子进程调 AX API  | JXA/osascript 递归与可维护性较差 |
| 定位方式 | 会话已有 **PID**       | 窗口标题匹配不可靠               |
| 输出   | 精简节点 + `truncated` | 全量 AX 属性体积过大            |


### 技术要点

- 入口：`AXUIElementCreateApplication(pid)` → 深度优先遍历，收集 `AXRole` / `AXTitle` / `AXValue` / children。
- **权限**：未授权时 **403** + `ACCESSIBILITY_DISABLED`，与 200 空树区分。
- **上限**：`maxDepth`、`maxNodes` 查询参数，防止超大树阻塞 Core。

## 验收标准

> 以 `specs/native-accessibility-tree/spec.md` 为准。


| #   | 场景          | 操作                        | 预期结果                                                            |
| --- | ----------- | ------------------------- | --------------------------------------------------------------- |
| 1   | 非 macOS     | 在非 darwin Core 上调用接口      | **4xx**，`PLATFORM_UNSUPPORTED` 类语义，无假成功树                        |
| 2   | 会话未就绪       | 无 `running` 或无 `pid`      | **4xx**，可机读码，不执行采集                                              |
| 3   | 成功形态        | darwin + 合法会话 + 有权限       | **200**，JSON 含 `role`、可选 `title`/`value`、`children`、`truncated` |
| 4   | 大树截断        | 极深/极宽树                    | `**truncated` true**，停止于上限                                      |
| 5   | 无辅助功能权限     | 系统拒绝 AX                   | **403** 类，`ACCESSIBILITY_DISABLED`，非 200 假空树                    |
| 6   | 能力探测        | `GET /v1/version`         | darwin 实现与 capabilities 声明一致                                    |
| 7   | Studio 一键拉取 | macOS + 能力为真 + running 会话 | 按钮可点，能展示树/JSON；否则禁用并有说明                                         |
| 8   | 权限 403      | 拉取时未开辅助功能                 | Studio 展示含引导文案的错误信息                                             |


## 实现清单


| #   | 任务                  | 说明                                | 依赖  |
| --- | ------------------- | --------------------------------- | --- |
| 1   | AX 采集核心             | Swift CLI + 递归 + 截断 + 错误映射        | —   |
| 2   | HTTP + capabilities | 路由、version、测试                     | 1   |
| 3   | 文档 + Studio Web     | API 文档；**必做** 一键拉取 UI + 展示 + 轻量测试 | 2   |


## 测试要点

- HTTP 测试覆盖：平台不支持、会话无效、mock 成功 JSON、权限错误映射。
- 手工：在本机为 **Terminal/Cursor/Core 二进制** 打开「辅助功能」后，对 OBS 会话拉树非空（若 Qt 暴露 AX）；Studio 中验证按钮启用/禁用与错误展示。