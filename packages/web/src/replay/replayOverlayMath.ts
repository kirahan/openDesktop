/**
 * 将视口 CSS 坐标映射到预览容器像素（等比缩放，与 Sentry 类回放常见假设一致）。
 */
export function mapReplayCoordsToOverlay(
  clientX: number,
  clientY: number,
  viewportW: number,
  viewportH: number,
  containerW: number,
  containerH: number,
): { leftPx: number; topPx: number } {
  if (viewportW <= 0 || viewportH <= 0 || containerW <= 0 || containerH <= 0) {
    return { leftPx: 0, topPx: 0 };
  }
  return {
    leftPx: (clientX / viewportW) * containerW,
    topPx: (clientY / viewportH) * containerH,
  };
}
