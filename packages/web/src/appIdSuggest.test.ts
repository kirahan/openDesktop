import { describe, expect, it } from "vitest";
import {
  appIdExists,
  parseAppIdsFromListJson,
  randomAppIdSuffix,
  slugFromExecutablePath,
  suggestedAppIdFromExecutablePath,
} from "./appIdSuggest.js";

describe("slugFromExecutablePath", () => {
  it("strips extension and lowercases", () => {
    expect(slugFromExecutablePath("C:\\\\Prog\\\\MyApp.exe")).toBe("myapp");
    expect(slugFromExecutablePath("/usr/bin/foo-bar")).toBe("foo-bar");
  });

  it("returns app for empty input", () => {
    expect(slugFromExecutablePath("   ")).toBe("app");
  });
});

describe("randomAppIdSuffix", () => {
  it("uses at most 6 alphanumeric chars", () => {
    const s = randomAppIdSuffix();
    expect(s.length).toBeLessThanOrEqual(6);
    expect(s.length).toBeGreaterThanOrEqual(1);
    expect(s).toMatch(/^[a-z0-9]+$/);
  });
});

describe("suggestedAppIdFromExecutablePath", () => {
  it("combines slug and short alphanumeric suffix", () => {
    const id = suggestedAppIdFromExecutablePath("/bin/MyTool.exe");
    expect(id).toMatch(/^mytool-[a-z0-9]{1,6}$/);
  });
});

describe("parseAppIdsFromListJson", () => {
  it("parses apps array and strips extra fields", () => {
    const raw = JSON.stringify({
      apps: [{ id: "a" }, { id: "b", name: "x" }],
    });
    expect(parseAppIdsFromListJson(raw)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("returns empty on invalid json", () => {
    expect(parseAppIdsFromListJson("not json")).toEqual([]);
  });
});

describe("appIdExists", () => {
  it("detects duplicate id", () => {
    expect(appIdExists([{ id: "x" }], "x")).toBe(true);
    expect(appIdExists([{ id: "x" }], "y")).toBe(false);
  });
});
