import { afterEach, describe, expect, it } from "vitest";
import { parseFixedLocalProxyPortFromEnv } from "./forwardProxyServer.js";

describe("parseFixedLocalProxyPortFromEnv", () => {
  afterEach(() => {
    delete process.env.OPENDESKTOP_LOCAL_PROXY_PORT;
  });

  it("returns undefined when unset", () => {
    expect(parseFixedLocalProxyPortFromEnv()).toBeUndefined();
  });

  it("returns port when valid", () => {
    process.env.OPENDESKTOP_LOCAL_PROXY_PORT = "62266";
    expect(parseFixedLocalProxyPortFromEnv()).toBe(62266);
  });

  it("returns undefined for invalid", () => {
    process.env.OPENDESKTOP_LOCAL_PROXY_PORT = "bogus";
    expect(parseFixedLocalProxyPortFromEnv()).toBeUndefined();
  });
});
