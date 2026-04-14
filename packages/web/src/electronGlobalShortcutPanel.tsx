import React, { useCallback, useEffect, useState } from "react";
import {
  GLOBAL_SHORTCUT_ACTION_IDS,
  GLOBAL_SHORTCUT_LABELS,
  type GlobalShortcutActionId,
  type GlobalShortcutBindings,
  loadGlobalShortcutBindingsFromStorage,
  saveGlobalShortcutBindingsToStorage,
} from "./studioGlobalShortcuts.js";
import { electronAcceleratorFromKeyboardEvent } from "./electronAcceleratorFromKeyboardEvent.js";
import { getElectronShell } from "./studioShell.js";

const LOG_PREFIX = "[openDesktop][global-shortcut][ui]";

/**
 * 仅 Electron 壳内展示：配置全局快捷键并同步主进程。
 */
export function ElectronGlobalShortcutPanel() {
  const sh = getElectronShell();
  const [bindings, setBindings] = useState<GlobalShortcutBindings>(() => loadGlobalShortcutBindingsFromStorage());
  const [lastApplyMsg, setLastApplyMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 正在录制快捷键的动作 ID；按下组合键后写入对应 binding。 */
  const [recordingId, setRecordingId] = useState<GlobalShortcutActionId | null>(null);

  useEffect(() => {
    if (!recordingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        console.info(LOG_PREFIX, "取消录制", { recordingId });
        setRecordingId(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const acc = electronAcceleratorFromKeyboardEvent(e);
      if (acc) {
        console.info(LOG_PREFIX, "录制成功", { recordingId, acc });
        setBindings((prev) => ({ ...prev, [recordingId]: acc }));
        setRecordingId(null);
      } else {
        console.info(LOG_PREFIX, "忽略按键（需含 ⌘/Ctrl/Alt 之一，或为 F1–F24）", {
          recordingId,
          code: e.code,
          key: e.key,
        });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingId]);

  const applyToMain = useCallback(
    async (next: GlobalShortcutBindings, reason: string, opts?: { skipBusy?: boolean }) => {
    if (!sh?.setGlobalShortcutBindings) {
      console.info(LOG_PREFIX, "跳过：壳无 setGlobalShortcutBindings");
      setLastApplyMsg("壳版本过旧，缺少 setGlobalShortcutBindings");
      return;
    }
    console.info(LOG_PREFIX, "invoke 主进程", reason, { bindings: next });
    if (!opts?.skipBusy) {
      setBusy(true);
      setLastApplyMsg(null);
    }
    try {
      const r = (await sh.setGlobalShortcutBindings(next)) as {
        ok?: boolean;
        errors?: Array<{
          actionId: string;
          accelerator: string;
          code: string;
          otherActionId?: string;
        }>;
      };
      console.info(LOG_PREFIX, "主进程返回", reason, r);
      if (r?.ok && (!r.errors || r.errors.length === 0)) {
        if (!opts?.skipBusy) {
          setLastApplyMsg("已应用全局快捷键");
        }
      } else if (Array.isArray(r?.errors) && r.errors.length > 0) {
        setLastApplyMsg(
          `部分快捷键注册失败：${r.errors
            .map((e) => {
              if (e.code === "DUPLICATE_ACCELERATOR" && e.otherActionId) {
                return `${e.actionId}「${e.accelerator}」与 ${e.otherActionId} 重复`;
              }
              return `${e.actionId}「${e.accelerator}」`;
            })
            .join("；")}（若格式无误仍失败，多为已被系统或其他应用占用）`,
        );
      } else {
        if (!opts?.skipBusy) {
          setLastApplyMsg("已提交（状态未知）");
        }
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "invoke 异常", reason, e);
      setLastApplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      if (!opts?.skipBusy) {
        setBusy(false);
      }
    }
  },
  [sh],
);

  useEffect(() => {
    const next = loadGlobalShortcutBindingsFromStorage();
    const sh0 = getElectronShell();
    if (sh0?.setGlobalShortcutBindings) {
      console.info(LOG_PREFIX, "挂载：从 localStorage 同步到主进程（启动）", { bindings: next });
      void applyToMain(next, "mount", { skipBusy: true });
    } else {
      console.info(LOG_PREFIX, "挂载：无 setGlobalShortcutBindings，跳过同步");
    }
  }, [applyToMain]);

  const onSave = () => {
    console.info(LOG_PREFIX, "点击「保存并注册」", { bindings });
    saveGlobalShortcutBindingsToStorage(bindings);
    void applyToMain(bindings, "save");
  };

  const onReset = () => {
    console.info(LOG_PREFIX, "点击「清空全部」");
    const empty: GlobalShortcutBindings = {};
    setBindings(empty);
    saveGlobalShortcutBindingsToStorage(empty);
    void applyToMain(empty, "reset");
  };

  const setAcc = (id: GlobalShortcutActionId, value: string) => {
    setBindings((prev) => ({ ...prev, [id]: value }));
  };

  if (!sh?.setGlobalShortcutBindings) return null;

  return (
    <div
      style={{
        marginBottom: 10,
        padding: 10,
        borderRadius: 8,
        border: "1px solid #e2e8f0",
        background: "#f8fafc",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>全局快捷键（仅 Electron）</div>
      <p style={{ margin: "0 0 8px", fontSize: 11, color: "#0f172a", lineHeight: 1.45, fontWeight: 500 }}>
        <strong>点「录制快捷键」</strong>后按下组合键（须含 <code>⌘</code>/<code>Ctrl</code>/<code>Alt</code>
        之一；或单独 <code>F1</code>–<code>F24</code>）即可填入；也可在输入框内<strong>手动改字</strong>。最后点「保存并注册」。录制中按{" "}
        <code>Esc</code> 取消。
      </p>
      <p style={{ margin: "0 0 8px", fontSize: 11, color: "#64748b", lineHeight: 1.45 }}>
        使用系统级全局快捷键；格式见{" "}
        <a href="https://www.electronjs.org/docs/latest/api/accelerator" target="_blank" rel="noreferrer">
          Electron Accelerator
        </a>
        。主进程仍会规范化并注册。若与系统快捷键冲突会注册失败。macOS 非 QWERTY 布局下 Electron 全局快捷键存在已知限制。
        <strong>业务路径</strong>：主进程直连 Core <code>control/global-shortcut</code>。未在 Studio 固定会话时，主进程会从 Core 拉取 <strong>running</strong> 会话并依次调用；<strong>矢量开/关</strong>由 Core 按各会话 CDP 页 target 处理。可选打开会话详情 / 矢量 Tab 以收窄作用域或指定打点 target。
      </p>
      <p style={{ margin: "0 0 8px", fontSize: 11, color: "#64748b", lineHeight: 1.45 }}>
        <strong>多路矢量录制并行时（同一会话多个 target）：</strong>
        打入点 / 出点 / 检查点类快捷键仅对<strong>当前选中的观测标签</strong>所绑定的 <code>targetId</code> 生效（与对应按钮一致）；合并时间线上的顺序由 Core 下发的{" "}
        <code>mergeTs</code>、<code>targetId</code>、<code>seq</code> 决定。
      </p>
      {recordingId ? (
        <p style={{ margin: "0 0 8px", padding: "6px 8px", borderRadius: 6, background: "#fef3c7", color: "#92400e", fontSize: 11 }}>
          正在录制：<strong>{GLOBAL_SHORTCUT_LABELS[recordingId]}</strong> — 请按下目标组合键，或 <code>Esc</code>{" "}
          取消。
        </p>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {GLOBAL_SHORTCUT_ACTION_IDS.map((id) => (
          <label
            key={id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "stretch",
              padding: recordingId === id ? 8 : 0,
              margin: recordingId === id ? -4 : 0,
              borderRadius: 8,
              outline: recordingId === id ? "2px solid #d97706" : "none",
              outlineOffset: 0,
            }}
          >
            <span style={{ color: "#475569", fontSize: 11 }}>{GLOBAL_SHORTCUT_LABELS[id]}</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                value={bindings[id] ?? ""}
                onChange={(e) => setAcc(id, e.target.value)}
                placeholder="留空表示不绑定"
                readOnly={recordingId === id}
                style={{
                  flex: "1 1 140px",
                  minWidth: 120,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 12,
                  fontFamily: "ui-monospace, Menlo, monospace",
                  background: recordingId === id ? "#fffbeb" : "#fff",
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (recordingId === id) {
                    setRecordingId(null);
                    return;
                  }
                  setRecordingId(id);
                }}
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  borderRadius: 6,
                  border: `1px solid ${recordingId === id ? "#d97706" : "#cbd5e1"}`,
                  background: recordingId === id ? "#fff7ed" : "#fff",
                  color: recordingId === id ? "#c2410c" : "#475569",
                  cursor: busy ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {recordingId === id ? "取消录制" : "录制快捷键"}
              </button>
            </div>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={busy || recordingId !== null}
          onClick={() => onSave()}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            borderRadius: 6,
            border: "none",
            background: "#2563eb",
            color: "#fff",
            cursor: busy || recordingId ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "应用中…" : recordingId ? "先结束录制" : "保存并注册"}
        </button>
        <button
          type="button"
          disabled={busy || recordingId !== null}
          onClick={() => onReset()}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#475569",
            cursor: "pointer",
          }}
        >
          清空全部
        </button>
      </div>
      {lastApplyMsg ? (
        <p style={{ margin: "8px 0 0", fontSize: 11, color: lastApplyMsg.startsWith("已") ? "#166534" : "#b91c1c" }}>
          {lastApplyMsg}
        </p>
      ) : null}
    </div>
  );
}
