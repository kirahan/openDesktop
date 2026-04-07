import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export async function readOrCreateToken(tokenFile: string): Promise<string> {
  try {
    const t = (await readFile(tokenFile, "utf8")).trim();
    if (t) return t;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }
  await mkdir(path.dirname(tokenFile), { recursive: true });
  const token = randomBytes(24).toString("hex");
  await writeFile(tokenFile, token + "\n", { mode: 0o600 });
  try {
    await chmod(tokenFile, 0o600);
  } catch {
    /* windows may ignore */
  }
  return token;
}
