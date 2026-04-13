import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Swift 源码路径：与编译后 `dist/nativeAccessibility/*.js` 相对 `packages/core/native-macos/` */
export const AX_TREE_SWIFT_SCRIPT = path.join(
  fileURLToPath(new URL("../../native-macos/axTreeDump.swift", import.meta.url)),
);

export type MacAxDumpOk = { ok: true; truncated: boolean; root: unknown };
export type MacAxDumpErr = { ok: false; code: string; message: string; truncated?: boolean };

export type MacAxDumpResult = MacAxDumpOk | MacAxDumpErr;

/** 解析 `swift` 子进程 stdout，供单测覆盖 */
export function parseMacAxTreeStdout(raw: string): MacAxDumpResult {
  const t = raw.trim();
  if (!t.startsWith("{")) {
    return { ok: false, code: "PARSE_FAILED", message: t.slice(0, 200) || "empty stdout" };
  }
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    if (j.ok === true && j.root != null) {
      return {
        ok: true,
        truncated: Boolean(j.truncated),
        root: j.root,
      };
    }
    if (j.ok === false && typeof j.code === "string" && typeof j.message === "string") {
      return {
        ok: false,
        code: j.code,
        message: j.message,
        truncated: typeof j.truncated === "boolean" ? j.truncated : undefined,
      };
    }
    return { ok: false, code: "PARSE_FAILED", message: "unexpected JSON shape" };
  } catch {
    return { ok: false, code: "PARSE_FAILED", message: t.slice(0, 200) };
  }
}

/**
 * 在 macOS 上通过 `swift native-macos/axTreeDump.swift` 枚举给定 PID 的 AX 树。
 */
export function dumpMacAccessibilityTree(
  pid: number,
  options: { maxDepth: number; maxNodes: number },
): Promise<MacAxDumpResult> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ ok: false, code: "PLATFORM_UNSUPPORTED", message: "仅 macOS 支持原生无障碍树采集" });
      return;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
      resolve({ ok: false, code: "INVALID_PID", message: "invalid pid" });
      return;
    }
    if (!existsSync(AX_TREE_SWIFT_SCRIPT)) {
      resolve({
        ok: false,
        code: "SWIFT_SCRIPT_MISSING",
        message: `缺少 ${AX_TREE_SWIFT_SCRIPT}（请确认已随包携带 native-macos/axTreeDump.swift）`,
      });
      return;
    }

    const { maxDepth, maxNodes } = options;
    const child = spawn(
      "swift",
      [AX_TREE_SWIFT_SCRIPT, String(Math.floor(pid)), String(maxDepth), String(maxNodes)],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      done({ ok: false, code: "TIMEOUT", message: "无障碍树采集超时（120s）" });
    }, 120_000);

    const done = (r: MacAxDumpResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(r);
    };

    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        done({
          ok: false,
          code: "SWIFT_UNAVAILABLE",
          message: "未找到 swift 可执行文件（请安装 Xcode Command Line Tools）",
        });
        return;
      }
      done({ ok: false, code: "SPAWN_FAILED", message: e.message });
    });
    child.on("close", (code) => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const errText = Buffer.concat(errChunks).toString("utf8").trim();
      if (!raw.trim() && errText) {
        done({ ok: false, code: "SWIFT_FAILED", message: errText.slice(0, 300) });
        return;
      }
      const parsed = parseMacAxTreeStdout(raw);
      if (!parsed.ok && code !== 0 && parsed.code === "PARSE_FAILED") {
        done({
          ok: false,
          code: "SWIFT_FAILED",
          message: errText || raw.slice(0, 200) || `exit ${code}`,
        });
        return;
      }
      done(parsed);
    });
  });
}
