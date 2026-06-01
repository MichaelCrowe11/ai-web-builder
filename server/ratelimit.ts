// Minimal in-memory per-IP rate limiter to protect the Azure quota on a public
// launch. Not a billing system — just an abuse guard until real metering lands.
import type { Request, Response, NextFunction } from "express";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = Number(process.env.GENERATE_RATE_LIMIT ?? 10);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function rateLimitGenerate(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const ip = clientIp(req);
  let bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    const retryMin = Math.ceil((bucket.resetAt - now) / 60000);
    return res.status(429).json({
      error: "Rate limit reached",
      details: `Free limit is ${MAX_PER_WINDOW} generations/hour. Try again in ~${retryMin} min, or sign up for more.`,
    });
  }

  bucket.count += 1;
  next();
}
