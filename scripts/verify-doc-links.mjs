#!/usr/bin/env node
/**
 * 校验根目录 README.md / README_CN.md 中相对路径 Markdown 链接是否指向存在的文件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filesToScan = ["README.md", "README_CN.md"];

function collectLinks(text) {
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const href = m[1].trim().split("#")[0].split("?")[0];
    if (!href || href.startsWith("http://") || href.startsWith("https://")) continue;
    out.push(href);
  }
  return out;
}

let failed = false;

for (const rel of filesToScan) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.error("missing file:", rel);
    failed = true;
    continue;
  }
  const text = fs.readFileSync(p, "utf8");
  for (const href of collectLinks(text)) {
    const normalized = path.normalize(href);
    const target = path.join(root, normalized);
    if (!fs.existsSync(target)) {
      console.error(`broken link in ${rel}: (${href})`);
      failed = true;
    }
  }
}

process.exit(failed ? 1 : 0);
