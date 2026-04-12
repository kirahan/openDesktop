import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [join(dir, "src/entry.ts")],
  bundle: true,
  outfile: join(dir, "dist/inject.bundle.js"),
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  logLevel: "info",
});
