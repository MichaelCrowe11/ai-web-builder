// Server-side product funnel: a fire-and-forget writer plus the read/aggregate
// path behind /api/admin/funnel. Analytics must NEVER break a user request, so
// track() swallows its own errors and runs off the response path.
import { createHash } from "crypto";
import { storage } from "./storage";
import { log } from "./log";
import {
  buildAcquisitionFunnel,
  type ProductEventName,
  type ProductEvent,
  type AcquisitionFunnel,
} from "@shared/funnel";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stable, non-reversible id for an anonymous subject: a salted hash of the IP.
 * We never store the raw IP, and the hash is enough to dedupe one visitor
 * across repeated events without identifying them.
 */
export function anonIdFromIp(ip: string): string {
  const salt = process.env.FUNNEL_SALT ?? "ai-webbuilder";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

interface Subject {
  userId?: string;
  anonId?: string;
  meta?: Record<string, string | number>;
}

/** Record a funnel event. Never throws; failures are logged, not propagated. */
export function track(event: ProductEventName, subject: Subject = {}): void {
  const e: ProductEvent = {
    ts: Date.now(),
    event,
    userId: subject.userId,
    anonId: subject.anonId,
    meta: subject.meta,
  };
  Promise.resolve()
    .then(() => storage.recordProductEvent(e))
    .catch((err) => log(`funnel track ${event} failed: ${err?.message ?? err}`));
}

/** Build the acquisition funnel over a trailing window (default 30 days). */
export async function acquisitionFunnel(windowMs = 30 * DAY_MS): Promise<AcquisitionFunnel> {
  const events = await storage.recentProductEvents(Date.now() - windowMs);
  return buildAcquisitionFunnel(events, windowMs);
}
