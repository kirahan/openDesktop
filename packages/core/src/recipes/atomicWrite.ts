import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 将 JSON 原子写入路径（同目录临时文件 + rename）。
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await writeFile(tmp, payload, "utf8");
  await rename(tmp, filePath);
}
