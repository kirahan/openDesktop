import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses OPENDESKTOP_DATA_DIR when set", () => {
    vi.stubEnv("OPENDESKTOP_DATA_DIR", "/tmp/od-data");
    const c = loadConfig();
    expect(c.dataDir).toBe(path.resolve("/tmp/od-data"));
    vi.unstubAllEnvs();
  });

  it("overrides homedir-based default with explicit dataDir", () => {
    const root = path.resolve("/custom/data");
    const c = loadConfig({ dataDir: "/custom/data" });
    expect(c.dataDir).toBe(root);
    expect(c.tokenFile).toMatch(/token\.txt$/);
  });

  it("defaults host to loopback", () => {
    const c = loadConfig({ dataDir: "/x" });
    expect(c.host).toBe("127.0.0.1");
  });

  it("defaults recipesDir under dataDir", () => {
    const root = path.resolve("/custom/data");
    const c = loadConfig({ dataDir: "/custom/data" });
    expect(c.recipesDir).toBe(path.resolve(path.join(root, "recipes")));
  });

  it("defaults appJsonDir under dataDir", () => {
    const root = path.resolve("/custom/data");
    const c = loadConfig({ dataDir: "/custom/data" });
    expect(c.appJsonDir).toBe(path.resolve(path.join(root, "app-json")));
  });

  it("uses OPENDESKTOP_APP_JSON_DIR when set", () => {
    vi.stubEnv("OPENDESKTOP_APP_JSON_DIR", "/tmp/od-json-root");
    const c = loadConfig({ dataDir: "/x" });
    expect(c.appJsonDir).toBe(path.resolve("/tmp/od-json-root"));
    vi.unstubAllEnvs();
  });

  it("uses OPENDESKTOP_WEB_DIST for webDist when no override", () => {
    vi.stubEnv("OPENDESKTOP_WEB_DIST", "/tmp/od-web");
    const c = loadConfig({ dataDir: "/x" });
    expect(c.webDist).toBe(path.resolve("/tmp/od-web"));
    vi.unstubAllEnvs();
  });

  it("override webDist wins over OPENDESKTOP_WEB_DIST", () => {
    vi.stubEnv("OPENDESKTOP_WEB_DIST", "/env/web");
    const c = loadConfig({ dataDir: "/x", webDist: "/flag/web" });
    expect(c.webDist).toBe(path.resolve("/flag/web"));
    vi.unstubAllEnvs();
  });
});
