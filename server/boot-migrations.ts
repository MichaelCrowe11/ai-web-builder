// Boot-time self-healing for ADDITIVE schema migrations.
//
// Why this exists: script/chat-migration.sql sat in the repo while five
// production deploys shipped code that needed the table — every chat turn
// 500'd with `relation "chat_messages" does not exist` until it was applied
// by hand (2026-06-07). Human-gated migration steps fail exactly like this,
// so the additive ones run idempotently at every boot.
//
// Rules for entries here:
// - IF NOT EXISTS guards only; never DROP/ALTER/TRUNCATE/DELETE (enforced by
//   test). Destructive changes stay manual — see the user_sessions gotcha in
//   script/agent-migration.sql.
// - Keep statements in sync with the canonical script/*.sql files (those
//   remain the hand-apply path for non-Cloud-Run environments).

export const ADDITIVE_MIGRATIONS: Array<{ name: string; statements: string[] }> = [
  {
    name: "chat-messages (conversational builder transcript)",
    statements: [
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id  varchar(36) NOT NULL REFERENCES projects(id),
        role        text NOT NULL,
        content     text NOT NULL,
        tool_events jsonb,
        doc_version integer,
        created_at  timestamp DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS chat_messages_project_idx ON chat_messages(project_id, created_at)`,
    ],
  },
];

/**
 * Run all additive migrations. Failure is LOUD in logs but never throws —
 * a DDL hiccup degrades the affected feature, it must not take the site down
 * (the rest of the app works without these tables).
 */
export async function runBootMigrations(
  exec: (sqlText: string) => Promise<unknown>,
  log: (message: string) => void,
): Promise<boolean> {
  for (const migration of ADDITIVE_MIGRATIONS) {
    for (const statement of migration.statements) {
      try {
        await exec(statement);
      } catch (e: any) {
        log(`BOOT MIGRATION FAILED [${migration.name}]: ${e?.message ?? e} — feature degraded, apply script/*.sql by hand`);
        return false;
      }
    }
  }
  return true;
}
