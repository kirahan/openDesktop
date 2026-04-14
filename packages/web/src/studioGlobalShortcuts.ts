/**
 * Electron 全局快捷键：动作 ID 与 localStorage 键（与壳 IPC 一致）。
 *
 * @see packages/studio-electron-shell/src/main.js `od:global-shortcut`
 */

export const OD_GLOBAL_SHORTCUTS_STORAGE_KEY = "od_global_shortcut_bindings_v1";

/** 与主进程 `webContents.send` 的 actionId 一致（kebab-case） */
export const GLOBAL_SHORTCUT_ACTION_IDS = [
  "vector-record-toggle",
  "segment-start",
  "segment-end",
  "checkpoint",
] as const;

export type GlobalShortcutActionId = (typeof GLOBAL_SHORTCUT_ACTION_IDS)[number];

export const GLOBAL_SHORTCUT_LABELS: Record<GlobalShortcutActionId, string> = {
  "vector-record-toggle": "矢量录制流 开/关（当前标签须为「矢量录制」）",
  "segment-start": "打入点（segment_start）",
  "segment-end": "出点（segment_end）",
  checkpoint: "检查点（checkpoint）",
};

export type GlobalShortcutBindings = Partial<Record<GlobalShortcutActionId, string>>;

export function loadGlobalShortcutBindingsFromStorage(): GlobalShortcutBindings {
  try {
    const raw = localStorage.getItem(OD_GLOBAL_SHORTCUTS_STORAGE_KEY);
    if (!raw?.trim()) return {};
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") return {};
    const out: GlobalShortcutBindings = {};
    for (const id of GLOBAL_SHORTCUT_ACTION_IDS) {
      const v = (j as Record<string, unknown>)[id];
      if (typeof v === "string") out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveGlobalShortcutBindingsToStorage(bindings: GlobalShortcutBindings): void {
  try {
    localStorage.setItem(OD_GLOBAL_SHORTCUTS_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    /* ignore */
  }
}
