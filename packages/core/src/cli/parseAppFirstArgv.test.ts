import { describe, expect, it } from "vitest";
import { tryParseAppFirstArgv } from "./parseAppFirstArgv.js";

describe("tryParseAppFirstArgv", () => {
  it("returns not-app-first for reserved first token", () => {
    expect(tryParseAppFirstArgv(["session", "list"]).kind).toBe("not-app-first");
  });

  it("returns not-app-first for session create <profileId> (three tokens)", () => {
    expect(tryParseAppFirstArgv(["session", "create", "xiezuo"]).kind).toBe("not-app-first");
  });

  it("accepts topology as alias of list-window", () => {
    const r = tryParseAppFirstArgv(["my-app", "topology"]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.command).toBe("topology");
  });

  it("parses app-first snapshot", () => {
    const r = tryParseAppFirstArgv(["my-app", "snapshot"]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.appId).toBe("my-app");
      expect(r.command).toBe("snapshot");
      expect(r.format).toBe("table");
    }
  });

  it("parses flags before positionals", () => {
    const r = tryParseAppFirstArgv(["--format", "json", "my-app", "metrics"]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.format).toBe("json");
      expect(r.command).toBe("metrics");
    }
  });

  it("parses --session", () => {
    const r = tryParseAppFirstArgv(["--session", "uuid-1", "my-app", "list-window"]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.sessionId).toBe("uuid-1");
    }
  });

  it("rejects unknown subcommand", () => {
    expect(tryParseAppFirstArgv(["my-app", "nope"]).kind).toBe("not-app-first");
  });

  it("rejects extra positionals", () => {
    const r = tryParseAppFirstArgv(["my-app", "snapshot", "extra"]);
    expect(r.kind).toBe("error");
  });
});
