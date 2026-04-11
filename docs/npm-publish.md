# npm 发布流程（`@hanzhao111/opendesktop`）

面向维护者：将全局 CLI 包发布到 npm。包源码在仓库 `**packages/opendesktop**`，与 `**@opendesktop/core**`、`**@opendesktop/web**` 的构建产物同步后一并打入 tarball。

## 1. 前置条件

- **Node.js** ≥ 20.19（与根 `package.json` 的 `engines` 一致）。
- 已登录 npm（`npm whoami` 可验证）。发布 scoped 包需有 `**@hanzhao111`** 作用域权限；`package.json` 已配置 `**publishConfig.access: public**`。

## 2. 发布前测试（推荐顺序）

在**仓库根目录**执行：

```bash
yarn install
yarn test
```

含义：

- `**yarn test**` 依次运行 `**@opendesktop/core**`（Vitest）与 `**@hanzhao111/opendesktop**`（`node --test ./package.test.mjs`）。后者会执行 `**prepublish-sync**`（至少在校验 CLI 与 `**npm pack**` 的用例中），检查同步后的 `**dist/cli.js**`、`**web-dist/index.html**`、`**opd --help**`，并对 tarball 结构做断言（例如不含 `**openspec**` 路径）。

可选：

```bash
yarn lint
yarn docs:check-links
```

## 3. 同步构建产物（与 `prepublishOnly` 相同）

发布前会把 **Web** 与 **Core** 构建输出拷贝进发行包目录：

- 脚本：`**packages/opendesktop/scripts/prepublish-sync.mjs`**
- 行为：在仓库根执行 `**yarn workspace @opendesktop/web run build**`、`**yarn workspace @opendesktop/core run build**`，再将 `**packages/web/dist**` → `**packages/opendesktop/web-dist**`、`**packages/core/dist**` → `**packages/opendesktop/dist**`。

手动同步（发版前自检或与 CI 对齐时）：

```bash
yarn opendesktop:sync
```

等价于在 `**packages/opendesktop**` 下执行 `**yarn sync**`。

## 4. 版本号与发布

1. 在 `**packages/opendesktop/package.json**` 中提升 `**version**`（遵循 semver）。
2. 进入包目录并发布：

```bash
cd packages/opendesktop
npm publish --access=public
```

执行 `**npm publish**` 时会自动运行 `**prepublishOnly**`（即上述同步脚本），**无需**在发布前重复手动 sync；但若 CI 或本地想先验证产物，可先 `**yarn opendesktop:sync`** 再 `**npm pack**` 检查。

## 5. 本地验证安装形态（不发 npm）

在 `**packages/opendesktop**` 下先同步产物（与发版相同：`yarn sync`，或在仓库根 `**yarn opendesktop:sync**`），再任选其一：

- **全局装当前目录**：`**npm install -g .`**，然后试 `**opd --help**`、`**opd core start**`；用完可 `**npm uninstall -g @hanzhao111/opendesktop**`。
- **模拟 registry 的 tgz**：同步后 `**npm pack --pack-destination .`**，再 `**npm install -g ./刚生成的.tgz**`（文件名以终端输出为准）。

若只想测 CLI 逻辑、不关心 npm 包布局，可在仓库根用 `**yarn opd**` 或 `**node packages/core/dist/cli.js**`。更细的 `**npm link**` 等见 **[packages/opendesktop/README.md](../packages/opendesktop/README.md)**。

## 6. 注意事项

- `**files`** 字段仅包含 `**dist**`、`**web-dist**`、`**LICENSE**`、`**README.md**`；勿将 monorepo 其它目录误拷入包内。
- 发布失败时检查网络、双因素认证与作用域权限；勿在日志中泄露 npm token。

更多使用者向说明见 **[packages/opendesktop/README.md](../packages/opendesktop/README.md)**。