import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AX_AT_POINT_SWIFT_SCRIPT = path.join(
  fileURLToPath(new URL("../../native-macos/axTreeAtPoint.swift", import.meta.url)),
);

export type MacAxAtPointOk = {
  ok: true;
  truncated: boolean;
  screenX: number;
  screenY: number;
  ancestors: unknown[];
  at: unknown;
};

export type MacAxAtPointErr = { ok: false; code: string; message: string; truncated?: boolean };

export type MacAxAtPointResult = MacAxAtPointOk | MacAxAtPointErr;

/** 解析 Swift `axTreeAtPoint` stdout */
export function parseMacAxAtPointStdout(raw: string): MacAxAtPointResult {
  const t = raw.trim();
  if (!t.startsWith("{")) {
    return { ok: false, code: "PARSE_FAILED", message: t.slice(0, 200) || "empty stdout" };
  }
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    if (j.ok === true && j.at != null && typeof j.screenX === "number" && typeof j.screenY === "number") {
      return {
        ok: true,
        truncated: Boolean(j.truncated),
        screenX: j.screenX,
        screenY: j.screenY,
        ancestors: Array.isArray(j.ancestors) ? j.ancestors : [],
        at: j.at,
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

export function dumpMacAccessibilityAtPoint(
  pid: number,
  options: {
    screenX: number;
    screenY: number;
    maxAncestorDepth: number;
    maxLocalDepth: number;
    maxNodes: number;
  },
): Promise<MacAxAtPointResult> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ ok: false, code: "PLATFORM_UNSUPPORTED", message: "仅 macOS 支持按点无障碍采集" });
      return;
    }
    if (!Number.isFinite(pid) || pid <= 0) {
      resolve({ ok: false, code: "INVALID_PID", message: "invalid pid" });
      return;
    }
    if (!existsSync(AX_AT_POINT_SWIFT_SCRIPT)) {
      resolve({
        ok: false,
        code: "SWIFT_SCRIPT_MISSING",
        message: `缺少 ${AX_AT_POINT_SWIFT_SCRIPT}`,
      });
      return;
    }

    const { screenX, screenY, maxAncestorDepth, maxLocalDepth, maxNodes } = options;
    const child = spawn(
      "swift",
      [
        AX_AT_POINT_SWIFT_SCRIPT,
        String(Math.floor(pid)),
        String(screenX),
        String(screenY),
        String(maxAncestorDepth),
        String(maxLocalDepth),
        String(maxNodes),
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      done({ ok: false, code: "TIMEOUT", message: "按点无障碍采集超时（120s）" });
    }, 120_000);

    const done = (r: MacAxAtPointResult) => {
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
      const parsed = parseMacAxAtPointStdout(raw);
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
