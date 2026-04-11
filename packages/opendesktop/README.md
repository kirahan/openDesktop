# opendesktop（npm 发行包）

本目录为发布到 npm 的 **`@hanzhao111/opendesktop`** 包：内容与 **`@opendesktop/core`** 构建产物一致，提供全局命令 **`od`**。

## 安装

```bash
npm install -g @hanzhao111/opendesktop
```

发布（维护者）：在包目录执行 `npm publish --access=public`（`package.json` 已配置 `publishConfig.access`）。

要求 **Node.js ≥ 20.19**。

## 使用

```bash
od --help
od core start --port 8787
```

更多子命令与 API 说明见主仓库中的 `docs/CLI.md`（克隆源码后查看）。

## 源码与 monorepo 开发

若参与本仓库开发，请克隆仓库后在根目录使用 `yarn install` / `yarn build`，勿依赖本页的 `npm i -g` 流程。
