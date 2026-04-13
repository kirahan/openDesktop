/**
 * Studio Web：是否允许点击「原生无障碍树」与禁用原因（与 Core `capabilities` + 会话状态对齐）。
 */
export function nativeAccessibilityTreeDisabledReason(
  capabilities: readonly string[],
  session: { state: string; pid?: number },
): string | null {
  if (!capabilities.includes("native_accessibility_tree")) {
    return "Core 未声明 native_accessibility_tree（常见于非 macOS 或未启用该能力）";
  }
  if ((session.state || "").toLowerCase() !== "running") {
    return "会话未在运行中";
  }
  if (typeof session.pid !== "number" || session.pid <= 0) {
    return "尚无子进程 PID";
  }
  return null;
}

/** @returns true 当按钮可点击 */
export function isNativeAccessibilityTreeActionEnabled(
  capabilities: readonly string[],
  session: { state: string; pid?: number },
): boolean {
  return nativeAccessibilityTreeDisabledReason(capabilities, session) === null;
}

/** 「指针附近 / 按点」无障碍树：需额外声明 `native_accessibility_at_point`。 */
export function nativeAccessibilityAtPointDisabledReason(
  capabilities: readonly string[],
  session: { state: string; pid?: number },
): string | null {
  if (!capabilities.includes("native_accessibility_at_point")) {
    return "Core 未声明 native_accessibility_at_point（常见于非 macOS）";
  }
  if ((session.state || "").toLowerCase() !== "running") {
    return "会话未在运行中";
  }
  if (typeof session.pid !== "number" || session.pid <= 0) {
    return "尚无子进程 PID";
  }
  return null;
}
