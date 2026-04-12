import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RrwebReplayView } from "./RrwebReplayView.js";

const { ReplayerMock } = vi.hoisted(() => {
  const ReplayerMock = vi.fn(function ReplayerMock(this: {
    pause: () => void;
    startLive: () => void;
    addEvent: (e: unknown) => void;
  }) {
    this.pause = vi.fn();
    this.startLive = vi.fn();
    this.addEvent = vi.fn();
  });
  return { ReplayerMock };
});

vi.mock("rrweb", () => ({
  Replayer: ReplayerMock,
}));

describe("RrwebReplayView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    ReplayerMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it("在最小事件列表下挂载且不抛错", () => {
    const events = [{ type: 0, timestamp: Date.now() }];
    expect(() => {
      act(() => {
        root.render(<RrwebReplayView events={events} />);
      });
    }).not.toThrow();
    expect(ReplayerMock).not.toHaveBeenCalled();
  });

  it("事件从 2 条增至 3 条时只构造一次 Replayer，并对新增事件调用 addEvent", () => {
    const t = Date.now();
    const base = [
      { type: 4, timestamp: t, data: { href: "http://x", width: 800, height: 600 } },
      {
        type: 2,
        timestamp: t + 1,
        data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } },
      },
    ];
    act(() => {
      root.render(<RrwebReplayView events={base} />);
    });
    expect(ReplayerMock).toHaveBeenCalledTimes(1);

    const inst = ReplayerMock.mock.instances[0] as { addEvent: ReturnType<typeof vi.fn> };
    expect(inst.addEvent).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <RrwebReplayView
          events={[
            ...base,
            { type: 3, timestamp: t + 2, data: { source: 3, id: 1, x: 0, y: 0 } },
          ]}
        />,
      );
    });

    expect(ReplayerMock).toHaveBeenCalledTimes(1);
    expect(inst.addEvent).toHaveBeenCalledTimes(1);
  });
});
