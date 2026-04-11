import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = __dirname;

function readLicenseText() {
  return readFileSync(join(pkgRoot, "LICENSE"), "utf8");
}

function readPackageJson() {
  return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
}

test("LICENSE 含 MIT 与免责声明段落", () => {
  const text = readLicenseText();
  assert.match(text, /MIT License/i);
  assert.match(text, /AS IS/i);
  assert.match(text, /THE SOFTWARE IS PROVIDED/i);
});

test("package.json 与 spec 一致的 name、license、bin、files", () => {
  const pkg = readPackageJson();
  assert.equal(pkg.name, "@hanzhao111/opendesktop");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.bin?.opd, "./dist/cli.js");
  assert.ok(Array.isArray(pkg.files));
  assert.deepEqual(
    new Set(pkg.files),
    new Set(["dist", "web-dist", "LICENSE", "README.md"]),
  );
});

test("prepublish 同步后 dist/cli.js 存在且 CLI --help 成功", () => {
  execFileSync(process.execPath, [join(pkgRoot, "scripts", "prepublish-sync.mjs")], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
  const cli = join(pkgRoot, "dist", "cli.js");
  const webIndex = join(pkgRoot, "web-dist", "index.html");
  assert.ok(existsSync(cli), "dist/cli.js 应存在");
  assert.ok(existsSync(webIndex), "web-dist/index.html 应存在");
  const out = execFileSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  assert.ok(out.length > 0, "帮助输出非空");
});

test("npm pack 解压后不含 openspec 路径", () => {
  if (!existsSync(join(pkgRoot, "dist", "cli.js"))) {
    execFileSync(process.execPath, [join(pkgRoot, "scripts", "prepublish-sync.mjs")], {
      cwd: pkgRoot,
      stdio: "inherit",
    });
  }
  for (const f of readdirSync(pkgRoot)) {
    if (f.endsWith(".tgz")) {
      unlinkSync(join(pkgRoot, f));
    }
  }
  execSync("npm pack --pack-destination .", {
    cwd: pkgRoot,
    stdio: "pipe",
    shell: true,
  });
  const tgz = readdirSync(pkgRoot).find((f) => f.endsWith(".tgz"));
  assert.ok(tgz, "应生成 .tgz");
  const abs = join(pkgRoot, tgz);
  const prev = process.cwd();
  let list;
  try {
    process.chdir(pkgRoot);
    list = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
  } finally {
    process.chdir(prev);
  }
  assert.ok(list.includes("package/LICENSE"), "tarball 应含 LICENSE");
  assert.ok(list.includes("package/web-dist/index.html"), "tarball 应含 Web 静态入口");
  assert.ok(!list.includes("openspec"), "tarball 不应含 openspec 路径");
  unlinkSync(abs);
});
