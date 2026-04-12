import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 与 `packages/rrweb-inject-bundle` 内 `rrweb` 依赖版本一致（文档与诊断） */
export const RRWEB_INJECT_BUNDLE_VERSION = "1.1.3";

/**
 * 解析 `inject.bundle.js` 绝对路径（相对本文件：core `dist/session-replay` 或 `src/session-replay`）。
 */
export function getRrwebInjectBundlePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../../rrweb-inject-bundle/dist/inject.bundle.js");
}

export function isRrwebInjectBundlePresent(): boolean {
  return existsSync(getRrwebInjectBundlePath());
}
