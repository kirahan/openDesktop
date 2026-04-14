/**
 * Electron 壳通过 preload 注入的窄 API（浏览器环境不存在）。
 *
 * @see packages/studio-electron-shell/src/preload.js
 */
export type OdShellElectron = {
  kind: "electron";
  version: string;
  pickExecutableFile: () => Promise<string | null>;
};

declare global {
  interface Window {
    __OD_SHELL__?: OdShellElectron;
  }
}

/**
 * 若当前在 Electron 壳内且 `preload` 已注入，返回壳 API；否则 `undefined`（外置浏览器）。
 */
export function getElectronShell(): OdShellElectron | undefined {
  if (typeof window === "undefined") return undefined;
  const s = window.__OD_SHELL__;
  return s?.kind === "electron" ? s : undefined;
}
