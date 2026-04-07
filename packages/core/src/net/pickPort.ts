import net from "node:net";

/**
 * Pick a free TCP port on the given host (default loopback).
 */
export function pickFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        server.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      } else {
        reject(new Error("Could not resolve ephemeral port"));
      }
    });
  });
}
