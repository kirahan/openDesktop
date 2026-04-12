import { describe, expect, it } from "vitest";
import { parseRrwebEventLine } from "./rrwebRecordingService.js";

describe("parseRrwebEventLine", () => {
  it("accepts rrweb event with numeric type", () => {
    const s = parseRrwebEventLine(JSON.stringify({ type: 2, data: { x: 1 }, timestamp: 0 }));
    expect(s).toContain('"type":2');
  });

  it("rejects non-object", () => {
    expect(parseRrwebEventLine("1")).toBeNull();
  });

  it("rejects missing numeric type", () => {
    expect(parseRrwebEventLine(JSON.stringify({ type: "x" }))).toBeNull();
  });
});
