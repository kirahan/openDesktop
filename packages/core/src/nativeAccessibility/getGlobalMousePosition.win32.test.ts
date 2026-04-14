import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

describe("getGlobalMousePosition (win32 GetCursorPos 路径)", () => {
  let platformBackup: PropertyDescriptor | undefined;

  beforeEach(() => {
    platformBackup = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: object,
        cb: (err: Error | null, result?: { stdout: string }) => void,
      ) => {
        cb(null, { stdout: "128,256\n" });
      },
    );
  });

  afterEach(() => {
    execFileMock.mockReset();
    if (platformBackup) Object.defineProperty(process, "platform", platformBackup);
  });

  it("解析 PowerShell 输出的屏幕坐标为整数", async () => {
    vi.resetModules();
    const { getGlobalMousePosition } = await import("./getGlobalMousePosition.js");
    const r = await getGlobalMousePosition();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.x).toBe(128);
      expect(r.y).toBe(256);
    }
    expect(execFileMock).toHaveBeenCalled();
    const firstCall = execFileMock.mock.calls[0];
    expect(firstCall?.[0]).toBe("powershell.exe");
  });

  it("stdout 无法解析时返回 MOUSE_POSITION_UNAVAILABLE", async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: object,
        cb: (err: Error | null, result?: { stdout: string }) => void,
      ) => {
        cb(null, { stdout: "not-a-pair\n" });
      },
    );
    vi.resetModules();
    const { getGlobalMousePosition } = await import("./getGlobalMousePosition.js");
    const r = await getGlobalMousePosition();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MOUSE_POSITION_UNAVAILABLE");
  });
});
