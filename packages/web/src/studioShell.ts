/**
 * Electron 壳通过 preload 注入的窄 API（浏览器环境不存在）。
 *
 * @see packages/studio-electron-shell/src/preload.cjs
 */
export type OdShellElectron = {
  kind: "electron";
  version: string;
  /** 主进程读取 Core `token.txt`，供壳内自动填 Bearer */
  getCoreBearerToken: () => Promise<string | null>;
  pickExecutableFile: () => Promise<string | null>;
  /** 可选：Qt AX 全屏透明十字线（仅 macOS 主进程实现） */
  startQtAxOverlay?: () => Promise<{ ok: boolean; error?: string }>;
  stopQtAxOverlay?: () => Promise<{ ok?: boolean } | void>;
  /** @returns 取消订阅 */
  subscribeQtAxCursor?: (cb: (pos: { x: number; y: number }) => void) => () => void;
  /** 将 Core `hitFrame` 同步到主进程，在透明层上叠 Qt 控件矩形（全局像素坐标）；传 `null` 清除 */
  setQtAxHitHighlight?: (
    rect: null | { x: number; y: number; width: number; height: number },
  ) => Promise<{ ok?: boolean; error?: string } | void>;
  /**
   * 注册全局快捷键（主进程 `globalShortcut`）。`bindings` 的 key 为动作 ID，value 为 Electron accelerator 字符串。
   * @see packages/web/src/studioGlobalShortcuts.ts
   */
  setGlobalShortcutBindings?: (
    bindings: Record<string, string>,
  ) => Promise<{ ok?: boolean; errors?: Array<{ actionId: string; accelerator: string; code: string }> }>;
  /** 订阅主进程转发的全局快捷键动作（闭集 actionId） */
  onGlobalShortcutAction?: (cb: (payload: { actionId: string }) => void) => () => void;
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

/**
 * Electron 壳内且本地尚未保存 token 时，从主进程读取 Core 使用的 Bearer 并写入 state + `od_token`。
 * 若用户已填写或非 Electron，则不覆盖。
 */
const TOKEN_PREFILL_LOG = "[openDesktop][shell][token-prefill]";

export async function applyElectronShellBearerTokenPrefillIfEmpty(
  getCurrentToken: () => string,
  setToken: (value: string) => void,
): Promise<void> {
  const sh = getElectronShell();
  if (!sh) {
    console.info(TOKEN_PREFILL_LOG, "skip: no Electron shell (__OD_SHELL__ missing or kind≠electron)");
    return;
  }
  if (!sh.getCoreBearerToken) {
    console.info(TOKEN_PREFILL_LOG, "skip: getCoreBearerToken missing (preload 版本过旧？)");
    return;
  }
  const before = getCurrentToken().trim();
  if (before !== "") {
    console.info(TOKEN_PREFILL_LOG, "skip: od_token 已有内容", { length: before.length });
    return;
  }
  console.info(TOKEN_PREFILL_LOG, "calling getCoreBearerToken() …");
  const raw = await sh.getCoreBearerToken();
  if (getCurrentToken().trim() !== "") {
    console.info(TOKEN_PREFILL_LOG, "skip: 用户在等待 IPC 期间已填写 token");
    return;
  }
  const t = raw?.trim() ?? "";
  if (!t) {
    console.info(TOKEN_PREFILL_LOG, "abort: IPC 返回空（检查主进程日志 [studio-electron-shell][token]）");
    return;
  }
  console.info(TOKEN_PREFILL_LOG, "apply: 写入 React state + localStorage.od_token", {
    length: t.length,
    preview: `${t.slice(0, 4)}…${t.slice(-2)}`,
  });
  setToken(t);
  try {
    localStorage.setItem("od_token", t);
  } catch (e) {
    console.info(TOKEN_PREFILL_LOG, "localStorage.setItem failed", e);
  }
}
