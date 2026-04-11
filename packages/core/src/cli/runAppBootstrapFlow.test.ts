import type { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { runAppBootstrapFlow } from "./runAppBootstrapFlow.js";

const program = {} as Command;

describe("runAppBootstrapFlow", () => {
  it("returns exit 2 when app id already exists", async () => {
    const apiFetch = vi.fn(async (_p: Command, method: string, path: string) => {
      if (method === "GET" && path === "/v1/apps") {
        return new Response(JSON.stringify({ apps: [{ id: "taken" }] }), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    });
    const r = await runAppBootstrapFlow(apiFetch, program, {
      appId: "taken",
      executable: "/bin/x",
      cwd: "/",
      args: [],
      injectElectronDebugPort: true,
      profileId: "taken-default",
      profileDisplayName: "default",
      startSession: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.exitCode).toBe(2);
    }
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(program, "GET", "/v1/apps");
  });

  it("does not POST /v1/apps when id taken", async () => {
    const apiFetch = vi.fn(async (_p: Command, method: string, path: string) => {
      if (method === "GET" && path === "/v1/apps") {
        return new Response(JSON.stringify({ apps: [{ id: "x" }] }), { status: 200 });
      }
      if (method === "POST" && path === "/v1/apps") {
        return new Response("{}", { status: 201 });
      }
      return new Response("{}", { status: 200 });
    });
    const r = await runAppBootstrapFlow(apiFetch, program, {
      appId: "x",
      executable: "/e",
      cwd: "/",
      args: [],
      injectElectronDebugPort: true,
      profileId: "x-default",
      profileDisplayName: "default",
      startSession: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.exitCode).toBe(2);
    }
    const postApps = apiFetch.mock.calls.filter((c) => c[1] === "POST" && c[2] === "/v1/apps");
    expect(postApps.length).toBe(0);
  });

  it("runs apps → profiles → sessions when --start", async () => {
    const apiFetch = vi.fn(async (_p: Command, method: string, path: string) => {
      if (method === "GET" && path === "/v1/apps") {
        return new Response(JSON.stringify({ apps: [] }), { status: 200 });
      }
      if (method === "POST" && path === "/v1/apps") {
        return new Response(JSON.stringify({ app: { id: "n" } }), { status: 201 });
      }
      if (method === "POST" && path === "/v1/profiles") {
        return new Response(JSON.stringify({ profile: { id: "n-default" } }), { status: 201 });
      }
      if (method === "POST" && path === "/v1/sessions") {
        return new Response(JSON.stringify({ session: { id: "s1" } }), { status: 201 });
      }
      return new Response("bad", { status: 500 });
    });
    const r = await runAppBootstrapFlow(apiFetch, program, {
      appId: "n",
      executable: "/e",
      cwd: "/",
      args: [],
      injectElectronDebugPort: true,
      profileId: "n-default",
      profileDisplayName: "default",
      startSession: true,
    });
    expect(r.ok).toBe(true);
    expect(apiFetch.mock.calls.map((c) => `${c[1]} ${c[2]}`)).toEqual([
      "GET /v1/apps",
      "POST /v1/apps",
      "POST /v1/profiles",
      "POST /v1/sessions",
    ]);
  });
});
