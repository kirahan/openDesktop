import { attachToTargetSession, withBrowserCdp, type BrowserCdp } from "./browserClient.js";

export type UserScriptInjectError = {
  targetId: string;
  /** 附着失败时尚未执行具体脚本时为空字符串 */
  scriptId: string;
  message: string;
};

export type UserScriptInjectResult =
  | {
      injectedScripts: number;
      targets: number;
      errors: UserScriptInjectError[];
    }
  | { error: string };

/**
 * 将多条用户脚本正文依次注入到 **当前** CDP 枚举到的全部 `page` 类型 target（不按 URL / @match 筛选）。
 * 单连接内完成 Target 枚举与逐 target 执行；部分失败时仍返回 200 语义由 HTTP 层处理。
 *
 * @param cdpPort 会话子进程 remote debugging 端口
 * @param scripts 脚本 id 与正文（已按稳定顺序排列）
 */
export async function injectUserScriptsIntoPageTargets(
  cdpPort: number,
  scripts: { id: string; body: string }[],
): Promise<UserScriptInjectResult> {
  if (scripts.length === 0) {
    return { injectedScripts: 0, targets: 0, errors: [] };
  }

  return withBrowserCdp(cdpPort, async (cdp) => {
    const pageTargets = await listPageTargetIds(cdp);
    const errors: UserScriptInjectError[] = [];
    let injectedScripts = 0;

    for (const t of pageTargets) {
      const { targetId } = t;
      let sessionId: string;
      try {
        sessionId = await attachToTargetSession(cdp, targetId);
      } catch (e) {
        errors.push({
          targetId,
          scriptId: "",
          message: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      await cdp.send("Runtime.enable", {}, sessionId);

      for (const sc of scripts) {
        const expr = wrapUserScriptBody(sc.body);
        try {
          const ev = (await cdp.send(
            "Runtime.evaluate",
            { expression: expr, returnByValue: true, awaitPromise: true },
            sessionId,
          )) as {
            exceptionDetails?: { text?: string; exception?: { description?: string } };
          };
          if (ev.exceptionDetails) {
            const msg =
              ev.exceptionDetails.exception?.description ??
              ev.exceptionDetails.text ??
              "Runtime.evaluate exception";
            errors.push({ targetId, scriptId: sc.id, message: msg });
          } else {
            injectedScripts += 1;
          }
        } catch (e) {
          errors.push({
            targetId,
            scriptId: sc.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      injectedScripts,
      targets: pageTargets.length,
      errors,
    };
  });
}

function wrapUserScriptBody(body: string): string {
  return `(function(){\n${body}\n})();`;
}

async function listPageTargetIds(cdp: BrowserCdp): Promise<{ targetId: string }[]> {
  const raw = (await cdp.send("Target.getTargets", {})) as {
    targetInfos?: Array<{ targetId?: string; type?: string }>;
  };
  const infos = raw.targetInfos ?? [];
  return infos
    .filter((i) => i.type === "page" && i.targetId)
    .map((i) => ({ targetId: i.targetId as string }));
}
