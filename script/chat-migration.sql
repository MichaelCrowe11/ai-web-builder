-- Conversational builder transcript. Additive only — NEVER run drizzle-kit
-- push against this DB (it offers to DROP user_sessions; see agent-migration.sql).
CREATE TABLE IF NOT EXISTS chat_messages (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  varchar(36) NOT NULL REFERENCES projects(id),
  role        text NOT NULL,
  content     text NOT NULL,
  tool_events jsonb,
  doc_version integer,
  created_at  timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_project_idx ON chat_messages(project_id, created_at);
