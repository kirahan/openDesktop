import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function pidPath(dataDir: string): string {
  return path.join(dataDir, "opendesktop-core.pid");
}

export async function writePidFile(dataDir: string, pid: number): Promise<void> {
  await writeFile(pidPath(dataDir), String(pid), "utf8");
}

export async function removePidFile(dataDir: string): Promise<void> {
  try {
    await unlink(pidPath(dataDir));
  } catch {
    /* ignore */
  }
}

export async function readPid(dataDir: string): Promise<number | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = (await readFile(pidPath(dataDir), "utf8")).trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}
