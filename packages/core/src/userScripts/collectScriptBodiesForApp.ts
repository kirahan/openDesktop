import type { JsonFileStore } from "../store/jsonStore.js";
import { parseUserScriptSource } from "./parseUserScriptMetadata.js";

/**
 * 按 `appId` 列出用户脚本，解析出可注入正文；顺序为 **`id` 字典序**（稳定、可测）。
 * 正文为空的条目会跳过。
 *
 * @param store Core 数据存储
 * @param appId 应用 ID
 */
export async function collectScriptBodiesForApp(
  store: JsonFileStore,
  appId: string,
): Promise<{ id: string; body: string }[]> {
  const file = await store.readUserScripts();
  const rows = file.scripts.filter((s) => s.appId === appId);
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const out: { id: string; body: string }[] = [];
  for (const r of rows) {
    const parsed = parseUserScriptSource(r.source);
    if (!parsed.ok) continue;
    const body = parsed.body.trim();
    if (!body) continue;
    out.push({ id: r.id, body: parsed.body });
  }
  return out;
}
