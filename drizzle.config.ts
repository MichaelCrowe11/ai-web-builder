import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from a developer machine / CI, where the Railway *internal*
// host (postgres.railway.internal) isn't reachable. Prefer the public proxy URL
// when present. The deployed app does NOT use this file — it reads DATABASE_URL
// (the internal host) directly in storage.ts.
const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url },
});
