import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_EXCEPTION_TEXT,
  MAX_RUNTIME_STACK_FRAMES,
  mapStackTraceCallFrames,
  parseExceptionDetailsFromThrown,
  truncateExceptionText,
} from "./runtimeExceptionStack.js";

describe("runtimeExceptionStack", () => {
  it("parseExceptionDetailsFromThrown maps multi-frame stackTrace", () => {
    const params = {
      timestamp: 1,
      exceptionDetails: {
        text: "TypeError: x",
        stackTrace: {
          callFrames: [
            {
              functionName: "inner",
              url: "https://ex.example/app.js?x=1#frag",
              lineNumber: 10,
              columnNumber: 2,
            },
            {
              functionName: "outer",
              url: "https://ex.example/other.js",
              lineNumber: 0,
              columnNumber: 0,
            },
          ],
        },
      },
    };
    const r = parseExceptionDetailsFromThrown(params);
    expect(r.text).toBe("TypeError: x");
    expect(r.textTruncated).toBe(false);
    expect(r.frames).toHaveLength(2);
    expect(r.frames[0].functionName).toBe("inner");
    expect(r.frames[0].url).toContain("https://ex.example/app.js");
    expect(r.frames[0].url).not.toContain("?");
    expect(r.frames[0].lineNumber).toBe(10);
    expect(r.frames[0].columnNumber).toBe(2);
    expect(r.frames[1].functionName).toBe("outer");
  });

  it("parseExceptionDetailsFromThrown yields empty frames when stack missing", () => {
    const r = parseExceptionDetailsFromThrown({
      exceptionDetails: { text: "only message" },
    });
    expect(r.text).toBe("only message");
    expect(r.frames).toEqual([]);
  });

  it("truncateExceptionText truncates long text", () => {
    const long = "a".repeat(MAX_RUNTIME_EXCEPTION_TEXT + 50);
    const r = truncateExceptionText(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_RUNTIME_EXCEPTION_TEXT + 1);
    expect(r.text.endsWith("…")).toBe(true);
  });

  it("mapStackTraceCallFrames caps frame count", () => {
    const frames = Array.from({ length: MAX_RUNTIME_STACK_FRAMES + 10 }, (_, i) => ({
      functionName: `f${i}`,
      url: `https://e/${i}`,
      lineNumber: i,
      columnNumber: 0,
    }));
    const out = mapStackTraceCallFrames({ callFrames: frames });
    expect(out).toHaveLength(MAX_RUNTIME_STACK_FRAMES);
    expect(out[0].functionName).toBe("f0");
    expect(out[MAX_RUNTIME_STACK_FRAMES - 1].functionName).toBe(`f${MAX_RUNTIME_STACK_FRAMES - 1}`);
  });

  it("parseExceptionDetailsFromThrown handles empty input", () => {
    expect(parseExceptionDetailsFromThrown(null)).toEqual({
      text: "",
      textTruncated: false,
      frames: [],
    });
    expect(parseExceptionDetailsFromThrown({})).toEqual({
      text: "",
      textTruncated: false,
      frames: [],
    });
  });
});
