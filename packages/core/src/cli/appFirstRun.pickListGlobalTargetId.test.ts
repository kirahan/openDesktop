import { describe, expect, it } from "vitest";
import { pickListGlobalTargetId } from "./appFirstRun.js";
import type { TopologyNode } from "../topology/types.js";

function n(p: Partial<TopologyNode> & Pick<TopologyNode, "targetId" | "type">): TopologyNode {
  return {
    nodeId: "n",
    title: "",
    url: "",
    ...p,
  };
}

describe("pickListGlobalTargetId", () => {
  it("picks the only page", () => {
    expect(pickListGlobalTargetId([n({ targetId: "A", type: "page" })])).toEqual({ targetId: "A" });
  });

  it("picks sole node when type is not page", () => {
    expect(pickListGlobalTargetId([n({ targetId: "B", type: "webview" })])).toEqual({ targetId: "B" });
  });

  it("errors when empty", () => {
    const r = pickListGlobalTargetId([]);
    expect("error" in r && r.error).toBeTruthy();
  });

  it("picks first node when multiple targets", () => {
    const r = pickListGlobalTargetId([
      n({ targetId: "p1", type: "page", title: "a" }),
      n({ targetId: "p2", type: "page", title: "b" }),
    ]);
    expect(r).toEqual({ targetId: "p1" });
  });
});
