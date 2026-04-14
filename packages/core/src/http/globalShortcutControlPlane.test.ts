import { describe, expect, it } from "vitest";
import { pageTargetIdsFromTopology } from "./globalShortcutControlPlane.js";

describe("pageTargetIdsFromTopology", () => {
  it("keeps only type page and dedupes targetId", () => {
    expect(
      pageTargetIdsFromTopology([
        { targetId: "A", type: "page" },
        { targetId: "B", type: "service_worker" },
        { targetId: "A", type: "page" },
      ]),
    ).toEqual(["A"]);
  });
});
