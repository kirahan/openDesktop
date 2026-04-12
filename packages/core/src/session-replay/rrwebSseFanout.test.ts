import { describe, expect, it } from "vitest";
import { RrwebSseFanout } from "./rrwebSseFanout.js";

describe("RrwebSseFanout", () => {
  it("晚订阅仍能收到先 emit 的缓冲行", () => {
    const f = new RrwebSseFanout(100);
    const out: string[] = [];
    f.emit('{"type":4,"timestamp":1}');
    f.emit('{"type":2,"timestamp":2}');
    f.subscribe((line) => {
      out.push(line);
    });
    expect(out).toEqual(['{"type":4,"timestamp":1}', '{"type":2,"timestamp":2}']);
  });

  it("订阅后新 emit 只推送一次", () => {
    const f = new RrwebSseFanout(100);
    const out: string[] = [];
    f.emit('{"type":4}');
    f.subscribe((line) => out.push(line));
    f.emit('{"type":3}');
    expect(out).toEqual(['{"type":4}', '{"type":3}']);
  });

  it("超过上限时丢弃最旧行", () => {
    const f = new RrwebSseFanout(2);
    f.emit("a");
    f.emit("b");
    f.emit("c");
    const out: string[] = [];
    f.subscribe((line) => out.push(line));
    expect(out).toEqual(["b", "c"]);
  });
});
