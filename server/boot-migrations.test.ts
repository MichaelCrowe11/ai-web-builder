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

  it("every statement is idempotent-guarded and strictly additive", () => {
    for (const m of ADDITIVE_MIGRATIONS) {
      for (const s of m.statements) {
        // Idempotent: re-running a boot is a no-op.
        expect(s).toMatch(/IF NOT EXISTS/i);
        // Never destructive — these run unattended on every boot.
        expect(s).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/i);
        // ALTER is allowed ONLY as an additive ADD COLUMN ... IF NOT EXISTS
        // (no type changes, renames, or drops that could lose data).
        if (/\bALTER\b/i.test(s)) {
          expect(s).toMatch(/ALTER TABLE[\s\S]+ADD COLUMN IF NOT EXISTS/i);
          expect(s).not.toMatch(/\b(DROP COLUMN|ALTER COLUMN|RENAME|SET DATA TYPE|USING)\b/i);
        }
      }
    }
  });

  it("registers both the chat_messages and project_versions migrations", () => {
    const sql = ADDITIVE_MIGRATIONS.flatMap((m) => m.statements).join("\n");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_messages/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS project_versions/i);
    expect(sql).toMatch(/ALTER TABLE projects[\s\S]+ADD COLUMN IF NOT EXISTS published_version_id/i);
  });

  it("logs loud and returns false on failure without throwing (site must still boot)", async () => {
    const log = vi.fn();
    const ok = await runBootMigrations(async () => { throw new Error("permission denied"); }, log);
    expect(ok).toBe(false);
    expect(log.mock.calls.flat().join(" ")).toMatch(/MIGRATION FAILED/);
    expect(log.mock.calls.flat().join(" ")).toMatch(/permission denied/);
  });
});
