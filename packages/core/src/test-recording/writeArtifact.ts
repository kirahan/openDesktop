import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestRecordingArtifact } from "./artifactSchema.js";
import { parseTestRecordingArtifact } from "./artifactSchema.js";
import { appJsonSubdir, parseRecordingIdFromFilename, testRecordingFilename, validateAppId } from "./appJsonPaths.js";

/**
 * 确保 `<appJsonDir>/<appId>/` 存在。
 */
export async function ensureAppJsonDir(appJsonDir: string, appId: string): Promise<string> {
  const dir = appJsonSubdir(appJsonDir, appId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 原子写入测试录制制品 JSON（失败时尽力删除临时文件）。
 */
export async function writeTestRecordingArtifact(
  appJsonDir: string,
  appId: string,
  recordingId: string,
  artifact: TestRecordingArtifact,
): Promise<{ absolutePath: string }> {
  validateAppId(appId);
  const dir = await ensureAppJsonDir(appJsonDir, appId);
  const name = testRecordingFilename(recordingId);
  const finalPath = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.${String(process.pid)}.${String(Date.now())}.tmp`);
  const body = `${JSON.stringify(artifact, null, 2)}\n`;
  try {
    await writeFile(tmp, body, "utf8");
    await rename(tmp, finalPath);
    return { absolutePath: finalPath };
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/**
 * 列出某应用目录下全部 test-recording 的 recordingId。
 */
export async function listTestRecordingIds(appJsonDir: string, appId: string): Promise<string[]> {
  validateAppId(appId);
  const dir = appJsonSubdir(appJsonDir, appId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw e;
  }
  const ids: string[] = [];
  for (const n of names) {
    const id = parseRecordingIdFromFilename(n);
    if (id) ids.push(id);
  }
  return ids.sort();
}

/**
 * 读取已落盘的制品；文件不存在或 JSON 非法返回 null。
 */
export async function readTestRecordingArtifact(
  appJsonDir: string,
  appId: string,
  recordingId: string,
): Promise<TestRecordingArtifact | null> {
  validateAppId(appId);
  const dir = appJsonSubdir(appJsonDir, appId);
  const fp = path.join(dir, testRecordingFilename(recordingId));
  let raw: string;
  try {
    raw = await readFile(fp, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
  try {
    const v = JSON.parse(raw) as unknown;
    return parseTestRecordingArtifact(v);
  } catch {
    return null;
  }
}
