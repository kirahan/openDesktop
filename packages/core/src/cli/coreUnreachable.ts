import process from "node:process";

/** stderr 着色（TTY 且未设 NO_COLOR） */
const ttyErr = (() => {
  const on = process.stderr.isTTY && !process.env.NO_COLOR;
  const w = (code: string, s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    title: (s: string) => w("1;31", s),
    dim: (s: string) => w("2", s),
    cmd: (s: string) => w("33", s),
  };
})();

/**
 * 判断是否为「连不上本机 Core」类错误（含 fetch 包装层与 cause 链）。
 */
export function isCoreUnreachableError(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 10 && cur !== undefined && cur !== null; depth++) {
    if (typeof cur === "object" && cur !== null && "code" in cur) {
      const code = String((cur as NodeJS.ErrnoException).code ?? "");
      if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return true;
      }
    }
    if (cur instanceof Error && cur.cause !== undefined) {
      cur = cur.cause;
      continue;
    }
    break;
  }
  return false;
}

/**
 * Core HTTP 不可达时抛出，便于上层区分并输出引导文案。
 */
export class CoreUnreachableError extends Error {
  /** 尝试连接的 API 基址（无尾部斜杠） */
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    super(`无法连接 OpenDesktop Core (${baseUrl})`);
    this.name = "CoreUnreachableError";
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }
}

/**
 * 打印友好说明（多行），默认输出到 stderr。
 */
export function printCoreUnreachableHelp(
  baseUrl: string,
  writeLine: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`);
  },
): void {
  const base = baseUrl.replace(/\/$/, "");
  writeLine("");
  writeLine(ttyErr.title("无法连接 OpenDesktop Core"));
  writeLine(ttyErr.dim(`  尝试地址: ${base}`));
  writeLine("");
  writeLine(ttyErr.dim("请先在本机启动 Core，例如在仓库根目录："));
  writeLine(`  ${ttyErr.cmd("yarn dev:core")}`);
  writeLine(`  ${ttyErr.cmd("yarn dev:core:ui")}`);
  writeLine(ttyErr.dim("或使用 opd（全局安装发行包时通常可直接带随包 Web）："));
  writeLine(`  ${ttyErr.cmd("opd core start --port 8787")}`);
  writeLine(ttyErr.dim("自定义静态目录时加 --web-dist；若 Core 不在默认地址，请使用 opd --api-url 或设置 OPENDESKTOP_API_URL。"));
  writeLine("");
}
