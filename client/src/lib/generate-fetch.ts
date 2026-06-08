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
