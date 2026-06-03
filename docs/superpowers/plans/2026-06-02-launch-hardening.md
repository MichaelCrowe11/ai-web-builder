# Launch-Readiness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-risk a Product Hunt launch by making the generation endpoint survive a traffic spike (graceful "queued" wait, never a hard failure) and giving visitors instant proof via a gallery of 6 live, clickable example sites.

**Architecture:** A process-local concurrency semaphore (`server/gen-limiter.ts`) bounds simultaneous Azure calls; overflow throws a typed `AtCapacityError` that routes turn into a `503 + Retry-After`, and the client auto-retries with jitter behind a calm "high demand" state. A static, no-API showcase gallery on the home page links to 6 pre-generated, published sites.

**Tech Stack:** Express + TypeScript (server), Vite + React 19 + Tailwind v4 (client), vitest (tests, dependency-injection style), Drizzle + Postgres, Railway deploy via `railway up -s web -e production --ci`.

---

## File Structure

**Create:**
- `server/gen-limiter.ts` — concurrency semaphore + `AtCapacityError` + `runLimited`.
- `server/gen-limiter.test.ts` — unit tests (concurrency cap, queue drain, capacity throw, no leak).
- `client/src/lib/generate-fetch.ts` — `postWithCapacityRetry` (503-aware auto-retry).
- `client/src/lib/generate-fetch.test.ts` — unit tests for the retry helper.
- `client/src/lib/showcase.ts` — static manifest of the 6 showcase sites.
- `client/src/components/showcase-gallery.tsx` — home-page gallery section.
- `client/public/showcase/*.jpg` — 6 screenshots (binary, added in Task 7).
- `scripts/seed_showcase.py` — seeds the 6 published showcase sites against prod.

**Modify:**
- `server/routes.ts` — wrap Azure calls in `runLimited`; 503 catch on the 5 generating routes.
- `client/src/pages/builder.tsx` — use `postWithCapacityRetry`; pass a `queued` flag to the overlay.
- `client/src/components/builder/generation-overlay.tsx` — optional "high demand / queued" copy.
- `client/src/pages/home.tsx` — render `<ShowcaseGallery />`.

---

## Task 1: Concurrency limiter (`server/gen-limiter.ts`)

**Files:**
- Create: `server/gen-limiter.ts`
- Test: `server/gen-limiter.test.ts`

- [ ] **Step 1: Write the failing test**

`server/gen-limiter.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeLimiter, AtCapacityError } from "./gen-limiter";

// A controllable promise: resolve() it from the test to let a task "finish".
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("gen-limiter", () => {
  it("runs up to maxConcurrent immediately and queues the rest", async () => {
    const lim = makeLimiter({ maxConcurrent: 2, maxQueue: 10, maxWaitMs: 1000 });
    const d1 = deferred(), d2 = deferred(), d3 = deferred();
    const started = [false, false, false];
    const p1 = lim.runLimited(async () => { started[0] = true; await d1.promise; });
    const p2 = lim.runLimited(async () => { started[1] = true; await d2.promise; });
    const p3 = lim.runLimited(async () => { started[2] = true; await d3.promise; });
    await tick();
    expect(started).toEqual([true, true, false]); // 3rd is queued
    d1.resolve();           // free a permit
    await p1; await tick();
    expect(started[2]).toBe(true); // queued task now runs
    d2.resolve(); d3.resolve(); await Promise.all([p2, p3]);
  });

  it("throws AtCapacityError when the queue is full", async () => {
    const lim = makeLimiter({ maxConcurrent: 1, maxQueue: 1, maxWaitMs: 1000 });
    const d1 = deferred(), d2 = deferred();
    const p1 = lim.runLimited(() => d1.promise); // active
    const p2 = lim.runLimited(() => d2.promise); // queued (depth 1)
    await tick();
    await expect(lim.runLimited(async () => {})).rejects.toBeInstanceOf(AtCapacityError);
    d1.resolve(); await p1; d2.resolve(); await p2;
  });

  it("rejects a waiter with AtCapacityError after maxWaitMs (injected timer)", async () => {
    const timers: Array<() => void> = [];
    const lim = makeLimiter({
      maxConcurrent: 1, maxQueue: 5, maxWaitMs: 50,
      setTimer: (fn) => { timers.push(fn); return timers.length - 1; },
      clearTimer: () => {},
    });
    const d1 = deferred();
    const p1 = lim.runLimited(() => d1.promise); // holds the only permit
    const waiting = lim.runLimited(async () => {}); // queued, will time out
    await tick();
    timers.forEach((fn) => fn()); // fire the wait-timeout
    await expect(waiting).rejects.toBeInstanceOf(AtCapacityError);
    d1.resolve(); await p1;
  });

  it("releases the permit on both success and throw (no leak)", async () => {
    const lim = makeLimiter({ maxConcurrent: 1, maxQueue: 5, maxWaitMs: 1000 });
    await lim.runLimited(async () => "ok");
    await expect(lim.runLimited(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // If the permit leaked, this third call would hang; a resolved value proves release.
    await expect(lim.runLimited(async () => "again")).resolves.toBe("again");
  });

  it("AtCapacityError carries a positive retryAfterMs", () => {
    const e = new AtCapacityError(8000);
    expect(e.name).toBe("AtCapacityError");
    expect(e.retryAfterMs).toBe(8000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/gen-limiter.test.ts`
