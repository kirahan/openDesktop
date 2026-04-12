import React, { useEffect, useRef } from "react";
import { Replayer } from "rrweb";
/** 无此样式时 .replayer-mouse 非 absolute，会与 iframe 纵向堆叠，看起来像「蓝条在上、页面在下」 */
import "rrweb/dist/rrweb.min.css";

type RrwebReplayViewProps = {
  /** 自 Core SSE 累积的 rrweb 事件（含 timestamp） */
  events: unknown[];
};

/** rrweb Replayer 构造函数要求至少 2 条事件，否则会抛错（非 liveMode 时） */
const RRWEB_REPLAYER_MIN_EVENTS = 2;

/**
 * 录制页常引用 chrome://、扩展内等字体，在 Studio 网页里无法加载。
 * 注入系统字体栈覆盖快照中的 font-family，避免版面依赖不可用字体；个别图标字体可能退化为缺字，属可接受权衡。
 */
const RRWEB_REPLAY_FONT_FALLBACK_RULES: string[] = [
  'html, body, body * { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif !important; }',
];

type RrwebEventArray = ConstructorParameters<typeof Replayer>[0];

function destroyReplayer(
  el: HTMLDivElement,
  replayerRef: React.MutableRefObject<Replayer | null>,
  fedCountRef: React.MutableRefObject<number>,
): void {
  try {
    replayerRef.current?.pause();
  } catch {
    /* noop */
  }
  replayerRef.current = null;
  fedCountRef.current = 0;
  el.innerHTML = "";
}

/**
 * 在单容器内重放 rrweb 事件流；与指针 overlay 叠放由父级布局负责。
 * SSE 会持续追加事件：仅在首帧或缓冲被重置时 new Replayer，其余用 addEvent，避免频繁销毁与异步竞态。
 */
export function RrwebReplayView({ events }: RrwebReplayViewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const fedCountRef = useRef(0);

  const canReplay = events.length >= RRWEB_REPLAYER_MIN_EVENTS;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!canReplay) {
      destroyReplayer(el, replayerRef, fedCountRef);
      return;
    }

    const typed = events as RrwebEventArray;

    if (replayerRef.current && events.length < fedCountRef.current) {
      destroyReplayer(el, replayerRef, fedCountRef);
    }

    if (!replayerRef.current) {
      const nr = new Replayer(typed, {
        root: el,
        speed: 1,
        showWarning: false,
        insertStyleRules: RRWEB_REPLAY_FONT_FALLBACK_RULES,
      });
      replayerRef.current = nr;
      fedCountRef.current = events.length;
      queueMicrotask(() => {
        try {
          nr.startLive();
        } catch {
          /* noop */
        }
      });
      return;
    }

    const r = replayerRef.current;
    for (let i = fedCountRef.current; i < events.length; i++) {
      try {
        r.addEvent(typed[i]);
      } catch {
        /* noop */
      }
    }
    fedCountRef.current = events.length;
  }, [events, canReplay]);

  useEffect(() => {
    return () => {
      const el = containerRef.current;
      if (!el) return;
      destroyReplayer(el, replayerRef, fedCountRef);
    };
  }, []);

  const ready = canReplay;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        /* 尚无足够事件时不必占大块深色占位；有画面后再撑满剩余空间 */
        minHeight: ready ? 200 : 0,
        flex: ready ? 1 : "0 0 auto",
        background: ready ? "#0f172a" : "transparent",
        borderRadius: 6,
        overflow: "auto",
      }}
    >
      {events.length > 0 && !canReplay ? (
        <p
          style={{
            margin: 0,
            padding: 10,
            fontSize: 11,
            color: "#94a3b8",
            lineHeight: 1.45,
          }}
        >
          已收到 {events.length} 条事件，rrweb 重放至少需要 2 条（通常需先有 Meta 再出现快照/增量）。请继续在目标窗口操作页面。
        </p>
      ) : null}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          minHeight: canReplay ? 200 : 0,
        }}
      />
    </div>
  );
}
