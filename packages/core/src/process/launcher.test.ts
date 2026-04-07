import { describe, expect, it } from "vitest";
import { launchDebuggedApp } from "./launcher.js";
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
});
