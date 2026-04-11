## ADDED Requirements

### Requirement: core start 下 Web 静态目录解析优先级

执行 **`opd core start`**（或等价入口 **`node …/dist/cli.js core start`**）时，用于托管 **Web SPA** 的静态目录 **`webDist`** SHALL 按以下**严格优先级**确定，后者仅当前者为空时生效：

1. **CLI 显式参数** **`--web-dist <path>`**
2. **环境变量** **`OPENDESKTOP_WEB_DIST`**
3. **自动探测**：与 **CLI 入口文件**（编译后的 **`dist/cli.js`**）位于同一 npm 包布局时，路径 **`dirname(cli.js)` 的上一级目录下的 `web-dist`**，且该目录下 SHALL 存在可识别的 SPA 入口（至少 **`index.html`**）；若探测失败，**SHALL** 视为未配置 Web 静态目录（**仅 API**，与当前行为一致）。

**SHALL NOT** 在同一调用路径中对 **`webDist`** 重复应用 **flag、env、探测** 导致互相覆盖或重复 **path.resolve** 以外的逻辑冲突；实现 SHALL 以单一 **`effectiveWebDist`**（或等价）合并后传入 **`startDaemon` / `loadConfig`**。

#### Scenario: 仅随包目录存在时默认带 Web

- **WHEN** 用户使用全局安装的 **`@hanzhao111/opendesktop`**，且 **未** 传入 **`--web-dist`**、**未** 设置 **`OPENDESKTOP_WEB_DIST`**，且包内存在 **`web-dist/index.html`**
- **THEN** Core 启动后 **SHALL** 托管该 **`web-dist`**，浏览器访问 Core 根路径 **SHALL** 可加载 SPA（与现有静态托管行为一致）

#### Scenario: 显式参数覆盖环境变量与探测

- **WHEN** 用户同时存在 **`--web-dist /custom`**、环境变量 **`OPENDESKTOP_WEB_DIST`** 与随包 **`web-dist`**
- **THEN** **SHALL** 使用 **`/custom`** 作为唯一静态目录

#### Scenario: 环境变量覆盖探测

- **WHEN** 用户 **未** 传 **`--web-dist`**，但设置 **`OPENDESKTOP_WEB_DIST`**，且随包 **`web-dist`** 存在
- **THEN** **SHALL** 使用环境变量指向的目录，**SHALL NOT** 使用随包探测路径

#### Scenario: 无随包 Web 且无 flag 与 env

- **WHEN** 用户从 **仅含 Core 构建产物的布局**（例如 monorepo 下 **`packages/core/dist/cli.js`** 且旁路 **无** 可探测 **`web-dist`**）启动，且 **未** 传 **`--web-dist`**、**未** 设置 **`OPENDESKTOP_WEB_DIST`**
- **THEN** **SHALL** 不托管 SPA，**SHALL** 仅暴露 API（与当前「无 web-dist」行为一致）

### Requirement: core start 成功后的终端提示与 Web 是否托管一致

**`core start`** 在前台启动成功并打印 **Token** 等信息时，其**后续提示文案**（「接下来可以」等）SHALL 根据 **`webDist` 是否已解析为非空** 区分：

- **已配置 Web 静态目录**：SHALL 说明可在浏览器打开 **同源** Web 控制台（或等价表述），**SHALL NOT** 声称「未传 **`--web-dist`** 则无 SPA」若实际上已通过 **env 或随包探测** 启用 Web。
- **未配置 Web 静态目录**：SHALL 说明当前 **仅 API** 或等价，**SHALL NOT** 暗示已托管 SPA。

#### Scenario: 随包 Web 已启用时的提示

- **WHEN** **`effectiveWebDist`** 已解析且 Core 成功监听
- **THEN** 终端输出 **SHALL** 不包含「未传 **`--web-dist`** 则无 SPA」这类与事实矛盾的句子

#### Scenario: 未启用 Web 时的提示

- **WHEN** **`effectiveWebDist`** 未解析
- **THEN** 终端输出 **SHALL** 明确 **仅 API** 或与现有「无 SPA」表述一致
