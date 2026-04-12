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

/**
 * 将视口坐标映射到与 CSS `object-fit: contain` 一致的绘制区域（整图可见、可能留边）。
 * 用于背景为窗口截图时与 pointer/click 矢量层对齐。
 */
export function mapReplayCoordsToObjectFitContain(
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
  const scale = Math.min(containerW / viewportW, containerH / viewportH);
  const drawnW = viewportW * scale;
  const drawnH = viewportH * scale;
  const offsetX = (containerW - drawnW) / 2;
  const offsetY = (containerH - drawnH) / 2;
  return {
    leftPx: offsetX + (clientX / viewportW) * drawnW,
    topPx: offsetY + (clientY / viewportH) * drawnH,
  };
}
