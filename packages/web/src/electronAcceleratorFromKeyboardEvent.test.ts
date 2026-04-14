import { describe, expect, it, vi } from "vitest";
import {
  domCodeToElectronKey,
  electronAcceleratorFromKeyboardEvent,
  isElectronRendererMac,
} from "./electronAcceleratorFromKeyboardEvent.js";

function keyDown(init: {
  code: string;
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}) {
  return new KeyboardEvent("keydown", {
    code: init.code,
    key: init.key ?? init.code,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    repeat: init.repeat ?? false,
  });
}

describe("domCodeToElectronKey", () => {
  it("maps Digit / Key / F rows", () => {
    expect(domCodeToElectronKey("Digit7")).toBe("7");
    expect(domCodeToElectronKey("KeyQ")).toBe("Q");
    expect(domCodeToElectronKey("F9")).toBe("F9");
  });

  it("maps numpad digits to num0-num9", () => {
    expect(domCodeToElectronKey("Numpad3")).toBe("num3");
  });
});

describe("electronAcceleratorFromKeyboardEvent", () => {
  it("returns null without ctrl/meta/alt (non F-key)", () => {
    const e = keyDown({ code: "KeyA", key: "a", shiftKey: true });
    expect(electronAcceleratorFromKeyboardEvent(e)).toBeNull();
  });

  it("mac: Command+Shift+digit", () => {
    vi.stubGlobal("navigator", { userAgent: "Electron/28.0.0 (Macintosh; Intel Mac OS X 14_0_0)" } as Navigator);
    const e = keyDown({
      code: "Digit9",
      key: "9",
      metaKey: true,
      shiftKey: true,
    });
    expect(electronAcceleratorFromKeyboardEvent(e)).toBe("Command+Shift+9");
    vi.unstubAllGlobals();
  });

  it("windows: Control+Alt+letter", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } as Navigator);
    const e = keyDown({
      code: "KeyM",
      key: "m",
      ctrlKey: true,
      altKey: true,
    });
    expect(electronAcceleratorFromKeyboardEvent(e)).toBe("Control+Alt+M");
    vi.unstubAllGlobals();
  });

  it("allows F9 without modifiers", () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh" } as Navigator);
    const e = keyDown({ code: "F9", key: "F9" });
    expect(electronAcceleratorFromKeyboardEvent(e)).toBe("F9");
    vi.unstubAllGlobals();
  });

  it("returns null on repeat", () => {
    const e = keyDown({ code: "Digit1", key: "1", metaKey: true, repeat: true });
    expect(electronAcceleratorFromKeyboardEvent(e)).toBeNull();
  });
});

describe("isElectronRendererMac", () => {
  it("detects Mac userAgent", () => {
    vi.stubGlobal("navigator", { userAgent: "... Macintosh ..." } as Navigator);
    expect(isElectronRendererMac()).toBe(true);
    vi.unstubAllGlobals();
  });
});
