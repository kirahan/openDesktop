import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function appendAudit(dataDir: string, event: Record<string, unknown>): Promise<void> {
  const dir = path.join(dataDir, "logs");
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  await appendFile(path.join(dir, "audit.jsonl"), line, "utf8");
}
