## ADDED Requirements

### Requirement: 注入式 arm — 在单 page target 上记录最近一次指针坐标

系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端在会话 **`running`**、CDP 可用且会话 **`allowScriptExecution`** 为允许时，对指定 **`targetId`**（类型为 **`page`** 的调试目标）执行 **arm** 操作：**通过 CDP `Runtime.evaluate` 注入**脚本，在目标文档上注册 **捕获阶段** 监听，将用户下一次（或最近一次）指针交互的 **`clientX` 与 `clientY`** 写入文档全局可见的约定字段（具体键名由 `design.md` 规定）。系统 SHALL NOT 在本操作中调用操作系统级全局鼠标钩子。

#### Scenario: arm 成功且会话禁止脚本时拒绝

- **WHEN** 会话 `allowScriptExecution === false`
- **THEN** arm 请求 SHALL 失败并返回 **403** 及与既有脚本类 API 一致的错误码（如 `SCRIPT_NOT_ALLOWED`），且 SHALL NOT 注入脚本

#### Scenario: 非 running 或无 CDP

- **WHEN** 会话未处于 `running` 或无法连接 CDP
- **THEN** arm SHALL 失败并返回可机读错误，且 SHALL NOT 声称成功

### Requirement: resolve — 由坐标解析节点并返回摘要

在已成功 arm 的同一 **`targetId`** 上，系统 SHALL 提供 **resolve** 接口：读取约定全局中的坐标；若存在有效坐标，则 SHALL 调用 CDP **`DOM.getNodeForLocation`**（或项目文档化之等价方法）与 **`DOM.describeNode`**（或等价只读查询），并 SHALL 在 HTTP **200** 响应中返回 **JSON**，包含至少：**节点名**（如 `nodeName`）、**节点 id**（若存在）、**可读的属性或 HTML 截断**（长度上限由实现文档化）。若全局中无可用坐标，系统 SHALL 返回 **4xx** 及可机读错误码（如 `DOM_PICK_EMPTY`），且 SHALL NOT 伪造成功结果。

#### Scenario: 无点击记录时 resolve 失败

- **WHEN** 客户端在未发生指针记录（或 stash 已被清空）时调用 resolve
- **THEN** 响应 SHALL 为 **4xx**，且正文 SHALL 指示无可用拾取数据

#### Scenario: 有坐标时返回节点摘要

- **WHEN** stash 中存在有效 `clientX`/`clientY` 且 `getNodeForLocation` 成功
- **THEN** HTTP **200** 的 JSON SHALL 包含节点摘要字段，且 SHALL NOT 仅返回空对象而无说明

### Requirement: 单 target 与范围声明

本 spike SHALL 仅要求对 **单一 `page` target** 的行为符合上述要求。系统 **MAY** 在文档中声明：**iframe 内坐标**、**Shadow DOM** 的命中行为以 CDP 与 Chromium 实现为准，不作为本变更必测边界。

#### Scenario: 文档化范围

- **WHEN** 维护者阅读本变更的 `design.md` 或 README
- **THEN** SHALL 能识别「单 target、注入拾取、非 OS 全局钩子」的边界说明
