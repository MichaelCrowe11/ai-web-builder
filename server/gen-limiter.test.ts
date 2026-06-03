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
