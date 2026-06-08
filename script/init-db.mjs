// One-off, idempotent provisioning of the app tables (users, projects) to match
// shared/schema.ts. Deliberately does NOT touch user_sessions (managed by
// connect-pg-simple). Run via: railway run --service Postgres node script/init-db.mjs
import pg from "pg";

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_PUBLIC_URL / DATABASE_URL in env");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password text NOT NULL,
  email text,
  plan text NOT NULL DEFAULT 'free',
  generations_used integer NOT NULL DEFAULT 0,
  generations_reset_at timestamp DEFAULT now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(36) REFERENCES users(id),
  name text NOT NULL DEFAULT 'Untitled Project',
  html text NOT NULL,
  css text NOT NULL,
  prompt text,
  slug text UNIQUE,
  is_published boolean NOT NULL DEFAULT false,
  published_url text,
  published_version_id varchar(36),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS published_version_id varchar(36);

CREATE TABLE IF NOT EXISTS project_versions (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id varchar(36) NOT NULL REFERENCES projects(id),
  version_number integer NOT NULL,
  name text NOT NULL,
  html text NOT NULL,
  css text NOT NULL,
  prompt text,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_versions_project_idx
  ON project_versions(project_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS project_versions_project_number_idx
  ON project_versions(project_id, version_number);
`;

try {
  await client.connect();
  await client.query(DDL);
  const r = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
  );
  console.log("OK. public tables:", r.rows.map((x) => x.table_name).join(", "));
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
