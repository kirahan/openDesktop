/**
 * 浏览器内执行：通过 CDP Runtime.addBinding 注入的 `odOpenDesktopRrweb` 回传 rrweb 事件 JSON。
 * 构建为单文件 IIFE，供 Core `Runtime.evaluate` 注入。
 */
import * as rrweb from "rrweb";

declare global {
  /** Chromium：addBinding 后在全局暴露的调用入口 */
  function odOpenDesktopRrweb(payload: string): void;
}

let stopFn: (() => void) | undefined;

function emitLine(payload: string): void {
  try {
    odOpenDesktopRrweb(payload);
  } catch {
    /* 页面销毁或 binding 不可用 */
  }
}

function __odRrwebRecordStart(): void {
  if (stopFn) return;
  stopFn = rrweb.record({
    emit(event) {
      try {
        emitLine(JSON.stringify(event));
      } catch {
        /* stringify 失败则跳过 */
      }
    },
    maskAllInputs: true,
  });
}

function __odRrwebRecordStop(): void {
  try {
    stopFn?.();
  } finally {
    stopFn = undefined;
  }
}

const g = globalThis as typeof globalThis & {
  __odRrwebRecordStart?: typeof __odRrwebRecordStart;
  __odRrwebRecordStop?: typeof __odRrwebRecordStop;
};
g.__odRrwebRecordStart = __odRrwebRecordStart;
g.__odRrwebRecordStop = __odRrwebRecordStop;

__odRrwebRecordStart();
