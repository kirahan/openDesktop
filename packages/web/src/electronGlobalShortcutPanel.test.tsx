import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { ElectronGlobalShortcutPanel } from "./electronGlobalShortcutPanel.js";

describe("ElectronGlobalShortcutPanel", () => {
  const orig = window.__OD_SHELL__;
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    window.__OD_SHELL__ = orig;
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  });

  function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(el);
    });
  }

  it("does not render when not Electron shell", () => {
    window.__OD_SHELL__ = undefined;
    mount(<ElectronGlobalShortcutPanel />);
    expect(host?.textContent ?? "").not.toContain("全局快捷键");
  });

  it("renders when Electron exposes setGlobalShortcutBindings", () => {
    window.__OD_SHELL__ = {
      kind: "electron",
      version: "0",
      setGlobalShortcutBindings: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
    };
    mount(<ElectronGlobalShortcutPanel />);
    expect(host?.textContent ?? "").toContain("全局快捷键（仅 Electron）");
    expect(host?.textContent ?? "").toContain("保存并注册");
  });
});
