# opendesktop（npm 发行包）

本目录为发布到 npm 的 **`@hanzhao111/opendesktop`** 包：内容与 **`@opendesktop/core`** 构建产物一致，全局命令为 **`opd`**（避免与 Git for Windows 自带的 `od.exe` 冲突）。

## 安装

```bash
npm install -g @hanzhao111/opendesktop
```

发布（维护者）：在包目录执行 `npm publish --access=public`（`package.json` 已配置 `publishConfig.access`）。

要求 **Node.js ≥ 20.19**。

## 使用

```bash
opd --help
opd core start --port 8787
```

随包附带 **Web 控制台** 静态资源目录 **`web-dist`**（与 CLI 同步自 `packages/web` 构建产物）。**默认**下 `opd core start` 会自动探测与 CLI 同级的 `web-dist`（存在 `index.html` 时即托管 SPA），一般**无需**再传 `--web-dist`。

若需指定其它目录或覆盖顺序，可使用：

- **`--web-dist <path>`**（最高优先级）
- 或环境变量 **`OPENDESKTOP_WEB_DIST`**

例如手动指向全局安装路径下的随包目录（与自动探测结果通常一致）：

```bash
opd core start --web-dist "$(npm root -g)/@hanzhao111/opendesktop/web-dist"
```

（Windows 可用 `npm root -g` 查看前缀后手动拼接。）

包内脚本 **`yarn start:web`** 等价于 `node dist/cli.js core start --web-dist ./web-dist`，用于在本包目录下显式绑定相对路径的 `web-dist`。

更多子命令与优先级说明见主仓库 **[docs/CLI.md](../../docs/CLI.md)**（克隆源码后查看）。

## 本地验证（不发 npm）

发版前或调试安装形态时，可在本目录用下面方式验证，**无需** `npm publish`。

### 1. 与 registry 安装最接近：打 tgz 再全局装

在**仓库根**先保证依赖已装，然后在**本目录**执行：

```bash
# 先 build web 与 core，再把 core dist 与 web dist 拷入本包（与 prepublishOnly 相同）
yarn sync
# 或在仓库根：yarn opendesktop:sync
npm install -g .
```

之后直接运行 `opd --help` / `opd core start` 即可。装完可 `npm uninstall -g @hanzhao111/opendesktop` 清理。

若要**完全复现** registry 上的 tarball 形态，可在同步后执行 `npm pack --pack-destination .`，再 `npm install -g ./生成的.tgz`（文件名以 `npm pack` 输出为准）。

### 2. 频繁改代码时用 link

在本目录执行一次 `npm link`，全局会指向当前目录；改 `dist` 后需重新跑上面的同步脚本再试。与「拷贝安装的 tgz」仍有细微差别，发版前建议再用上一节兜一次。

### 3. 只验证 CLI 逻辑（最快）

在 monorepo 根用 `yarn opd` 或 `node packages/core/dist/cli.js`，不经过 npm 包形态。

## 源码与 monorepo 开发

若参与本仓库开发，请克隆仓库后在根目录使用 `yarn install` / `yarn build`，勿依赖本页的 `npm i -g` 流程。
