// Landing-page view tracking — the missing top of the acquisition funnel.
//
// Why this exists: until now the funnel's first stage was `anon_trial_start`,
// which only fires once someone has ALREADY run a build. Every conversion rate
// was therefore computed against people who had already engaged, silently
// excluding everyone who landed and left. That made the largest leak in the
// product — arriving and never trying it — the one thing we could not see.
//
// Two things make this measurement honest rather than flattering:
//
//   1. Bots are separated, not counted. The origin takes heavy automated
//      scanning (wp-admin probes, PHP shell hunting), and folding that into
//      "visitors" would understate the real activation rate by an order of
//      magnitude. Bot hits are recorded under their own event so the share
//      stays visible instead of being quietly dropped.
//   2. Views are deduped per subject per hour. A scanner hammering `/` would
//      otherwise write thousands of rows, and the funnel counts distinct
//      subjects anyway, so the extra writes buy nothing.
import type { Request, Response, NextFunction } from "express";
import { track, anonIdFromIp } from "./funnel";

// Substrings that identify non-human clients. Deliberately broad: a human
// misfiled as a bot costs us one data point, while a scanner counted as a
// visitor corrupts the activation rate we are trying to measure.
const BOT_PATTERNS = [
  "bot", "crawl", "spider", "slurp", "scrape", "curl", "wget", "python",
  "java/", "go-http", "okhttp", "libwww", "httpclient", "headless",
  "phantom", "puppeteer", "playwright", "monitor", "uptime", "pingdom",
  "scanner", "nmap", "masscan", "zgrab", "censys", "expanse", "facebookexternalhit",
];

/** True when the user agent looks automated, or is absent entirely. */
export function isBot(userAgent: string | undefined): boolean {
  if (!userAgent) return true; // no UA at all is a scanner tell, not a browser
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some((p) => ua.includes(p));
}

// Subject → epoch ms of last recorded view. In-process only: a restart or a
// second instance re-records a view, which is acceptable because the funnel
// counts DISTINCT subjects, so duplicates collapse at read time anyway.
const lastSeen = new Map<string, number>();
const DEDUPE_MS = 60 * 60 * 1000;
// Bound the map so a scanner cycling IPs cannot grow it without limit.
const MAX_TRACKED = 10_000;

/** True if this subject has not been recorded within the dedupe window. */
function shouldRecord(subject: string, now: number): boolean {
  const prev = lastSeen.get(subject);
  if (prev !== undefined && now - prev < DEDUPE_MS) return false;
  if (lastSeen.size >= MAX_TRACKED) lastSeen.clear();
  lastSeen.set(subject, now);
  return true;
}

/** Test seam: drop the dedupe state so cases don't leak into each other. */
export function resetLandingDedupe(): void {
  lastSeen.clear();
}

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Middleware recording a view of the marketing page.
 *
 * Scoped to GET "/" only. The SPA catch-all serves index.html for ANY unmatched
 * path — including the `/wp-admin/install.php` probes the origin receives — so
 * counting every HTML response would turn scanner noise into "traffic".
 *
 * Never blocks or delays the response: track() is fire-and-forget and swallows
 * its own failures, matching the rule that analytics must not break a request.
 */
export function trackLandingViews() {
  return function landingView(req: Request, res: Response, next: NextFunction) {
    if (req.method !== "GET") return next();
    const path = req.path || req.url;
    if (path !== "/") return next();
    // Ignore XHR/asset fetches that happen to hit "/" — we want document loads.
    if (!(req.headers.accept ?? "").includes("text/html")) return next();

    const subject = anonIdFromIp(clientIp(req));
    if (shouldRecord(subject, Date.now())) {
      const bot = isBot(req.headers["user-agent"]);
      track(bot ? "bot_view" : "landing_view", { anonId: subject });
    }
    next();
  };
}
