/**
 * 使用 @nut-tree/nut-js 读取全局鼠标位置（主要供 macOS 按点 AX 使用）。
 */

export type MousePositionResult =
  | { ok: true; x: number; y: number }
  | { ok: false; code: "MOUSE_POSITION_UNAVAILABLE"; message: string };

export async function getGlobalMousePosition(): Promise<MousePositionResult> {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      code: "MOUSE_POSITION_UNAVAILABLE",
      message: "全局鼠标坐标仅在 macOS 上可用",
    };
  }
  try {
    const { mouse } = await import("@nut-tree/nut-js");
    const p = await mouse.getPosition();
    return { ok: true, x: Math.round(p.x), y: Math.round(p.y) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: "MOUSE_POSITION_UNAVAILABLE",
      message: msg.slice(0, 240) || "mouse.getPosition failed",
    };
  }
}
