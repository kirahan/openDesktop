import { describe, expect, it } from "vitest";
import { validateAppId, validateRecordingId } from "./appJsonPaths.js";

describe("appJsonPaths", () => {
  it("accepts safe appId", () => {
    expect(() => validateAppId("myApp")).not.toThrow();
    expect(() => validateAppId("a.b-c_1")).not.toThrow();
  });

  it("rejects path-like appId", () => {
    expect(() => validateAppId("../x")).toThrow();
    expect(() => validateAppId("a/b")).toThrow();
  });

  it("accepts recording id for filename", () => {
    expect(() => validateRecordingId("r1")).not.toThrow();
    expect(() => validateRecordingId("abc-def_2")).not.toThrow();
  });
});
