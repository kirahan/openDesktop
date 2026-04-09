import { describe, expect, it, beforeEach } from "vitest";
import {
  MAX_CONCURRENT_CONSOLE_STREAMS,
  releaseConsoleStream,
  resetConsoleStreamCountForTest,
  tryAcquireConsoleStream,
} from "./consoleStreamLimiter.js";

describe("consoleStreamLimiter", () => {
  beforeEach(() => {
    resetConsoleStreamCountForTest();
  });

  it("allows up to MAX concurrent acquires", () => {
    for (let i = 0; i < MAX_CONCURRENT_CONSOLE_STREAMS; i++) {
      expect(tryAcquireConsoleStream()).toBe(true);
    }
    expect(tryAcquireConsoleStream()).toBe(false);
  });

  it("release allows another acquire", () => {
    expect(tryAcquireConsoleStream()).toBe(true);
    releaseConsoleStream();
    expect(tryAcquireConsoleStream()).toBe(true);
  });
});
