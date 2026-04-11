import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const repoRoot = join(pkgRoot, "../..");
const coreDist = join(repoRoot, "packages/core/dist");
const dest = join(pkgRoot, "dist");

execSync("yarn workspace @opendesktop/core run build", {
  cwd: repoRoot,
  stdio: "inherit",
  shell: true,
});

if (!existsSync(coreDist)) {
  throw new Error(`Missing core build output: ${coreDist}`);
}

rmSync(dest, { recursive: true, force: true });
cpSync(coreDist, dest, { recursive: true });
