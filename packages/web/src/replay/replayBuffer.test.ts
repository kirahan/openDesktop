import { describe, expect, it } from "vitest";
import { appendReplayLogLines, REPLAY_LOG_MAX_LINES } from "./replayBuffer.js";

describe("appendReplayLogLines", () => {
  it("caps length", () => {
    let lines: string[] = [];
    for (let i = 0; i < REPLAY_LOG_MAX_LINES + 10; i++) {
      lines = appendReplayLogLines(lines, `e${i}`);
    }
    expect(lines.length).toBe(REPLAY_LOG_MAX_LINES);
    expect(lines[0]).toBe("e10");
  });
});
