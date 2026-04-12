import path from "node:path";

/** 与 apps.json id 风格一致：字母开头，允许数字、点、下划线、连字符 */
const APP_ID_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;

/** 文件名段：无路径分隔符 */
const RECORDING_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/**
 * 校验应用 id，防止路径穿越与非法目录名。
 */
export function validateAppId(appId: string): void {
  if (!APP_ID_RE.test(appId)) {
    throw Object.assign(new Error("Invalid appId"), { code: "INVALID_APP_ID" });
  }
  if (appId.includes("..") || appId.includes("/") || appId.includes("\\")) {
    throw Object.assign(new Error("Invalid appId"), { code: "INVALID_APP_ID" });
  }
}

/**
 * 校验录制 id（用于文件名）。
 */
export function validateRecordingId(recordingId: string): void {
  if (!RECORDING_ID_RE.test(recordingId)) {
    throw Object.assign(new Error("Invalid recordingId"), { code: "INVALID_RECORDING_ID" });
  }
  if (recordingId.includes("..") || recordingId.includes("/") || recordingId.includes("\\")) {
    throw Object.assign(new Error("Invalid recordingId"), { code: "INVALID_RECORDING_ID" });
  }
}

/**
 * `<appJsonDir>/<appId>/` 绝对路径。
 */
export function appJsonSubdir(appJsonDir: string, appId: string): string {
  validateAppId(appId);
  return path.join(appJsonDir, appId);
}

export function testRecordingFilename(recordingId: string): string {
  validateRecordingId(recordingId);
  return `test-recording-${recordingId}.json`;
}

/**
 * 解析 `test-recording-<id>.json` 中的 id。
 */
export function parseRecordingIdFromFilename(filename: string): string | null {
  if (!filename.startsWith("test-recording-") || !filename.endsWith(".json")) return null;
  const id = filename.slice("test-recording-".length, -".json".length);
  try {
    validateRecordingId(id);
    return id;
  } catch {
    return null;
  }
}
