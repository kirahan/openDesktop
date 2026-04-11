import { describe, expect, it } from "vitest";
import {
  appIdExists,
  formatAppIdConflictMessage,
  parseAppIdsFromListJson,
} from "./appRegistrationHelpers.js";

describe("parseAppIdsFromListJson", () => {
  it("parses apps array", () => {
    const raw = JSON.stringify({
      apps: [{ id: "a" }, { id: "b", name: "x" }],
    });
    expect(parseAppIdsFromListJson(raw)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("returns empty on invalid json", () => {
    expect(parseAppIdsFromListJson("not json")).toEqual([]);
  });

  it("returns empty when apps missing", () => {
    expect(parseAppIdsFromListJson("{}")).toEqual([]);
  });
});

describe("appIdExists", () => {
  it("detects duplicate id", () => {
    expect(appIdExists([{ id: "x" }], "x")).toBe(true);
    expect(appIdExists([{ id: "x" }], "y")).toBe(false);
  });
});

describe("formatAppIdConflictMessage", () => {
  it("includes id", () => {
    expect(formatAppIdConflictMessage("my-app")).toContain("my-app");
  });
});
