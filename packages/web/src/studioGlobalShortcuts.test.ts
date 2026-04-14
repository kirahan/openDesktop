import { afterEach, describe, expect, it } from "vitest";
import {
  GLOBAL_SHORTCUT_ACTION_IDS,
  loadGlobalShortcutBindingsFromStorage,
  OD_GLOBAL_SHORTCUTS_STORAGE_KEY,
  saveGlobalShortcutBindingsToStorage,
} from "./studioGlobalShortcuts.js";

describe("studioGlobalShortcuts", () => {
  afterEach(() => {
    localStorage.removeItem(OD_GLOBAL_SHORTCUTS_STORAGE_KEY);
  });

  it("round-trips bindings", () => {
    saveGlobalShortcutBindingsToStorage({
      "vector-record-toggle": "CommandOrControl+Shift+9",
      "segment-start": "CommandOrControl+Shift+1",
    });
    const loaded = loadGlobalShortcutBindingsFromStorage();
    expect(loaded["vector-record-toggle"]).toBe("CommandOrControl+Shift+9");
    expect(loaded["segment-start"]).toBe("CommandOrControl+Shift+1");
  });

  it("lists stable action ids", () => {
    expect(GLOBAL_SHORTCUT_ACTION_IDS).toContain("checkpoint");
  });
});
