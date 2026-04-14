import { describe, expect, it } from "vitest";
import {
  buildArgv,
  killExistingProcessesForExecutable,
  launchDebuggedApp,
} from "./launcher.js";
import type { AppDefinition, ProfileDefinition } from "../store/types.js";

describe("launchDebuggedApp", () => {
  it("captures stdout from a node child", async () => {
    const app: AppDefinition = {
      id: "t",
      name: "t",
      executable: process.execPath,
      cwd: process.cwd(),
      env: {},
      args: ["-e", 'console.log("launcher-ok")'],
      injectElectronDebugPort: false,
    };
    const profile: ProfileDefinition = {
      id: "p",
      appId: "t",
      name: "p",
      env: {},
      extraArgs: [],
    };
    const { child } = launchDebuggedApp(app, profile, 0);
    const out: string[] = [];
    child.stdout?.on("data", (b: Buffer) => out.push(b.toString()));
    await new Promise<void>((resolve, reject) => {
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      child.on("error", reject);
    });
    expect(out.join("")).toContain("launcher-ok");
  });

  it("does not pass ELECTRON_RUN_AS_NODE to child (Electron-as-Node breaks nested Electron apps)", async () => {
    const prev = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      const app: AppDefinition = {
        id: "t2",
        name: "t2",
        executable: process.execPath,
        cwd: process.cwd(),
        env: {},
        args: ["-e", 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "")'],
        injectElectronDebugPort: false,
      };
      const profile: ProfileDefinition = {
        id: "p",
        appId: "t2",
        name: "p",
        env: {},
        extraArgs: [],
      };
      const { child } = launchDebuggedApp(app, profile, 0);
      const out: string[] = [];
      child.stdout?.on("data", (b: Buffer) => out.push(b.toString()));
      await new Promise<void>((resolve, reject) => {
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
        child.on("error", reject);
      });
      expect(out.join("")).toBe("");
    } finally {
      if (prev === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = prev;
    }
  });

  it("buildArgv adds --headless=new before --remote-debugging-port when headless", () => {
    const app: AppDefinition = {
      id: "h",
      name: "h",
      executable: "/noop",
      cwd: "/",
      env: {},
      args: [],
      injectElectronDebugPort: true,
      headless: true,
    };
    const profile: ProfileDefinition = {
      id: "p",
      appId: "h",
      name: "p",
      env: {},
      extraArgs: [],
    };
    expect(buildArgv(app, profile, 9222)).toEqual(["--headless=new", "--remote-debugging-port=9222"]);
  });
});

describe("killExistingProcessesForExecutable", () => {
  it("resolves when no process matches the executable path", async () => {
    const fake =
      process.platform === "win32"
        ? "C:\\nope-open-desktop-kill-test-9999\\fake.exe"
        : "/tmp/nope-open-desktop-kill-test-9999-fake-bin";
    await expect(killExistingProcessesForExecutable(fake)).resolves.toBeUndefined();
  });
});
