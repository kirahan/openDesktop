/** 单路录制上缓冲的 rrweb JSON 行数上限（含 Meta 与 FullSnapshot，避免长会话 OOM） */
export const RRWEB_SSE_BUFFER_MAX_LINES = 8000;

type Subscriber = (line: string) => void;

/**
 * 将 rrweb 事件扇出给所有 SSE 订阅者；无订阅时仍写入缓冲，以便晚到的连接能收到先发的 Meta / FullSnapshot。
 */
export class RrwebSseFanout {
  private readonly buffer: string[] = [];

  private readonly subscribers = new Set<Subscriber>();

  constructor(private readonly maxBufferLines: number = RRWEB_SSE_BUFFER_MAX_LINES) {}

  /**
   * 页面 binding 推送一条已通过校验的 JSON 行。
   */
  emit(line: string): void {
    this.buffer.push(line);
    while (this.buffer.length > this.maxBufferLines) {
      this.buffer.shift();
    }
    for (const fn of this.subscribers) {
      try {
        fn(line);
      } catch {
        /* noop */
      }
    }
  }

  /**
   * 新 SSE 连接：先按序重放缓冲，再接收后续 emit。
   */
  subscribe(fn: Subscriber): () => void {
    for (const line of this.buffer) {
      try {
        fn(line);
      } catch {
        /* noop */
      }
    }
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  clearSubscribers(): void {
    this.subscribers.clear();
  }
}
