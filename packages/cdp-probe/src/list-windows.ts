/**
 * 列出已连接 CDP 的 Chromium/Electron 上的调试目标（页面/窗口等）。
 *
 * Electron 上 `chromium.connectOverCDP` 常会触发不支持的方法（如 setDownloadBehavior），
 * 因此默认使用 HTTP `GET /json/list`（与 DevTools 一致），不依赖 Playwright 连接成功。
 *
 * 用法：
 *   CDP_URL=http://127.0.0.1:<端口> yarn list -w @opendesktop/cdp-probe
 */
import { chromium, type Browser } from "playwright";

type JsonListTarget = {
  type?: string;
  title?: string;
  url?: string;
  id?: string;
};

function usage(): never {
  console.error(`
用法（任选其一）:
  CDP_URL=http://127.0.0.1:端口号 yarn list -w @opendesktop/cdp-probe

  yarn workspace @opendesktop/cdp-probe exec tsx src/list-windows.ts http://127.0.0.1:端口号

可选：USE_PLAYWRIGHT_CDP=1 时额外尝试 Playwright connectOverCDP（仅部分 Chrome 场景可用）

示例:
  CDP_URL=http://127.0.0.1:64375 yarn list -w @opendesktop/cdp-probe
`);
  process.exit(1);
}

/** 从任意 CDP HTTP 输入得到 origin，例如 http://127.0.0.1:64375/foo -> http://127.0.0.1:64375 */
function cdpHttpOrigin(raw: string): string {
  const withProto = raw.startsWith("http") ? raw : `http://${raw}`;
  const u = new URL(withProto);
  return `${u.protocol}//${u.host}`;
}

async function listViaJsonList(origin: string): Promise<JsonListTarget[]> {
  const res = await fetch(`${origin}/json/list`);
  if (!res.ok) {
    throw new Error(`GET /json/list failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("/json/list 返回格式不是数组");
  }
  return data as JsonListTarget[];
}

async function tryPlaywright(origin: string): Promise<void> {
  console.log(`\n--- Playwright connectOverCDP（实验）: ${origin} ---\n`);
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(origin);
  } catch (e) {
    console.error("Playwright 连接失败:", e);
    return;
  }
  try {
    const contexts = browser.contexts();
    console.log(`BrowserContext 数量: ${contexts.length}`);
    let totalPages = 0;
    for (let ci = 0; ci < contexts.length; ci++) {
      const ctx = contexts[ci];
      const pages = ctx.pages();
      console.log(`\n--- Context #${ci} (pages: ${pages.length}) ---`);
      for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi];
        const title = await page.title().catch(() => "(no title)");
        console.log(`  [${pi}] ${title}`);
        console.log(`      ${page.url()}`);
        totalPages++;
      }
    }
    console.log(`\n合计 Page 数: ${totalPages}`);
  } finally {
    await browser.close();
  }
}

function main() {
  const fromEnv = process.env.CDP_URL?.trim();
  const fromArg = process.argv[2]?.trim();
  const cdpHttp = fromEnv || fromArg;
  if (!cdpHttp) usage();

  const origin = cdpHttpOrigin(cdpHttp);
  console.log(`CDP HTTP: ${origin}`);
  console.log("使用 GET /json/list 列出调试目标\n");

  return (async () => {
    let targets: JsonListTarget[];
    try {
      targets = await listViaJsonList(origin);
    } catch (e) {
      console.error("拉取 /json/list 失败（请确认 已开且端口正确）:", e);
      process.exit(1);
    }

    const pages = targets.filter((t) => (t.type || "").toLowerCase() === "page");
    const others = targets.filter((t) => (t.type || "").toLowerCase() !== "page");

    console.log(`type=page 的目标数（通常对应可见窗口里的文档页）: ${pages.length}`);
    console.log("--- page 列表 ---");
    pages.forEach((t, i) => {
      console.log(`  [${i}] ${t.title || "(no title)"}`);
      console.log(`      ${t.url || ""}`);
      if (t.id) console.log(`      id: ${t.id}`);
    });

    if (others.length > 0) {
      console.log(`\n其它类型目标 (${others.length}):`);
      others.forEach((t, i) => {
        console.log(`  [${i}] type=${t.type || "?"} title=${t.title || ""} url=${t.url || ""}`);
      });
    }

    console.log(`\n总计目标数（含 background_page、service_worker 等）: ${targets.length}`);

    if (process.env.USE_PLAYWRIGHT_CDP === "1") {
      await tryPlaywright(origin);
    }
  })();
}

main();
