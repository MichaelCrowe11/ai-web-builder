// Per-user generation metering + paywall. Replaces the old global IP guard.
// Free accounts: FREE_DAILY_LIMIT/day. Pro: unlimited. Anonymous: ANON_DAILY_LIMIT/day per IP.
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { dailyLimitForPlan } from "./plan";
import { ANON_DAILY_LIMIT, type User } from "@shared/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

// Anonymous trial counters, in-memory by IP (resets on restart — acceptable for a trial).
type AnonBucket = { count: number; resetAt: number };
const anonBuckets = new Map<string, AnonBucket>();

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

// Has it been >= 24h since the user's counter was last reset?
function needsReset(resetAt: Date | null): boolean {
  if (!resetAt) return true;
  return Date.now() - new Date(resetAt).getTime() >= DAY_MS;
}

export interface QuotaState {
  plan: string;
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
}

// What we attach to the request after a successful quota check.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      quotaUser?: User;
      quotaState?: QuotaState;
    }
  }
}

/**
 * Express middleware: enforce the generation quota BEFORE running the model.
 * On pass, attaches req.quotaUser / req.quotaState. The route calls
 * consumeGeneration() AFTER a successful generation to increment the counter.
 */
export async function enforceQuota(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;

  // Anonymous: IP-based trial.
  if (!userId) {
    const ip = clientIp(req);
    const now = Date.now();
    let bucket = anonBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + DAY_MS };
      anonBuckets.set(ip, bucket);
    }
    if (bucket.count >= ANON_DAILY_LIMIT) {
      return res.status(402).json({
        error: "Free trial limit reached",
        details: `You've used your ${ANON_DAILY_LIMIT} free generations. Sign up to get ${dailyLimitForPlan("free")} a day, or go Pro for unlimited.`,
        requiresAuth: true,
        quota: { plan: "anonymous", used: bucket.count, limit: ANON_DAILY_LIMIT, remaining: 0 },
      });
    }
    req.quotaState = {
      plan: "anonymous",
      used: bucket.count,
      limit: ANON_DAILY_LIMIT,
      remaining: ANON_DAILY_LIMIT - bucket.count,
    };
    return next();
  }

  // Authenticated: per-user quota with daily reset.
  const user = await storage.getUser(userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Not authenticated" });
  }

  let used = user.generationsUsed;
  if (needsReset(user.generationsResetAt)) {
    used = 0;
    await storage.updateUser(user.id, { generationsUsed: 0, generationsResetAt: new Date() });
  }

  const limit = dailyLimitForPlan(user.plan);
  if (limit !== null && used >= limit) {
    return res.status(402).json({
      error: "Daily limit reached",
      details: `You've used all ${limit} generations for today. Upgrade to Pro for unlimited generations.`,
      requiresUpgrade: true,
      quota: { plan: user.plan, used, limit, remaining: 0 },
    });
  }

  req.quotaUser = { ...user, generationsUsed: used };
  req.quotaState = {
    plan: user.plan,
    used,
    limit,
    remaining: limit === null ? null : limit - used,
  };
  next();
}

export interface QuotaSnapshot {
  ok: boolean;            // false = a mutating generation would be refused
  state: QuotaState;
  user?: User;            // present when authenticated
  reason?: "requiresAuth" | "requiresUpgrade";
}

/**
 * Read quota WITHOUT rejecting the request. Used by chat turns: Q&A is always
 * allowed; ok=false only filters out mutating tools. opts.consume bumps the
 * anonymous bucket (test hook; real consumption uses consumeGeneration).
 */
export async function quotaSnapshot(req: Request, opts: { consume?: boolean } = {}): Promise<QuotaSnapshot> {
  const userId = req.session.userId;

  if (!userId) {
    const ip = clientIp(req);
    const now = Date.now();
    let bucket = anonBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + DAY_MS };
      anonBuckets.set(ip, bucket);
    }
    if (opts.consume) bucket.count += 1;
    const used = bucket.count;
    const ok = used < ANON_DAILY_LIMIT;
    return {
      ok,
      reason: ok ? undefined : "requiresAuth",
      state: { plan: "anonymous", used, limit: ANON_DAILY_LIMIT, remaining: Math.max(0, ANON_DAILY_LIMIT - used) },
    };
  }

  const user = await storage.getUser(userId);
  if (!user) return { ok: false, reason: "requiresAuth", state: { plan: "free", used: 0, limit: dailyLimitForPlan("free"), remaining: 0 } };

  let used = user.generationsUsed;
  if (needsReset(user.generationsResetAt)) {
    used = 0;
    await storage.updateUser(user.id, { generationsUsed: 0, generationsResetAt: new Date() });
  }
  const limit = dailyLimitForPlan(user.plan);
  const ok = limit === null || used < limit;
  return {
    ok,
    reason: ok ? undefined : "requiresUpgrade",
    user: { ...user, generationsUsed: used },
    state: { plan: user.plan, used, limit, remaining: limit === null ? null : Math.max(0, limit - used) },
  };
}

/**
 * Increment the counter after a successful generation. Returns the updated
 * quota state to return to the client. Safe to call for anonymous (bumps IP bucket).
 */
export async function consumeGeneration(req: Request): Promise<QuotaState> {
  const userId = req.session.userId;

  if (!userId) {
    const ip = clientIp(req);
    const bucket = anonBuckets.get(ip);
    if (bucket) bucket.count += 1;
    const used = bucket?.count ?? 1;
    return {
      plan: "anonymous",
      used,
      limit: ANON_DAILY_LIMIT,
      remaining: Math.max(0, ANON_DAILY_LIMIT - used),
    };
  }

  const user = req.quotaUser ?? (await storage.getUser(userId));
  if (!user) {
    return { plan: "free", used: 0, limit: dailyLimitForPlan("free"), remaining: dailyLimitForPlan("free") };
  }
  const used = user.generationsUsed + 1;
  await storage.updateUserGenerations(user.id, used);
  const limit = dailyLimitForPlan(user.plan);
  return {
    plan: user.plan,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
  };
}
