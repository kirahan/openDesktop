import { afterEach, describe, expect, it, vi } from "vitest";
import { getElectronShell } from "./studioShell.js";

describe("getElectronShell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error cleanup
    delete window.__OD_SHELL__;
  });

  it("returns undefined when preload not present", () => {
    expect(getElectronShell()).toBeUndefined();
  });

  it("returns shell when kind is electron", () => {
    window.__OD_SHELL__ = {
      kind: "electron",
      version: "0.1.0",
      pickExecutableFile: () => Promise.resolve("/bin/sh"),
    };
    const s = getElectronShell();
    expect(s?.kind).toBe("electron");
    expect(s?.version).toBe("0.1.0");
  });

  it("returns undefined for unknown kind", () => {
    window.__OD_SHELL__ = {
      kind: "browser",
      version: "0",
      pickExecutableFile: () => Promise.resolve(null),
    } as unknown as Window["__OD_SHELL__"];
    expect(getElectronShell()).toBeUndefined();
  });
});
