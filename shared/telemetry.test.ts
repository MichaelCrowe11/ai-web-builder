import { describe, it, expect } from "vitest";
import { telemetryEventSchema, telemetryBatchSchema } from "@shared/telemetry";

const base = { siteId: "s1", visitorId: "v1", sessionId: "se1", ts: 1717000000000 };

describe("telemetryEventSchema", () => {
  it("accepts a valid conversion event with experiment tags", () => {
    const e = telemetryEventSchema.parse({ ...base, type: "conversion", experimentId: "e1", variantId: "var1" });
    expect(e.type).toBe("conversion");
  });

  it("rejects an unknown event type", () => {
    expect(() => telemetryEventSchema.parse({ ...base, type: "rage_click" })).toThrow();
  });

  it("batch schema caps the array and rejects empty", () => {
    expect(() => telemetryBatchSchema.parse([])).toThrow();
    const big = Array.from({ length: 51 }, () => ({ ...base, type: "pageview" as const }));
    expect(() => telemetryBatchSchema.parse(big)).toThrow();
  });
});
