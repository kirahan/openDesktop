import { describe, expect, it } from "vitest";
import { tryParseAppFirstArgv } from "./parseAppFirstArgv.js";

describe("tryParseAppFirstArgv", () => {
  it("returns not-app-first for reserved first token", () => {
    expect(tryParseAppFirstArgv(["session", "list"]).kind).toBe("not-app-first");
  });

  it("returns not-app-first for session start <profileId> (three tokens)", () => {
    expect(tryParseAppFirstArgv(["session", "start", "xiezuo"]).kind).toBe("not-app-first");
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

  it("parses list-window", () => {
    const r = tryParseAppFirstArgv(["my-app", "list-window"]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.command).toBe("list-window");
  });

  it("parses network-observe with optional flags", () => {
    const r = tryParseAppFirstArgv([
      "--window-ms",
      "5000",
      "--slow-ms",
      "800",
      "--no-strip-query",
      "my-app",
      "network-observe",
    ]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.command).toBe("network-observe");
      expect(r.windowMs).toBe(5000);
      expect(r.slowThresholdMs).toBe(800);
      expect(r.stripQuery).toBe(false);
    }
  });

  it("parses network-stream with optional flags", () => {
    const r = tryParseAppFirstArgv([
      "--no-strip-query",
      "--max-events-per-second",
      "50",
      "my-app",
      "network-stream",
    ]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.command).toBe("network-stream");
      expect(r.stripQuery).toBe(false);
      expect(r.maxEventsPerSecond).toBe(50);
    }
  });

  it("parses console-observe and stack-observe with --wait-ms", () => {
    const c = tryParseAppFirstArgv(["--wait-ms", "1500", "my-app", "console-observe"]);
    expect(c.kind).toBe("ok");
    if (c.kind === "ok") {
      expect(c.command).toBe("console-observe");
      expect(c.waitMs).toBe(1500);
    }
    const s = tryParseAppFirstArgv(["my-app", "stack-observe"]);
    expect(s.kind).toBe("ok");
    if (s.kind === "ok") expect(s.command).toBe("stack-observe");
  });

  it("parses explore with optional flags", () => {
    const r = tryParseAppFirstArgv([
      "--max-candidates",
      "16",
      "--min-score",
      "0.5",
      "--include-anchor-buttons",
      "my-app",
      "explore",
    ]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.command).toBe("explore");
      expect(r.maxCandidates).toBe(16);
      expect(r.minScore).toBe(0.5);
      expect(r.includeAnchorButtons).toBe(true);
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

  it("rejects unknown subcommand with explicit error (app-first shape)", () => {
    const r = tryParseAppFirstArgv(["my-app", "nope"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("未知 App-first 子命令");
      expect(r.message).toContain("nope");
      expect(r.message).toContain("explore");
    }
  });

  it("rejects extra positionals", () => {
    const r = tryParseAppFirstArgv(["my-app", "snapshot", "extra"]);
    expect(r.kind).toBe("error");
  });

  it("list-global without --target is ok (run time resolves from list-window)", () => {
    const r = tryParseAppFirstArgv(["my-app", "list-global"]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.command).toBe("list-global");
  });

  it("parses list-global with --target and optional flags", () => {
    const r = tryParseAppFirstArgv([
      "my-app",
      "list-global",
      "--target",
      "tid-1",
      "--interest",
      "^a",
      "--max-keys",
      "100",
    ]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.command).toBe("list-global");
      expect(r.targetId).toBe("tid-1");
      expect(r.interestPattern).toBe("^a");
      expect(r.maxKeys).toBe(100);
    }
  });
});
