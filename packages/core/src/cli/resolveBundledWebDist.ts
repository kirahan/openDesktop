import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 给定 `cli.js` 所在目录（通常为 `dist/`），解析同级包根下 `web-dist/index.html` 是否存在。
 * 调用方应传入 `path.dirname(fileURLToPath(import.meta.url))`（`cli.ts` 编译为 `dist/cli.js` 时即为 `dist` 目录）。
 */
export function resolveBundledWebDistFromCliDir(cliJsDir: string): string | undefined {
  const candidate = join(cliJsDir, "..", "web-dist");
  const indexHtml = join(candidate, "index.html");
  if (existsSync(indexHtml)) {
    return candidate;
  }
  return undefined;
}
