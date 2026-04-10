import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "./",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // 开发时页面在 5173，留空 API Base 会走相对路径 /v1 → 转发到本机 Core
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
