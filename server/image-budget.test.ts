import { describe, it, expect, beforeEach } from "vitest";
import { claimImageJob, imagesForPlan, resetImageBudget } from "./image-budget";

describe("image budget", () => {
  beforeEach(() => resetImageBudget());

  it("gives the hero to free and anonymous, and more to Pro", () => {
    expect(imagesForPlan("anonymous")).toBe(1);
    expect(imagesForPlan("free")).toBe(1);
    expect(imagesForPlan("pro")).toBe(3);
  });

  it("lets an anonymous caller through three times, then stops", () => {
    for (let i = 0; i < 3; i++) {
      expect(claimImageJob("ip-a", "anonymous").ok).toBe(true);
    }
    expect(claimImageJob("ip-a", "anonymous")).toEqual({ ok: false, images: 0, remaining: 0 });
  });

  it("counts subjects separately, so one caller cannot spend another's day", () => {
    for (let i = 0; i < 3; i++) claimImageJob("ip-a", "anonymous");
    expect(claimImageJob("ip-b", "anonymous").ok).toBe(true);
  });

  it("counts plans separately, so upgrading is not blocked by the free day", () => {
    for (let i = 0; i < 5; i++) claimImageJob("u7", "free");
    expect(claimImageJob("u7", "free").ok).toBe(false);
    expect(claimImageJob("u7", "pro").ok).toBe(true);
  });

  it("rolls over after a day", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) claimImageJob("ip-a", "anonymous", t0);
    expect(claimImageJob("ip-a", "anonymous", t0).ok).toBe(false);
    const nextDay = t0 + 24 * 60 * 60 * 1000 + 1;
    expect(claimImageJob("ip-a", "anonymous", nextDay).ok).toBe(true);
  });

  it("reports what is left, so a caller can stop asking", () => {
    expect(claimImageJob("ip-c", "anonymous").remaining).toBe(2);
    expect(claimImageJob("ip-c", "anonymous").remaining).toBe(1);
    expect(claimImageJob("ip-c", "anonymous").remaining).toBe(0);
  });
});
