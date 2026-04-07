import http from "node:http";

const port = Number(process.env.CDP_PORT);
if (!Number.isFinite(port)) {
  console.error("CDP_PORT missing");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url === "/json/version" || req.url?.startsWith("/json/version")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ Browser: "mock-cdp", ProtocolVersion: "1.3" }));
    return;
  }
  if (req.url === "/json" || req.url?.startsWith("/json")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([]));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log("mock-cdp listening", port);
});
