## 1. CDP 异常与栈解析

- [x] 1.1 在 `packages/core/src/cdp/` 实现 `Runtime.enable` + `Runtime.exceptionThrown` 短时订阅，将 `exceptionDetails.stackTrace` 映射为稳定 `frames[]`（含长度上限）
  - [x] Test: 单元测试使用 CDP 样例 payload 或 mock，覆盖多帧、空栈、超长 text 截断（AC：帧结构、脱敏、上限）

## 2. Agent HTTP 集成

- [x] 2.1 在 `registerObservability.ts` 注册新 canonical 动作，与 `allowScriptExecution` 策略在代码与测试中与 `eval` 对齐
  - [x] Test: HTTP 测试：403 脚本禁用、无异常窗口、单异常成功返回
- [x] 2.2 更新 `agentActionAliases.ts` 与版本列表
  - [x] Test: 断言 `agentActions` 含新动词

## 3. 文档与收尾

- [x] 3.1 更新 `README.md`：新动作与 `console-messages` 的差异（历史不可回溯、栈为增量事件）
  - [x] Test: 无
