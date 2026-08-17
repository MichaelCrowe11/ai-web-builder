import { describe, it, expect, beforeEach, vi } from "vitest";

// track() writes through storage, which we do not want in a unit test. Mocking
// the module lets us assert exactly which funnel event each request produces.
const tracked: Array<{ event: string; anonId?: string }> = [];
vi.mock("./funnel", () => ({
  track: (event: string, subject: any = {}) => { tracked.push({ event, anonId: subject.anonId }); },
  anonIdFromIp: (ip: string) => `anon:${ip}`,
}));

const { isBot, trackLandingViews, resetLandingDedupe } = await import("./landing-track");

function reqOf(over: Partial<any> = {}): any {
  return {
    method: "GET",
    path: "/",
    url: "/",
    headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120", ...(over.headers ?? {}) },
    ip: over.ip ?? "1.2.3.4",
    socket: { remoteAddress: "1.2.3.4" },
    ...over,
  };
}

function run(req: any) {
  const next = vi.fn();
  trackLandingViews()(req, {} as any, next);
  return next;
}

describe("isBot", () => {
  it("treats a missing user agent as automated", () => {
    expect(isBot(undefined)).toBe(true);
    expect(isBot("")).toBe(true);
  });

  it("flags crawlers, scanners and HTTP libraries", () => {
    for (const ua of ["Googlebot/2.1", "curl/8.4", "python-requests/2.31", "Go-http-client/1.1", "masscan", "HeadlessChrome/120"]) {
      expect(isBot(ua), ua).toBe(true);
    }
  });

  it("passes real browser user agents", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    ]) {
      expect(isBot(ua), ua).toBe(false);
    }
  });
});

describe("trackLandingViews", () => {
  beforeEach(() => { tracked.length = 0; resetLandingDedupe(); });

  it("records a human document load of / as landing_view", () => {
    const next = run(reqOf());
    expect(tracked).toEqual([{ event: "landing_view", anonId: "anon:1.2.3.4" }]);
    expect(next).toHaveBeenCalled(); // never blocks the response
  });

  it("records an automated load as bot_view, keeping it out of the funnel stages", () => {
    run(reqOf({ headers: { accept: "text/html", "user-agent": "Googlebot/2.1" } }));
    expect(tracked).toEqual([{ event: "bot_view", anonId: "anon:1.2.3.4" }]);
  });

  // The SPA catch-all serves index.html for ANY unmatched path, including the
  // wp-admin probes this origin receives. Counting those as visits would inflate
  // the denominator of the activation rate we are trying to measure.
  it("ignores paths other than / even though they also serve index.html", () => {
    run(reqOf({ path: "/wp-admin/install.php", url: "/wp-admin/install.php" }));
    run(reqOf({ path: "/builder", url: "/builder" }));
    expect(tracked).toEqual([]);
  });

  it("ignores non-GET and non-HTML requests", () => {
    run(reqOf({ method: "POST" }));
    run(reqOf({ headers: { accept: "application/json", "user-agent": "Mozilla/5.0 Chrome/120" } }));
    expect(tracked).toEqual([]);
  });

  it("dedupes repeat views from one subject inside the window", () => {
    run(reqOf()); run(reqOf()); run(reqOf());
    expect(tracked).toHaveLength(1);
  });

  it("counts distinct subjects separately", () => {
    run(reqOf({ ip: "1.1.1.1" }));
    run(reqOf({ ip: "2.2.2.2" }));
    expect(tracked.map((t) => t.anonId)).toEqual(["anon:1.1.1.1", "anon:2.2.2.2"]);
  });

  it("prefers the x-forwarded-for client over the socket address", () => {
    run(reqOf({ headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Chrome/120", "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }));
    expect(tracked[0].anonId).toBe("anon:9.9.9.9");
  });
});
