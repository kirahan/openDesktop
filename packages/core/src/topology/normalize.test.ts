import { describe, expect, it } from "vitest";
import { buildTopologySnapshot, normalizeTargets, stableNodeId } from "./normalize.js";

describe("topology normalize", () => {
  it("stableNodeId is deterministic", () => {
    const a = stableNodeId("s1", { id: "T1", type: "page", url: "http://x" });
    const b = stableNodeId("s1", { id: "T1", type: "page", url: "http://x" });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("normalizeTargets maps json/list shape", () => {
    const w: string[] = [];
    const items = [
      { id: "A", type: "page", title: "t1", url: "u1" },
      { id: "B", type: "webview", title: "t2", url: "u2" },
    ];
    const nodes = normalizeTargets("sid", items, w);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.targetId).toBe("A");
    expect(nodes[0]?.nodeId).toBeDefined();
  });

  it("buildTopologySnapshot marks partial on fetch warnings", () => {
    const snap = buildTopologySnapshot("sid", [], ["net_err"]);
    expect(snap.partial).toBe(true);
    expect(snap.warnings).toContain("net_err");
    expect(snap.nodes).toEqual([]);
  });
});
