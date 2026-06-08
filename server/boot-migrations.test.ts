import { describe, it, expect, vi } from "vitest";
import { ADDITIVE_MIGRATIONS, runBootMigrations } from "./boot-migrations";

describe("runBootMigrations", () => {
  it("executes every statement in order and reports success", async () => {
    const ran: string[] = [];
    const ok = await runBootMigrations(async (s) => { ran.push(s); }, () => {});
    expect(ok).toBe(true);
    expect(ran).toEqual(ADDITIVE_MIGRATIONS.flatMap((m) => m.statements));
    expect(ran.length).toBeGreaterThan(0);
  });

  it("every statement is idempotent-guarded and additive (no DROP/ALTER)", () => {
    for (const m of ADDITIVE_MIGRATIONS) {
      for (const s of m.statements) {
        expect(s).toMatch(/IF NOT EXISTS/i);
        expect(s).not.toMatch(/\b(DROP|ALTER|TRUNCATE|DELETE)\b/i);
      }
    }
  });

  it("logs loud and returns false on failure without throwing (site must still boot)", async () => {
    const log = vi.fn();
    const ok = await runBootMigrations(async () => { throw new Error("permission denied"); }, log);
    expect(ok).toBe(false);
    expect(log.mock.calls.flat().join(" ")).toMatch(/MIGRATION FAILED/);
    expect(log.mock.calls.flat().join(" ")).toMatch(/permission denied/);
  });
});
