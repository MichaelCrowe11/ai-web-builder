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
