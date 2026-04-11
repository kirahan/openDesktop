import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const repoRoot = join(pkgRoot, "../..");
const coreDist = join(repoRoot, "packages/core/dist");
const webDist = join(repoRoot, "packages/web/dist");
const destCore = join(pkgRoot, "dist");
const destWeb = join(pkgRoot, "web-dist");

execSync("yarn workspace @opendesktop/web run build", {
  cwd: repoRoot,
  stdio: "inherit",
  shell: true,
});

execSync("yarn workspace @opendesktop/core run build", {
  cwd: repoRoot,
  stdio: "inherit",
  shell: true,
});

if (!existsSync(webDist)) {
  throw new Error(`Missing web build output: ${webDist}`);
}
if (!existsSync(coreDist)) {
  throw new Error(`Missing core build output: ${coreDist}`);
}

rmSync(destWeb, { recursive: true, force: true });
cpSync(webDist, destWeb, { recursive: true });

rmSync(destCore, { recursive: true, force: true });
cpSync(coreDist, destCore, { recursive: true });
