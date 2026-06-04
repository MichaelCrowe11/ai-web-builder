-- Agent-native ai-webbuilder: one-time claim tokens binding an agent-built
-- (initially unowned) site to a principal later. Additive only — never run
-- drizzle-kit push against this DB (it would offer to DROP user_sessions).
CREATE TABLE IF NOT EXISTS agent_claim_tokens (
  token_hash  varchar(64) PRIMARY KEY,
  project_id  varchar(36) NOT NULL REFERENCES projects(id),
  claimed_by  varchar(255),
  created_at  timestamp DEFAULT now(),
  claimed_at  timestamp
);
CREATE INDEX IF NOT EXISTS agent_claim_tokens_project_idx ON agent_claim_tokens (project_id);