Expected: FAIL — `Cannot find module './gen-limiter'`.

- [ ] **Step 3: Write minimal implementation**

`server/gen-limiter.ts`:
```ts
// Process-local concurrency gate for the expensive Azure generation calls.
// Bounds how many calls we make to Azure at once so a traffic spike degrades into
// a short queue (and, past the queue, a graceful 503) instead of a 429 retry storm.

export class AtCapacityError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("at_capacity");
    this.name = "AtCapacityError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface LimiterOpts {
  maxConcurrent: number;
  maxQueue: number;
  maxWaitMs: number;
  // Injectable for tests; default to real timers.
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Waiter {
  grant: () => void;
  fail: (e: unknown) => void;
  timer: unknown;
}

export function makeLimiter(opts: LimiterOpts) {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let active = 0;
  const queue: Waiter[] = [];

  // Rough client hint: how long until a slot likely frees.
  function retryHintMs(): number {
    const ahead = queue.length + 1;
    return Math.max(2000, Math.min(opts.maxWaitMs, Math.ceil(ahead / opts.maxConcurrent) * 8000));
  }

  function acquire(): Promise<void> {
    if (active < opts.maxConcurrent) {
      active++;
      return Promise.resolve();
    }
    if (queue.length >= opts.maxQueue) {
      return Promise.reject(new AtCapacityError(retryHintMs()));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => { clearTimer(waiter.timer); resolve(); },
        fail: reject,
        timer: setTimer(() => {
          const i = queue.indexOf(waiter);
          if (i >= 0) queue.splice(i, 1);
          reject(new AtCapacityError(opts.maxWaitMs));
        }, opts.maxWaitMs),
      };
      queue.push(waiter);
    });
  }

  function release(): void {
    const next = queue.shift();
    if (next) {
      next.grant(); // hand the permit straight to the waiter; active stays the same
    } else {
      active--;
    }
  }

  async function runLimited<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  function stats() {
    return { active, queued: queue.length };
  }

  return { runLimited, stats };
}

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Singleton built from env. Defaults tuned conservatively; raise once the live
// load test shows Azure tolerates more concurrency.
export const genLimiter = makeLimiter({
  maxConcurrent: envInt("AI_WEBBUILDER_MAX_CONCURRENT", 4),
  maxQueue: envInt("AI_WEBBUILDER_MAX_QUEUE", 30),
  maxWaitMs: envInt("AI_WEBBUILDER_MAX_WAIT_MS", 25000),
});

export const runLimited = genLimiter.runLimited;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/gen-limiter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/gen-limiter.ts server/gen-limiter.test.ts
git commit -m "feat: process-local concurrency limiter for generation (spike resilience)"
```

