import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { pickFreePort } from "./pickPort.js";

describe("pickFreePort", () => {
  it("returns a port that can be bound", async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.listen(port, "127.0.0.1", () => {
        s.close(() => resolve());
      });
      s.on("error", reject);
    });
  });
});
