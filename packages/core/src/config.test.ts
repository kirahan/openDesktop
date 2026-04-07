import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses OPENDESKTOP_DATA_DIR when set", () => {
    vi.stubEnv("OPENDESKTOP_DATA_DIR", "/tmp/od-data");
    const c = loadConfig();
    expect(c.dataDir).toBe("/tmp/od-data");
    vi.unstubAllEnvs();
  });

  it("overrides homedir-based default with explicit dataDir", () => {
    const c = loadConfig({ dataDir: "/custom/data" });
    expect(c.dataDir).toBe("/custom/data");
    expect(c.tokenFile).toMatch(/token\.txt$/);
  });

  it("defaults host to loopback", () => {
    const c = loadConfig({ dataDir: "/x" });
    expect(c.host).toBe("127.0.0.1");
  });
});
