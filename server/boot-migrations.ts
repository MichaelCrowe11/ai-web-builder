// Boot-time additive migrations for schema that must ship with product code.
// These are intentionally narrow and idempotent: no destructive DDL belongs here.

import { PostgresStorage } from "./storage";

const STATEMENTS = [
  `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS published_version_id varchar(36)`,
  `CREATE TABLE IF NOT EXISTS project_versions (
     id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
     project_id varchar(36) NOT NULL REFERENCES projects(id),
     version_number integer NOT NULL,
     name text NOT NULL,
     html text NOT NULL,
     css text NOT NULL,
     prompt text,
     created_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS project_versions_project_idx
     ON project_versions(project_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS project_versions_project_number_idx
     ON project_versions(project_id, version_number)`,
];

export async function runBootMigrations(
  storage: PostgresStorage,
  log: (message: string) => void,
): Promise<boolean> {
  for (const statement of STATEMENTS) {
    try {
      await storage.execRaw(statement);
    } catch (error: any) {
      log(`boot migrations: FAILED ${error.message}`);
      return false;
    }
  }
  log("boot migrations: schema up to date");
  return true;
}
