# @opendesktop/web

OpenDesktop 控制台前端（Vite + React）。

## Network 页面与第三方 UI 参考

独立 **Network** 视图（`#/network`）的 **布局与信息密度** 参考开源项目 **[Whistle](https://github.com/avwo/whistle)**（Copyright avwo，**MIT License**）。OpenDesktop 实现为自有 React 组件与样式，并非嵌入 Whistle 构建产物；若分发衍生作品，请保留 MIT 许可要求的版权声明。

## 开发

```bash
yarn dev
```

默认通过 Vite 代理将 `/v1` 转发至 `http://127.0.0.1:8787`（需已启动 Core）。

## 测试

```bash
yarn test
```
