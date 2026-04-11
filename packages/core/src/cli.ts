#!/usr/bin/env node
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runAppFirst } from "./cli/appFirstRun.js";
import { runDoctor } from "./cli/doctorRun.js";
import { exitCodeForHttpStatus } from "./cli/mapHttpToExit.js";
import { runAppBootstrapFlow } from "./cli/runAppBootstrapFlow.js";
import { printSessionList } from "./cli/output.js";
import { tryParseAppFirstArgv } from "./cli/parseAppFirstArgv.js";
import { loadConfig } from "./config.js";
import { startDaemon } from "./daemon.js";
import { readPid, pidPath } from "./pidfile.js";

function getRootCommand(cmd: Command): Command {
  let c: Command = cmd;
  while (c.parent) c = c.parent;
  return c;
}

function rootOpts(cmd: Command): { apiUrl?: string; tokenFile?: string } {
  return getRootCommand(cmd).opts() as { apiUrl?: string; tokenFile?: string };
}

async function readTokenFromOpts(cmd: Command): Promise<string> {
  const opts = rootOpts(cmd);
  const config = loadConfig({ tokenFile: opts.tokenFile });
  return (await readFile(config.tokenFile, "utf8")).trim();
}

async function readStdinUtf8(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) {
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function apiFetch(cmd: Command, method: string, apiPath: string, body?: unknown): Promise<Response> {
  const opts = rootOpts(cmd);
  const base = (opts.apiUrl ?? process.env.OPENDESKTOP_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const token = await readTokenFromOpts(cmd);
  const url = `${base}${apiPath}`;
  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url.replace(/"/g, '\\"')}"`
        : `xdg-open "${url.replace(/"/g, '\\"')}"`;
  exec(cmd, (err) => {
    if (err) console.error("open failed:", err.message);
  });
}

async function main() {
  const sliced = process.argv.slice(2);
  const appFirst = tryParseAppFirstArgv(sliced);
  if (appFirst.kind === "error") {
    console.error(appFirst.message);
    process.exit(appFirst.exitCode);
    return;
  }
  if (appFirst.kind === "ok") {
    const code = await runAppFirst(appFirst, (s) => process.stdout.write(s), (s) => process.stderr.write(`${s}\n`));
    process.exit(code);
    return;
  }

  const program = new Command();
  program
    .name("od")
    .description(
      "OpenDesktop CLI — local Electron debug session control plane。App-first：yarn oc <appId> <子命令>（见下方说明）。",
    )
    .option("--api-url <url>", "Core HTTP base URL", process.env.OPENDESKTOP_API_URL)
    .option("--token-file <path>", "Token file path", process.env.OPENDESKTOP_TOKEN_FILE)
    .addHelpText(
      "after",
      `
App-first（免手写 sessionId，monorepo 下常用 yarn oc）:
  yarn oc <appId> list-window | metrics | snapshot | list-global | explore | network-observe | network-stream | console-observe | console-stream | stack-observe | stack-stream
  yarn oc <appId> topology          # 与 list-window 等价
  可选: --format json|--session <uuid>|--target|--interest|--max-keys（list-global）
        explore: --max-candidates|--min-score|--include-anchor-buttons
        network-observe: --window-ms|--slow-ms|--no-strip-query（短时 JSON）
        network-stream: --no-strip-query|--max-events-per-second（SSE；--format 不适用）
        console-observe | stack-observe: --wait-ms（短时采样 JSON，100～30000）
        console-stream | stack-stream: SSE 长流（Ctrl+C 结束；stack 需会话允许脚本执行）
全局安装的入口名为 od，与 yarn oc 指向同一 CLI。`,
    );

  const core = program.command("core").description("Control the Core daemon");

  core
    .command("start")
    .description("Start Core (foreground)")
    .option("--port <n>", "HTTP port", "8787")
    .option("--host <h>", "Bind host", "127.0.0.1")
    .option("--data-dir <path>", "Data directory")
    .option("--web-dist <path>", "Static web UI (SPA) directory")
    .action(async (opts) => {
      const d = await startDaemon({
        port: Number(opts.port),
        host: opts.host,
        dataDir: opts.dataDir,
        webDist: opts.webDist,
      });
      const base = `http://${d.config.host}:${d.config.port}`;
      console.log(`OpenDesktop Core listening at ${base}`);
      const cfg = loadConfig({ dataDir: opts.dataDir });
      console.log(`Token: ${d.token}`);
      console.log(`Token file: ${cfg.tokenFile}`);
      const shutdown = async () => {
        await d.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  core
    .command("status")
    .description("Check if Core pid file exists and process is alive")
    .action(async () => {
      const config = loadConfig();
      const pid = await readPid(config.dataDir);
      if (!pid) {
        console.log("status: not running (no pid file)");
        process.exit(1);
        return;
      }
      try {
        process.kill(pid, 0);
        console.log(`status: running pid=${pid} (${pidPath(config.dataDir)})`);
      } catch {
        console.log(`status: stale pid=${pid}`);
        process.exit(1);
      }
    });

  core
    .command("stop")
    .description("Send SIGTERM to Core using pid file")
    .action(async () => {
      const config = loadConfig();
      const pid = await readPid(config.dataDir);
      if (!pid) {
        console.error("No pid file");
        process.exit(1);
        return;
      }
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to ${pid}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  const appCmd = program.command("app").description("Manage apps");

  appCmd
    .command("list")
    .action(async () => {
      const res = await apiFetch(program, "GET", "/v1/apps");
      const text = await res.text();
      console.log(text);
      if (!res.ok) process.exit(exitCodeForHttpStatus(res.status));
    });

  appCmd
    .command("init-demo")
    .description("一键注册演示应用 + Profile（内置 mock CDP 子进程，用于联调）")
    .action(async () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const mockAbs = path.resolve(here, "../../test/fixtures/mock-cdp.mjs");
      const node = process.execPath;
      const cwd = path.dirname(mockAbs);
      const script = path.basename(mockAbs);

      let res = await apiFetch(program, "POST", "/v1/apps", {
        id: "demo-mock",
        name: "demo-mock",
        executable: node,
        cwd,
        args: [script],
        env: {},
        injectElectronDebugPort: false,
      });
      if (res.status === 409) {
        console.log("应用 demo-mock 已存在，跳过创建");
      } else if (!res.ok) {
        console.error(await res.text());
        process.exit(exitCodeForHttpStatus(res.status));
      } else {
        console.log("已创建应用 demo-mock");
      }

      res = await apiFetch(program, "POST", "/v1/profiles", {
        id: "demo",
        appId: "demo-mock",
        name: "demo",
        env: {},
        extraArgs: [],
      });
      if (res.status === 409) {
        console.log("Profile demo 已存在，跳过创建");
      } else if (!res.ok) {
        console.error(await res.text());
        process.exit(exitCodeForHttpStatus(res.status));
      } else {
        console.log("已创建 Profile demo（profileId=demo）");
      }

      console.log("");
      console.log("下一步：创建会话");
      console.log("  od session start demo");
    });

  appCmd
    .command("create")
    .description(
      "注册应用并创建默认启动配置（默认 id 为 &lt;应用 id&gt;-default），可选立即创建会话；需 Core 已启动；应用 id 即 yarn oc &lt;appId&gt; 调用名",
    )
    .requiredOption("--id <id>", "应用 ID（调用名，与 yarn oc <appId> 子命令一致）")
    .requiredOption("--exe <path>", "可执行文件路径（如 Electron 或 node）")
    .option("--cwd <path>", "工作目录", process.cwd())
    .option(
      "--args <json>",
      '启动参数 JSON 数组，例如 ["--foo","bar"]',
      "[]",
    )
    .option(
      "--skip-debug-inject",
      "不向子进程附加 --remote-debugging-port（默认会附加，供 Electron 调试用）",
    )
    .option(
      "--profile-id <id>",
      "默认启动配置的 id（省略则为 <应用 id>-default）",
    )
    .option("--start", "创建默认启动配置后立即创建会话（默认否）", false)
    .action(async (opts) => {
      let args: string[];
      try {
        args = JSON.parse(opts.args) as string[];
        if (!Array.isArray(args)) throw new Error("args 必须是 JSON 数组");
      } catch (e) {
        console.error("--args 须为合法 JSON 数组:", e);
        process.exit(1);
        return;
      }
      const o = opts as { skipDebugInject?: boolean; profileId?: string; start?: boolean };
      const profileId = (o.profileId?.trim() || `${opts.id}-default`) as string;
      const result = await runAppBootstrapFlow(apiFetch, program, {
        appId: opts.id,
        executable: opts.exe,
        cwd: opts.cwd,
        args,
        injectElectronDebugPort: !o.skipDebugInject,
        profileId,
        profileDisplayName: profileId,
        startSession: Boolean(o.start),
      });
      if (!result.ok) {
        result.messages.forEach((m) => console.error(m));
        process.exit(result.exitCode);
      }
    });

  appCmd
    .command("remove")
    .description(
      "删除已注册应用（DELETE /v1/apps/:id；会停止该应用相关运行中会话，并移除其 Profile 与用户脚本记录）",
    )
    .requiredOption("--id <id>", "应用 ID")
    .action(async (opts: { id: string }) => {
      const res = await apiFetch(program, "DELETE", `/v1/apps/${encodeURIComponent(opts.id)}`);
      if (res.status === 204) {
        console.log(`已删除应用 ${opts.id}`);
        return;
      }
      const text = await res.text();
      console.error(text);
      process.exit(exitCodeForHttpStatus(res.status));
    });

  const profileCmd = program.command("profile").description("Manage profiles（HTTP GET /v1/profiles）");

  profileCmd
    .command("list")
    .description("列出已注册 Profile（JSON）")
    .action(async () => {
      const res = await apiFetch(program, "GET", "/v1/profiles");
      const text = await res.text();
      console.log(text);
      if (!res.ok) process.exit(exitCodeForHttpStatus(res.status));
    });

  const sessionCmd = program
    .command("session")
    .description("Manage sessions：start 为某启动配置新建会话（每次新 session id），stop 停止，list 列表");

  sessionCmd
    .command("list")
    .option("-f, --format <fmt>", "输出格式 table|json", "table")
    .action(async (opts: { format: string }) => {
      const fmt = opts.format === "json" ? "json" : "table";
      if (opts.format !== "json" && opts.format !== "table") {
        console.error("仅支持 --format table|json");
        process.exit(2);
        return;
      }
      const res = await apiFetch(program, "GET", "/v1/sessions");
      if (!res.ok) {
        console.error(await res.text());
        process.exit(exitCodeForHttpStatus(res.status));
        return;
      }
      const data = (await res.json()) as {
        sessions?: { id: string; profileId: string; state: string; createdAt: string }[];
      };
      const sessions = data.sessions ?? [];
      printSessionList(sessions, fmt, (s) => process.stdout.write(s));
    });

  sessionCmd
    .command("start <profileId>")
    .description(
      "为指定启动配置新建一条调试会话（每次调用均 POST /v1/sessions，得到新的 session id；与 session stop 相对）",
    )
    .action(async (profileId: string) => {
      const res = await apiFetch(program, "POST", "/v1/sessions", { profileId });
      const text = await res.text();
      console.log(text);
      if (!res.ok) process.exit(exitCodeForHttpStatus(res.status));
    });

  sessionCmd
    .command("stop <id>")
    .action(async (id: string) => {
      const res = await apiFetch(program, "POST", `/v1/sessions/${id}/stop`);
      const text = await res.text();
      console.log(text);
      if (!res.ok) process.exit(exitCodeForHttpStatus(res.status));
    });

  const agentCmd = program.command("agent").description("Agent：`POST /v1/agent/sessions/:id/actions`");

  agentCmd
    .command("action <sessionId>")
    .description("传入 JSON body（--json 或 stdin），打印响应 JSON")
    .option("--json <body>", "请求体 JSON 字符串；省略则从 stdin 读取")
    .action(async (sessionId: string, opts: { json?: string }) => {
      let raw: string;
      if (opts.json !== undefined) {
        raw = opts.json;
      } else {
        raw = await readStdinUtf8();
        if (!raw.trim()) {
          console.error("请使用 --json '<JSON>' 或通过 stdin 传入请求体");
          process.exit(2);
          return;
        }
      }
      let body: unknown;
      try {
        body = JSON.parse(raw) as unknown;
      } catch (e) {
        console.error("JSON 解析失败:", e instanceof Error ? e.message : e);
        process.exit(2);
        return;
      }
      const res = await apiFetch(program, "POST", `/v1/agent/sessions/${sessionId}/actions`, body);
      const text = await res.text();
      console.log(text);
      if (!res.ok) process.exit(exitCodeForHttpStatus(res.status));
    });

  program
    .command("doctor")
    .description("检查 Core 连通性、token 与（可选）应用下活跃会话")
    .option("-f, --format <fmt>", "table|json", "table")
    .option("--app <id>", "可选：检查该应用是否存在活跃会话")
    .action(async (o: { format: string; app?: string }) => {
      const fmt = o.format === "json" ? "json" : "table";
      if (o.format !== "json" && o.format !== "table") {
        console.error("仅支持 --format table|json");
        process.exit(2);
        return;
      }
      const ro = program.opts() as { apiUrl?: string; tokenFile?: string };
      const code = await runDoctor(
        { apiUrl: ro.apiUrl, tokenFile: ro.tokenFile, format: fmt, app: o.app },
        (s) => process.stdout.write(s),
        (s) => process.stderr.write(`${s}\n`),
      );
      process.exit(code);
    });

  program
    .command("open")
    .description("Open Core base URL in the default browser")
    .option("--path <p>", "Path to open", "/")
    .action((opts) => {
      const ro = program.opts() as { apiUrl?: string };
      const base = (ro.apiUrl ?? process.env.OPENDESKTOP_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
      const url = new URL(opts.path, base + "/").href;
      console.log(url);
      openBrowser(url);
    });

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
