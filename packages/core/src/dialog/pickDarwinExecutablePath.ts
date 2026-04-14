import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PickWindowsExecutablePathResult } from "./pickWindowsExecutablePath.js";

const execFileAsync = promisify(execFile);

/** 必须用 ASCII 10 分隔；勿写 `return "OK" & return & p`——第二个 return 会被当成语句，输出会变成 `OK /path` 单行导致 Node 解析失败。 */
const APPLESCRIPT = `try
  set f to choose file with prompt "OpenDesktop：选择 .app 或可执行文件"
  set p to POSIX path of f
  set out to "OK" & (ASCII character 10) & p
  return out
on error errMsg number errNum
  if errNum is -128 then
    return "CANCEL"
  else
    return "ERROR:" & errMsg
  end if
end try`;

/**
 * 将用户选择的 `.app` 包解析为 `Contents/MacOS/<CFBundleExecutable>`（若存在）。
 */
function pickFallbackExecutableInMacOSFolder(base: string): string | null {
  const macosDir = path.join(base, "Contents", "MacOS");
  if (!fs.existsSync(macosDir)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(macosDir);
  } catch {
    return null;
  }
  const bundleStem = path.basename(base, ".app");
  const files: string[] = [];
  for (const name of entries) {
    const fp = path.join(macosDir, name);
    try {
      if (fs.statSync(fp).isFile()) files.push(fp);
    } catch {
      /* skip */
    }
  }
  if (files.length === 0) return null;
  if (files.length === 1) return files[0];
  const byStem = files.find((f) => path.basename(f).toLowerCase() === bundleStem.toLowerCase());
  if (byStem) return byStem;
  files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  return files[0];
}

/**
 * 将用户或文件选择器给出的 `.app` 包路径解析为 `Contents/MacOS/<CFBundleExecutable>`（若存在）。
 * 与 {@link pickDarwinExecutablePath} 内逻辑一致，供 HTTP `/v1/resolve-executable-path` 与 Electron 原生选路结果对齐。
 */
export async function resolveDarwinAppBundleToExecutable(appBundlePath: string): Promise<string | null> {
  const base = appBundlePath.trim().replace(/\/+$/, "");
  if (!base.toLowerCase().endsWith(".app")) return null;
  const infoPlist = path.join(base, "Contents", "Info.plist");
  if (!fs.existsSync(infoPlist)) {
    return pickFallbackExecutableInMacOSFolder(base);
  }
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", infoPlist], {
      encoding: "utf8",
    });
    const exeName = stdout.trim();
    if (exeName) {
      const candidate = path.join(base, "Contents", "MacOS", exeName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  } catch {
    /* fall through to fallback */
  }
  return pickFallbackExecutableInMacOSFolder(base);
}

/**
 * 在本机图形会话中弹出 macOS「选择文件」对话框（`osascript` + `choose file`）。
 * 若用户选择 `.app`，则解析为包内主可执行文件路径以便 `spawn`。
 * 仅 `darwin`；无图形会话 / SSH 无转发时可能失败。
 */
export function pickDarwinExecutablePath(): Promise<PickWindowsExecutablePathResult> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ error: "PLATFORM_UNSUPPORTED", message: "内部错误：非 darwin 不应调用 pickDarwinExecutablePath" });
      return;
    }

    execFile("/usr/bin/osascript", ["-e", APPLESCRIPT], { timeout: 600_000 }, (err, stdout, stderr) => {
      void (async () => {
        const raw = (Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout ?? "")).trimEnd();
        const errText = (Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "")).trim();

        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            resolve({ error: "OSASCRIPT_UNAVAILABLE", message: "未找到 /usr/bin/osascript" });
            return;
          }
          resolve({
            error: "DIALOG_FAILED",
            message: err.message || errText || "osascript 失败",
          });
          return;
        }

        if (raw === "CANCEL") {
          resolve({ cancelled: true });
          return;
        }
        if (raw.startsWith("ERROR:")) {
          resolve({
            error: "DIALOG_FAILED",
            message: raw.slice("ERROR:".length).trim() || "对话框失败",
          });
          return;
        }
        // 正常为 "OK\n/path"；旧版 AppleScript 曾误输出 "OK /path" 单行
        let picked: string;
        const mLine = /^OK\r?\n(.+)$/s.exec(raw);
        const mLegacy = /^OK[ \t]+(.+)$/.exec(raw.trim());
        if (mLine) {
          picked = mLine[1]!.trim();
        } else if (mLegacy) {
          picked = mLegacy[1]!.trim();
        } else {
          resolve({
            error: "PARSE_FAILED",
            message: raw.slice(0, 200) || errText || "无法解析对话框输出",
          });
          return;
        }
        if (!picked) {
          resolve({ error: "EMPTY_PATH", message: "未选择文件" });
          return;
        }
        picked = picked.replace(/\/+$/, "");

        if (picked.toLowerCase().endsWith(".app")) {
          const resolved = await resolveDarwinAppBundleToExecutable(picked);
          if (resolved) {
            resolve({ path: resolved });
            return;
          }
          resolve({
            error: "APP_BUNDLE_RESOLVE_FAILED",
            message:
              "已选择 .app，但无法从 Info.plist 解析 CFBundleExecutable。请改为在包内选择 Contents/MacOS 下的可执行文件。",
          });
          return;
        }

        if (!fs.existsSync(picked) || !fs.statSync(picked).isFile()) {
          resolve({ error: "NOT_A_FILE", message: "所选路径不是有效文件" });
          return;
        }

        resolve({ path: picked });
      })().catch((e: unknown) =>
        resolve({
          error: "DIALOG_FAILED",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    });
  });
}