---

## Task 2: Wire the limiter into the generating routes

**Files:**
- Modify: `server/routes.ts` (routes at lines ~51, 75, 90, 117, 282)

- [ ] **Step 1: Import the limiter**

At the top of `server/routes.ts`, near the other `./` imports (e.g. after the `enforceQuota` import on line 18):
```ts
import { runLimited, AtCapacityError } from "./gen-limiter";
```

- [ ] **Step 2: Add a shared 503 helper**

Inside `registerRoutes` (top of the function body, before the route definitions), add:
```ts
  // Turn an AtCapacityError into a graceful 503 the client auto-retries.
  const sendCapacity = (res: Response, err: AtCapacityError) => {
    res.setHeader("Retry-After", String(Math.ceil(err.retryAfterMs / 1000)));
    return res.status(503).json({ error: "at_capacity", retryAfterMs: err.retryAfterMs });
  };
```

- [ ] **Step 3: Wrap each Azure generation call in `runLimited`**

Make exactly these substitutions (the call site only — `consumeGeneration` stays where it is, AFTER the wrapped call, so a capacity throw never consumes quota):

`/api/generate/document` (line ~58):
```ts
      const raw = await runLimited(() => generateDocument(prompt));
```
`/api/generate/outline` (line ~81):
```ts
      const outline = await runLimited(() => generateOutline(prompt));
```
`/api/generate/fill` (line ~100):
```ts
      const raw = await runLimited(() => fillDocument(parsed.data, prompt));
```
`/api/refine` (line ~128):
```ts
      const refined = await runLimited(() => refineDocument(parsed.data, instruction));
```
`/api/generate` legacy (line ~282 body — wrap the model call; find the `await generate...`/`await azure...` line in that handler and wrap its expression the same way).

- [ ] **Step 4: Add the capacity branch to each of those 5 `catch` blocks**

In each of the 5 handlers' `catch (error: any) {` block, add as the FIRST line inside the catch:
```ts
      if (error?.name === "AtCapacityError") return sendCapacity(res, error as AtCapacityError);
```
(Leave the existing `log(...)` + 500 response after it.)

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: no errors. (`Response` is already imported in `routes.ts`.)

- [ ] **Step 6: Add a unit test for the capacity-response shape**

Append to `server/gen-limiter.test.ts`:
```ts
import { makeCapacityPayload } from "./gen-limiter";

describe("capacity payload", () => {
  it("maps retryAfterMs to a whole-second Retry-After and stable body", () => {
    const { retryAfterSeconds, body } = makeCapacityPayload(new AtCapacityError(8200));
    expect(retryAfterSeconds).toBe(9);          // ceil(8.2s)
    expect(body).toEqual({ error: "at_capacity", retryAfterMs: 8200 });
  });
});
```
Then add this pure helper to `server/gen-limiter.ts` (and use it inside `sendCapacity` in routes.ts to keep one source of truth):
```ts
export function makeCapacityPayload(err: AtCapacityError) {
  return {
    retryAfterSeconds: Math.ceil(err.retryAfterMs / 1000),
    body: { error: "at_capacity" as const, retryAfterMs: err.retryAfterMs },
  };
}
```
Refactor `sendCapacity` in `routes.ts` to use it:
```ts
  const sendCapacity = (res: Response, err: AtCapacityError) => {
    const { retryAfterSeconds, body } = makeCapacityPayload(err);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(503).json(body);
  };
```

- [ ] **Step 7: Run tests + build**

Run: `npx vitest run server/gen-limiter.test.ts && npm run check && npm run build`
Expected: tests PASS, tsc clean, build clean.

- [ ] **Step 8: Commit**

```bash
git add server/routes.ts server/gen-limiter.ts server/gen-limiter.test.ts
git commit -m "feat: 503 at_capacity on generation overload (quota-safe, Retry-After)"
```

---

## Task 3: Client capacity-retry helper (`client/src/lib/generate-fetch.ts`)

