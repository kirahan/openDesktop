import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { appendAudit } from "../audit.js";

type Bucket = { count: number; expireAt: number };

/**
 * 固定窗口：自首次请求起 60s 内计数，超限返回 false。
 */
export function createRateLimiter(maxPerWindow: number) {
  const buckets = new Map<string, Bucket>();

  return function allow(key: string): boolean {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.expireAt) {
      b = { count: 0, expireAt: now + 60_000 };
      buckets.set(key, b);
    }
    b.count += 1;
    return b.count <= maxPerWindow;
  };
}

export function bearerKey(req: Request): string {
  const auth = req.headers.authorization ?? "";
  return createHash("sha256").update(auth, "utf8").digest("hex").slice(0, 32);
}

export function agentRateLimitMiddleware(
  maxPerMinute: number,
  dataDir: string,
) {
  const allow = createRateLimiter(maxPerMinute);
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = bearerKey(req);
    if (!allow(key)) {
      res.setHeader("Retry-After", "60");
      await appendAudit(dataDir, {
        type: "agent.rate_limited",
        path: req.path,
      }).catch(() => undefined);
      res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many agent requests" },
      });
      return;
    }
    next();
  };
}
