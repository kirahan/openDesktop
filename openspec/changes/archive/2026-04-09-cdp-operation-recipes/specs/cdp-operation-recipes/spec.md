## ADDED Requirements

### Requirement: Recipe JSON 格式与校验

系统 MUST 支持版本化的操作配方文件（单文件单配方），使用 JSON 表示，并 MUST 在加载时校验必填字段与 `schemaVersion`。配方 MUST 至少包含：稳定 `id`、人类可读 `name`、可选 `app` 描述（用于分目录或展示）、`steps` 数组。每个步骤 MUST 声明 `action`；首期实现 MUST 支持 `action` 为 `click` 的步骤，且 MUST 包含用于 `document.querySelector` 的 `selector` 字符串（与现有 Agent `click` 语义一致）。配方 MAY 包含 `match` 或等价字段，用于在 DOM 再分析兜底时从候选中筛选元素（例如 label 子串、最低 `score`）。

#### Scenario: 合法 click 配方被接受

- **WHEN** 加载的 JSON 含 `schemaVersion` 为支持的版本，且 `steps` 中每步 `action` 为 `click` 且含非空 `selector`
- **THEN** 校验通过并进入可执行状态

#### Scenario: 未知动作被拒绝

- **WHEN** 某步骤的 `action` 不在实现声明的支持集合内
- **THEN** 校验失败并返回明确错误信息，且不执行任何 CDP 调用

---

### Requirement: 基于 CDP 的步骤执行

系统 SHALL 使用与现有 Agent 一致的 CDP 路径执行步骤：对 `click` 步骤，SHALL 在具备脚本执行许可的会话中，使用会话关联的 CDP 端点与调用方提供的 `targetId`，对步骤的 `selector` 执行点击（与 `clickOnTarget` 行为一致）。若缺少 `targetId`、`selector` 或会话不允许脚本执行，系统 MUST NOT 执行点击并 MUST 返回与现有 HTTP 层一致或可映射的错误类别。

#### Scenario: 会话禁止脚本时拒绝执行

- **WHEN** 会话 `allowScriptExecution` 为 false
- **THEN** 执行器拒绝 `click` 步骤并返回明确原因（例如脚本未获准）

---

### Requirement: DOM 再分析兜底

当某步骤在执行或可选校验中失败，且配方允许兜底时，系统 MUST 尝试：获取当前页用于探索的 HTML（与 Core 已有 explore/dom 探索数据路径一致），通过 `domExplore` 或同等模块生成候选列表，并 MUST 使用配方中提供的匹配规则选取至多一个候选。若选出候选，系统 MUST 用其 `selector` 重试该步骤（在同一 `targetId` 下，除非设计另有说明）。若无法唯一选定候选，系统 MUST 中止并 MUST NOT 更新磁盘上的配方文件。

#### Scenario: 原 selector 失效后兜底成功

- **WHEN** 首次 `click` 失败，且兜底阶段能从 HTML 中选出唯一候选且重试点击成功
- **THEN** 该步骤视为成功并继续后续步骤

#### Scenario: 多候选无法消歧

- **WHEN** 兜底阶段匹配到多个等价高分候选且无法唯一选定
- **THEN** 执行失败并返回结构化原因，且配方文件不被修改

---

### Requirement: 成功后持久化更新配方

当配方所有步骤均成功完成（含可选的最终校验，若实现），系统 MUST 将本次实际生效的定位信息写回该配方对应的 JSON 文件：至少更新相关步骤的 `selector`（若兜底替换了 selector）与 `updatedAt` 时间戳。写回 MUST 使用同目录原子替换（如临时文件 + rename），以避免部分写入导致 JSON 损坏。若写回失败，系统 MUST 向调用方报告错误，且 MUST NOT 声称「持久化已成功」。

#### Scenario: 写回成功后文件可读且含新 selector

- **WHEN** 兜底替换了某步 selector 且全流程成功
- **THEN** 重新读取磁盘上该 JSON 文件可见更新后的 `selector` 与新的时间戳

#### Scenario: 写回失败不掩盖执行成功

- **WHEN** 步骤均已成功但原子写失败
- **THEN** 响应或错误流中明确区分「业务执行成功」与「持久化失败」（或整体视为失败，但不得静默丢失写错误——具体对外语义在实现中二选一并写入 API 文档）

---

### Requirement: 可发现性与列举

系统 MUST 提供至少一种受支持方式（HTTP 或 CLI，以实现为准）用于：按配置根目录列出可用配方、读取单配方 JSON、触发执行。列举结果 MUST 包含足以让用户选择配方的 `id` 与 `name`（或从文件解析出的等价字段）。

#### Scenario: 列出非空目录

- **WHEN** 配方根下存在至少一个合法配方文件
- **THEN** 列举接口返回非空列表且每项含 `id` 与可展示名称
