import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyElectronShellBearerTokenPrefillIfEmpty,
  getElectronShell,
} from "./studioShell.js";

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
      getCoreBearerToken: () => Promise.resolve(null),
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

describe("applyElectronShellBearerTokenPrefillIfEmpty", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error cleanup
    delete window.__OD_SHELL__;
    localStorage.removeItem("od_token");
  });

  it("does nothing when current token is non-empty", async () => {
    localStorage.setItem("od_token", "existing");
    window.__OD_SHELL__ = {
      kind: "electron",
      version: "0.1.0",
      getCoreBearerToken: () => Promise.resolve("from-file"),
      pickExecutableFile: () => Promise.resolve(null),
    };
    const applied: string[] = [];
    await applyElectronShellBearerTokenPrefillIfEmpty(
      () => localStorage.getItem("od_token") ?? "",
      (t) => applied.push(t),
    );
    expect(applied).toEqual([]);
  });

  it("applies token from shell when storage is empty", async () => {
    window.__OD_SHELL__ = {
      kind: "electron",
      version: "0.1.0",
      getCoreBearerToken: () => Promise.resolve("abc123"),
      pickExecutableFile: () => Promise.resolve(null),
    };
    const applied: string[] = [];
    await applyElectronShellBearerTokenPrefillIfEmpty(
      () => localStorage.getItem("od_token") ?? "",
      (t) => applied.push(t),
    );
    expect(applied).toEqual(["abc123"]);
    expect(localStorage.getItem("od_token")).toBe("abc123");
  });

  it("does not apply if user filled token while IPC was in flight", async () => {
    window.__OD_SHELL__ = {
      kind: "electron",
      version: "0.1.0",
      getCoreBearerToken: () =>
        new Promise((r) => {
          window.setTimeout(() => r("from-file"), 10);
        }),
      pickExecutableFile: () => Promise.resolve(null),
    };
    const applied: string[] = [];
    const p = applyElectronShellBearerTokenPrefillIfEmpty(
      () => localStorage.getItem("od_token") ?? "",
      (t) => applied.push(t),
    );
    localStorage.setItem("od_token", "user-typed");
    await p;
    expect(applied).toEqual([]);
    expect(localStorage.getItem("od_token")).toBe("user-typed");
  });
});