**Files:**
- Create: `client/src/lib/generate-fetch.ts`
- Test: `client/src/lib/generate-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

`client/src/lib/generate-fetch.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { postWithCapacityRetry } from "./generate-fetch";

function res(status: number, body: any, headers: Record<string, string> = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("postWithCapacityRetry", () => {
  it("returns immediately on a 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(200, { ok: true }));
    const r = await postWithCapacityRetry("/api/x", { a: 1 }, { fetchImpl, sleep: async () => {} });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 at_capacity, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(503, { error: "at_capacity", retryAfterMs: 10 }))
      .mockResolvedValueOnce(res(503, { error: "at_capacity", retryAfterMs: 10 }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const onQueued = vi.fn();
    const r = await postWithCapacityRetry("/api/x", {}, { fetchImpl, sleep: async () => {}, onQueued, maxRetries: 5 });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onQueued).toHaveBeenCalled(); // UI was told we're queued
  });

  it("gives up after maxRetries and returns the last 503", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503, { error: "at_capacity", retryAfterMs: 5 }));
    const r = await postWithCapacityRetry("/api/x", {}, { fetchImpl, sleep: async () => {}, maxRetries: 2 });
    expect(r.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("passes a non-503 response straight through (no retry)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(402, { error: "out of quota" }));
    const r = await postWithCapacityRetry("/api/x", {}, { fetchImpl, sleep: async () => {} });
    expect(r.status).toBe(402);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/lib/generate-fetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`client/src/lib/generate-fetch.ts`:
```ts
// POST that survives a 503 "at_capacity" from the server's concurrency limiter by
// auto-retrying with jitter behind a calm "queued" UI state, so a launch-day spike
// degrades into a short wait instead of a visible failure.

export interface CapacityRetryOpts {
  maxRetries?: number;                       // default 5
  onQueued?: (info: { attempt: number; retryAfterMs: number }) => void;
  fetchImpl?: typeof fetch;                  // injectable for tests
  sleep?: (ms: number) => Promise<void>;     // injectable for tests
}

const jitter = (ms: number) => ms * (0.8 + Math.random() * 0.4); // +/-20%

export async function postWithCapacityRetry(
  url: string,
  body: unknown,
  opts: CapacityRetryOpts = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 5;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let last: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (res.status !== 503) return res; // success or a real error -> caller handles
    // Peek the body to confirm it's our capacity signal (clone so the caller can read it too).
    let retryAfterMs = 8000;
    try {
      const data = await res.clone().json();
      if (data?.error !== "at_capacity") return res; // some other 503 -> don't retry
      if (typeof data.retryAfterMs === "number") retryAfterMs = data.retryAfterMs;
    } catch {
      return res;
    }
    last = res;
    if (attempt === maxRetries) break;
    opts.onQueued?.({ attempt: attempt + 1, retryAfterMs });
    await sleep(jitter(retryAfterMs));
  }
  return last as Response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/src/lib/generate-fetch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/generate-fetch.ts client/src/lib/generate-fetch.test.ts
git commit -m "feat: client capacity-retry helper for generation overload"
```

---

## Task 4: Wire retry + calm "queued" state into the builder

**Files:**
- Modify: `client/src/components/builder/generation-overlay.tsx`
- Modify: `client/src/pages/builder.tsx` (handleGenerate, lines ~73-121; overlay render line ~408)

- [ ] **Step 1: Add a `queued` prop to the overlay**

Read `client/src/components/builder/generation-overlay.tsx` to confirm its prop type, then add an optional `queued?: boolean` prop. When `queued` is true, show calm high-demand copy instead of the normal building copy. Example change to its props + the headline line:
```tsx
export function GenerationOverlay({ refining, queued }: { refining?: boolean; queued?: boolean }) {
  // ...existing markup...
  // Replace the main status line with:
  //   {queued
  //     ? "High demand right now — your site is queued. Hang tight…"
  //     : refining ? "Refining your site…" : "Designing your site…"}
}
```
Keep the existing animation/markup; only the status text branches on `queued`.

- [ ] **Step 2: Add a `queued` state + import the helper in builder.tsx**

Near the other `useState` hooks at the top of the `Builder` component, add:
```tsx
  const [queued, setQueued] = useState(false);
```
Add the import near line 19:
```tsx
  import { postWithCapacityRetry } from "@/lib/generate-fetch";
```

- [ ] **Step 3: Replace the local `post` with the capacity-aware helper in `handleGenerate`**

In `handleGenerate` (lines ~73-121), delete the local `const post = (url, body) => fetch(...)` closure and replace the two phase calls so they retry on capacity and toggle the `queued` flag:
```tsx
      // Phase 1: outline -> instant themed skeleton.
      const oRes = await postWithCapacityRetry("/api/generate/outline", { prompt }, {
        onQueued: () => setQueued(true),
      });
      setQueued(false);
      const oData = await oRes.json();
      if (gate(oRes.status, oData, "Generation failed")) return;
      // ...unchanged...

      // Phase 2: expand the outline into the full document.
      const fRes = await postWithCapacityRetry("/api/generate/fill", { prompt, outline: oData.outline }, {
        onQueued: () => setQueued(true),
      });
      setQueued(false);
      const fData = await fRes.json();
      if (gate(fRes.status, fData, "Generation failed")) return;
```
In the `finally` block (line ~117), also reset queued:
```tsx
    } finally {
      setIsGenerating(false);
      setFilling(false);
      setQueued(false);
    }
```

- [ ] **Step 4: Pass `queued` to the overlay**

At the overlay render (line ~408):
```tsx
        {isGenerating && !filling && <GenerationOverlay refining={hasGenerated} queued={queued} />}
```

- [ ] **Step 5: Type-check + build**

Run: `npm run check && npm run build`
Expected: tsc clean, build clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/builder.tsx client/src/components/builder/generation-overlay.tsx
git commit -m "feat: calm 'high demand' queued state with auto-retry in the builder"
```

---

## Task 5: Gate, deploy, and live load test

**Files:** none (verification task).

- [ ] **Step 1: Full gate**

Run: `npx vitest run && npm run check && npm run build`
Expected: all tests PASS, tsc clean, build clean.

- [ ] **Step 2: Deploy**

Run: `railway up -s web -e production --ci`
Expected: "Deploy complete". (Optionally set a low `AI_WEBBUILDER_MAX_CONCURRENT=2` on the web service first to make the limiter observable under a small test load, then raise it back.)

- [ ] **Step 3: Wait for SUCCESS**

Run: `railway deployment list | head -3`
Expected: top deployment shows `SUCCESS`.

- [ ] **Step 4: Fire concurrent generations and confirm graceful queueing**

Run (fires `MAX_CONCURRENT + several` concurrent anon outline calls and prints each status):
```bash
for i in $(seq 1 10); do
  ( curl -s -o /dev/null -w "req$i: %{http_code}\n" --max-time 60 \
      -X POST https://ai-webbuilder.com/api/generate/outline \
      -H "Content-Type: application/json" \
      -d '{"prompt":"a coffee shop in Austin"}' ) &
done; wait
```
Expected: a mix of `200` (served) and some `503` (at_capacity) under a low cap — and crucially NO `500`. Each 503 would be auto-retried by a real browser client.

- [ ] **Step 5: Confirm a 503 did not consume anon quota**

Reasoning is structural (consume runs after the wrapped call), but verify: from a fresh cookie jar, drive enough concurrent calls to force a 503, then check `GET /api/auth/me` (or the anon quota header) shows the 503'd attempts were not counted. Document the observed numbers.

- [ ] **Step 6: Restore the cap and redeploy if you lowered it**

If you set `AI_WEBBUILDER_MAX_CONCURRENT=2` for testing, set it back to the tuned value (start `4`) and redeploy. Record the value you chose and why.

- [ ] **Step 7: Commit any tuning notes**

```bash
git commit --allow-empty -m "chore: load-tested generation limiter; MAX_CONCURRENT tuned to <N>"
```

---

## Task 6: Seed 6 published showcase sites

**Files:**
- Create: `scripts/seed_showcase.py`

- [ ] **Step 1: Write the seed script**

`scripts/seed_showcase.py` (drives the REAL prod pipeline as a Pro `showcase` account, then reserves a stable slug + publishes via psql). Requires env: `BASE` (default `https://ai-webbuilder.com`) and `PGURL` (the `DATABASE_PUBLIC_URL`).
```python
#!/usr/bin/env python3
"""Seed 6 published showcase sites through the live generation pipeline."""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get("BASE", "https://ai-webbuilder.com")
PGURL = os.environ["PGURL"]
SHOW_USER = "showcase"
SHOW_PASS = os.environ.get("SHOW_PASS", "showcase-" + os.urandom(6).hex())

SITES = [
    ("showcase-cafe",    "a cozy specialty coffee shop called Bean & Bough in Austin"),
    ("showcase-plumber", "Northside Plumbing, a licensed 24/7 plumbing company in Denver"),
    ("showcase-salon",   "Lumen Studio, a modern hair and beauty salon in Brooklyn"),
    ("showcase-law",     "Hart & Vale, a boutique family and estate law firm in Seattle"),
    ("showcase-florist", "Wild Stem, a seasonal florist and plant shop in Portland"),
    ("showcase-gym",     "Iron Atlas, a strength-focused fitness gym in Chicago"),
]

def http(method, path, data=None, cookie=None):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    if data is not None: req.add_header("Content-Type", "application/json")
    if cookie: req.add_header("Cookie", cookie)
    try:
        r = urllib.request.urlopen(req, timeout=120)
        return r.status, r.read(), r.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), None

def psql(sql):
    subprocess.run(["psql", PGURL, "-c", sql], check=True)

# 1. ensure showcase account (register; ignore "exists"), then log in for a cookie
http("POST", "/api/auth/register", {"username": SHOW_USER, "password": SHOW_PASS})
st, bod, cookie = http("POST", "/api/auth/login", {"username": SHOW_USER, "password": SHOW_PASS})
if st != 200:
    print("login failed (set SHOW_PASS to the existing showcase password):", st, bod[:200]); sys.exit(1)
session = cookie.split(";")[0] if cookie else None
# 2. make it Pro so generated images render
psql(f"UPDATE users SET plan='pro' WHERE username='{SHOW_USER}';")

for slug, prompt in SITES:
    print(f"--- {slug}: {prompt}")
    st, bod, _ = http("POST", "/api/generate/document", {"prompt": prompt}, session)
    if st != 200: print("  gen failed:", st, bod[:200]); continue
    gen = json.loads(bod)
    # create the project (owned by showcase via session)
    st, bod, _ = http("POST", "/api/projects",
        {"name": gen["document"]["meta"]["name"], "html": gen["html"], "css": gen["css"]}, session)
    pid = json.loads(bod)["id"]
    # add Pro images, then persist the enriched doc (creates a site_document row)
    st, bod, _ = http("POST", "/api/generate/images", {"document": gen["document"]}, session)
    doc = json.loads(bod)["document"] if st == 200 else gen["document"]
    http("PUT", f"/api/projects/{pid}/document", {"document": doc}, session)
    # reserve the stable slug + publish
    psql("UPDATE projects SET slug=%s, is_published=true, published_url=%s WHERE id=%s;"
         % (repr(slug), repr(f"https://{slug}.ai-webbuilder.com"), repr(pid)))
    print(f"  published https://{slug}.ai-webbuilder.com  (project {pid})")

print("done.")
```

- [ ] **Step 2: Run it**

Run:
```bash
PGURL="$(railway variables -s Postgres --kv | sed -n 's/^DATABASE_PUBLIC_URL=//p')" \
  python3 scripts/seed_showcase.py
```
Expected: 6 lines `published https://showcase-<x>.ai-webbuilder.com (project …)`.

- [ ] **Step 3: Verify each is live**

Run:
```bash
for s in cafe plumber salon law florist gym; do
  echo -n "showcase-$s: "; curl -s -o /dev/null -w "%{http_code}\n" "https://showcase-$s.ai-webbuilder.com";
done
```
Expected: all `200`. Eyeball 2-3 in a browser to confirm they look expensive (Pro images present).

- [ ] **Step 4: Commit the script**

```bash
git add scripts/seed_showcase.py
git commit -m "chore: seed script for 6 published showcase sites"
```

---

## Task 7: Screenshots + manifest + gallery component + home wiring

**Files:**
- Create: `client/public/showcase/*.jpg` (6)
- Create: `client/src/lib/showcase.ts`
- Create: `client/src/components/showcase-gallery.tsx`
- Modify: `client/src/pages/home.tsx`

- [ ] **Step 1: Capture a thumbnail of each live site (disk-safe, no Playwright install)**

The Mac's disk runs near-full and Playwright browser installs are a known disk hog — do NOT install Playwright. Use the hosted thum.io screenshot service to fetch a one-time static JPG of each live published site, then commit the static files (no runtime dependency on the service):
```bash
mkdir -p client/public/showcase
for s in cafe plumber salon law florist gym; do
  curl -s -L "https://image.thum.io/get/width/1200/crop/800/https://showcase-$s.ai-webbuilder.com" \
    -o "client/public/showcase/showcase-$s.jpg"
  echo -n "showcase-$s.jpg: "; identify -format "%wx%h\n" "client/public/showcase/showcase-$s.jpg" 2>/dev/null || file "client/public/showcase/showcase-$s.jpg"
done
```
Expected: 6 non-empty JPGs ~1200×800. (If thum.io returns an error image for any, retry once; fallback service: `https://api.microlink.io/?url=<URL>&screenshot=true&meta=false&embed=screenshot.url`.)

- [ ] **Step 2: Write the static manifest**

`client/src/lib/showcase.ts`:
```ts
// Static, no-API manifest for the home-page gallery. Updating the gallery = edit this
// array + drop a screenshot in client/public/showcase/. Zero runtime DB/API load.
export interface ShowcaseSite {
  slug: string;       // <slug>.ai-webbuilder.com
  name: string;       // business name
  industry: string;   // eyebrow label
  thumb: string;      // /showcase/<file>.jpg
}

export const SHOWCASE_SITES: ShowcaseSite[] = [
  { slug: "showcase-cafe",    name: "Bean & Bough",        industry: "Coffee shop",  thumb: "/showcase/showcase-cafe.jpg" },
  { slug: "showcase-plumber", name: "Northside Plumbing",  industry: "Home services", thumb: "/showcase/showcase-plumber.jpg" },
  { slug: "showcase-salon",   name: "Lumen Studio",        industry: "Salon",        thumb: "/showcase/showcase-salon.jpg" },
  { slug: "showcase-law",     name: "Hart & Vale",         industry: "Law firm",     thumb: "/showcase/showcase-law.jpg" },
  { slug: "showcase-florist", name: "Wild Stem",           industry: "Florist",      thumb: "/showcase/showcase-florist.jpg" },
  { slug: "showcase-gym",     name: "Iron Atlas",          industry: "Fitness",      thumb: "/showcase/showcase-gym.jpg" },
];

export const showcaseUrl = (slug: string) => `https://${slug}.ai-webbuilder.com`;
```

- [ ] **Step 3: Write the gallery component**

`client/src/components/showcase-gallery.tsx` (gold-on-graphite, matches home chrome):
```tsx
import { SHOWCASE_SITES, showcaseUrl } from "@/lib/showcase";

export function ShowcaseGallery() {
  return (
    <section className="border-t border-gold/10 py-20">
      <div className="container mx-auto px-6">
        <div className="mb-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold/80">From a single prompt</p>
          <h2 className="mt-3 text-[clamp(1.6rem,3vw,2.3rem)] font-semibold tracking-tight text-parchment">
            Real sites, built and published live
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWCASE_SITES.map((s) => (
            <a
              key={s.slug}
              href={showcaseUrl(s.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="group overflow-hidden rounded-xl border border-gold/15 bg-graphite-soft transition-colors hover:border-gold/45"
            >
              <div className="aspect-[3/2] overflow-hidden bg-graphite">
                <img
                  src={s.thumb}
                  alt={`${s.name} — ${s.industry} site`}
                  loading="lazy"
                  className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-gold-dim">{s.industry}</p>
                  <p className="text-sm font-semibold text-parchment">{s.name}</p>
                </div>
                <span className="font-mono text-[0.65rem] text-gold/70 opacity-0 transition-opacity group-hover:opacity-100">
                  View live →
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Render it on the home page**

In `client/src/pages/home.tsx`, import and place `<ShowcaseGallery />` directly below the hero `</section>` (before the feature grid `<section>` at line ~104):
```tsx
import { ShowcaseGallery } from "@/components/showcase-gallery";
// ...inside the returned JSX, after the hero section:
        <ShowcaseGallery />
```

- [ ] **Step 5: Type-check + build**

Run: `npm run check && npm run build`
Expected: tsc clean, build clean (confirm the 6 images are copied into `dist/public/showcase/`).

- [ ] **Step 6: Commit**

```bash
git add client/public/showcase client/src/lib/showcase.ts client/src/components/showcase-gallery.tsx client/src/pages/home.tsx
git commit -m "feat: home-page showcase gallery (6 live, clickable example sites)"
```

---

## Task 8: Deploy, funnel walk, and merge decision

**Files:** none (verification + integration).

- [ ] **Step 1: Deploy**

Run: `railway up -s web -e production --ci`
Expected: "Deploy complete".

- [ ] **Step 2: Verify the gallery is live and links work**

Run:
```bash
curl -s https://ai-webbuilder.com/ | grep -o "showcase-[a-z]*\.jpg" | sort -u | head
```
Expected: the 6 thumbnail filenames appear. In a browser, confirm the gallery renders and each card opens its live site in a new tab.

- [ ] **Step 3: Cold-start funnel walk**

As an anonymous visitor (fresh browser profile / incognito), walk: land on home → see gallery → type a prompt → generate (anon trial) → reach the signup wall → create an account → generate again → hit the Pro paywall → start a Stripe **test-mode** checkout. Note every friction point (broken link, confusing CTA, ungraceful error, the at-capacity state). File each fix as a tiny follow-up commit on this branch.

- [ ] **Step 4: Update memory**

Append a one-paragraph note to `~/.claude/projects/-Users-crowelogic/memory/project_ai_webbuilder.md` recording: limiter shipped (env knobs + tuned `MAX_CONCURRENT`), showcase account + 6 published slugs, and that the gallery manifest is static in `client/src/lib/showcase.ts`.

- [ ] **Step 5: Merge decision (ask the user)**

Present the branch for integration via the `superpowers:finishing-a-development-branch` skill: options are (a) merge `feat/quality-rebrand` (PR #4) to main first, then this branch; (b) open a separate PR for `feat/launch-hardening`; (c) keep deploying via `railway up` and merge later. Let the user choose — do not merge unprompted.

---

## Self-Review notes

- **Spec coverage:** Workstream 1 → Tasks 1–5; Workstream 2 → Tasks 6–7 (+deploy in 8); Workstream 3 → Task 8. Quota-safety (spec §1) → Task 2 Step 3 placement + Task 5 Step 5 verify. Testing section → Tasks 1/2/3 unit tests + Task 5 live load test.
- **Types:** `AtCapacityError`, `makeLimiter`, `runLimited`, `makeCapacityPayload` (server) and `postWithCapacityRetry`, `ShowcaseSite`, `SHOWCASE_SITES`, `showcaseUrl`, `ShowcaseGallery` (client) are each defined once and referenced consistently.
- **Known caveat:** the in-process limiter caps per-process; if the web service is scaled to N replicas the effective cap is N×MAX_CONCURRENT (documented in `gen-limiter.ts`). Acceptable for a single-instance launch.
- **Disk caveat:** Task 7 deliberately avoids a Playwright install (disk near-full) by using a one-time hosted screenshot fetch committed as static files.
