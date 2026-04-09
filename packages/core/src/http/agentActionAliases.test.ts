import { describe, expect, it } from "vitest";
import {
  isLegacyAgentActionAlias,
  isSupportedAgentCanonical,
  listAgentActionNamesForVersion,
  normalizeAgentAction,
} from "./agentActionAliases.js";

describe("agentActionAliases", () => {
  it("maps legacy topology to state", () => {
    expect(normalizeAgentAction("topology")).toBe("state");
    expect(normalizeAgentAction("Topology")).toBe("state");
    expect(isLegacyAgentActionAlias("topology")).toBe(true);
  });

  it("maps legacy dom to get", () => {
    expect(normalizeAgentAction("dom")).toBe("get");
    expect(isLegacyAgentActionAlias("dom")).toBe(true);
  });

  it("passes through canonical verbs unchanged", () => {
    expect(normalizeAgentAction("state")).toBe("state");
    expect(normalizeAgentAction("get")).toBe("get");
    expect(normalizeAgentAction("screenshot")).toBe("screenshot");
    expect(isLegacyAgentActionAlias("get")).toBe(false);
  });

  it("isSupportedAgentCanonical for OpenCLI-aligned verbs", () => {
    expect(isSupportedAgentCanonical("state")).toBe(true);
    expect(isSupportedAgentCanonical("get")).toBe(true);
    expect(isSupportedAgentCanonical("open")).toBe(true);
    expect(isSupportedAgentCanonical("not-a-real-action")).toBe(false);
  });

  it("listAgentActionNamesForVersion includes canonical and legacy names", () => {
    const list = listAgentActionNamesForVersion();
    expect(list).toContain("state");
    expect(list).toContain("get");
    expect(list).toContain("open");
    expect(list).toContain("network");
    expect(list).toContain("window-state");
    expect(list).toContain("focus-window");
    expect(list).toContain("renderer-globals");
    expect(list).toContain("explore");
    expect(list).toContain("topology");
    expect(list).toContain("dom");
    expect(list).toContain("console-messages");
  });
});
