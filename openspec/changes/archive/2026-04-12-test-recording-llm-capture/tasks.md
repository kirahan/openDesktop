## 1. 规格与 schema

- [x] 1.1 冻结 `TestRecordingArtifact` JSON 的 `schemaVersion: 1` 字段表（与 `design.md` 一致），含顶层、`pageContext`、`steps[]`、`capture` / `human` 分层（或等价扁平字段）
  - [x] Test: 样例 JSON 通过校验函数；非法样例拒绝

## 2. Core：组装、落盘与可选 API

- [x] 2.0 在 `config` 中解析 **`appJsonDir`**：默认 `<dataDir>/app-json`，支持 **`OPENDESKTOP_APP_JSON_DIR`** 覆盖整根路径
  - [x] Test: 单元测试覆盖默认与 env 覆盖
- [x] 2.0b 实现 **`ensureAppJsonDir(appId)`**：创建 `<根>/<appId>/`，校验 `appId` 安全
  - [x] Test: 非法 `appId` 拒绝；合法路径可创建
- [x] 2.0c 实现 **`writeTestRecordingArtifact(appId, recordingId, json)`**：原子写 `test-recording-<recordingId>.json`
  - [x] Test: 临时目录中断无半截文件；读回与写入一致
- [x] 2.1 实现从「一次矢量录制会话的缓冲事件」到 `steps[]` 的归并策略（默认：每 `click` 一步，坐标与 `vectorTarget` 写入）；组装结果 **MUST** 含 **`appId`**
  - [x] Test: 给定固定事件列表，输出固定 `steps`（纯函数单测）
- [ ] 2.2 （可选）在 dom-pick 与步骤对齐时合并 `domPick` 子对象；文档化「一步一 resolve」或 debounce 策略
  - [ ] Test: mock resolve 响应合并进制品
- [x] 2.3 HTTP：`POST` 落盘、`GET` 列表与读取；401 与现有 API 风格一致
  - [x] Test: HTTP 单测

## 3. Web（可选）

- [ ] 3.1 结束录制后展示制品预览（JSON 折叠视图）与「复制 / 下载」
- [ ] 3.2 每步或全局表单项：`actionDescription`、`expectedDescription`、`notes`
  - [ ] Test: 组件测试：表单变更写入导出 payload

## 4. 文档与验证

- [x] 4.1 更新 `docs/API.md` 或独立小节：制品字段说明、**`app-json` 目录布局**、**`OPENDESKTOP_APP_JSON_DIR`**、隐私提示、与矢量流关系
- [x] 4.2 运行 `openspec validate test-recording-llm-capture`（若 CLI 可用）与全量测试通过后再 archive

## 非目标（本 tasks 不排期）

- LLM 调用、提示词、Recipe 生成、断言执行
