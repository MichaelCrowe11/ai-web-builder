import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, bigint, index, uniqueIndex, doublePrecision, customType } from "drizzle-orm/pg-core";

// Raw bytes column (for durable media: generated video/image blobs).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table
export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  // Plan: "free" (5 generations/day) or "pro" (unlimited, $29.99/mo)
  plan: text("plan").notNull().default("free"),
  generationsUsed: integer("generations_used").notNull().default(0),
  // Quota window: when the daily counter was last reset
  generationsResetAt: timestamp("generations_reset_at").defaultNow(),
  // Stripe linkage (set after first checkout)
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Daily free-tier generation allowance
export const FREE_DAILY_LIMIT = 5;
// Anonymous (no account) trial allowance per IP per day
export const ANON_DAILY_LIMIT = 3;

// Projects table
export const projects = pgTable("projects", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 36 }).references(() => users.id),
  name: text("name").notNull().default("Untitled Project"),
  html: text("html").notNull(),
  css: text("css").notNull(),
  prompt: text("prompt"),
  // Publishing: slug is the subdomain/path segment (e.g. <slug>.ai-webbuilder.com)
  slug: text("slug").unique(),
  isPublished: boolean("is_published").notNull().default(false),
  publishedUrl: text("published_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projects).pick({
  userId: true,
  name: true,
  html: true,
  css: true,
  prompt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

import type { SiteDocument } from "./site-document";
import type { SiteGoal } from "./site-goal";
import type { Variant } from "./experiment";
import type { TelemetryEventType } from "./telemetry";

export const siteDocuments = pgTable("site_documents", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id", { length: 36 }).notNull().references(() => projects.id),
  version: integer("version").notNull(),
  document: jsonb("document").$type<SiteDocument>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  projectVersionUq: uniqueIndex("site_documents_project_version_uq").on(t.projectId, t.version),
}));
export type SiteDocumentRow = typeof siteDocuments.$inferSelect;

export const siteGoals = pgTable("site_goals", {
  projectId: varchar("project_id", { length: 36 }).primaryKey().references(() => projects.id),
  goal: jsonb("goal").$type<SiteGoal>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type SiteGoalRow = typeof siteGoals.$inferSelect;

export const telemetryEvents = pgTable("telemetry_events", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id", { length: 36 }).notNull(),
  visitorId: text("visitor_id").notNull(),
  sessionId: text("session_id").notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  type: text("type").$type<TelemetryEventType>().notNull(),
  sectionId: text("section_id"),
  experimentId: varchar("experiment_id", { length: 36 }),
  variantId: text("variant_id"),
  meta: jsonb("meta"),
}, (t) => ({
  bySiteTs: index("telemetry_site_ts_idx").on(t.siteId, t.ts),
  byExpVariant: index("telemetry_exp_variant_idx").on(t.experimentId, t.variantId),
}));
export type TelemetryEventRow = typeof telemetryEvents.$inferSelect;

export const experiments = pgTable("experiments", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id", { length: 36 }).notNull(),
  status: text("status").notNull(),
  targetSectionId: text("target_section_id").notNull(),
  hypothesis: text("hypothesis").notNull().default(""),
  conversionEvent: text("conversion_event").notNull(),
  variants: jsonb("variants").$type<Variant[]>().notNull(),
  createdBy: text("created_by").notNull(),
  minExposuresPerVariant: integer("min_exposures_per_variant").notNull().default(200),
  winnerVariantId: text("winner_variant_id"),
  baselineConversionRate: doublePrecision("baseline_conversion_rate"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  oneRunningPerSite: uniqueIndex("experiments_one_running_per_site")
    .on(t.siteId)
    .where(sql`status = 'running'`),
}));
export type ExperimentRow = typeof experiments.$inferSelect;

export const decisionLog = pgTable("decision_log", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id", { length: 36 }).notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  detail: jsonb("detail"),
}, (t) => ({
  bySite: index("decision_log_site_idx").on(t.siteId, t.ts),
}));
export type DecisionLogRow = typeof decisionLog.$inferSelect;

// Lead capture: a published site's form submissions land here, viewable by the owner.
export const formSubmissions = pgTable("form_submissions", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  byProject: index("form_submissions_project_idx").on(t.projectId, t.createdAt),
}));
export type FormSubmissionRow = typeof formSubmissions.$inferSelect;

// Durable media: generated video (and large image) blobs, served from /api/video/:id
// so published sites never lose them when the upstream (Azure) copy expires.
export const siteMedia = pgTable("site_media", {
  id: varchar("id", { length: 80 }).primaryKey(),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type SiteMediaRow = typeof siteMedia.$inferSelect;

// One-time claim tokens binding an agent-built site to a principal.
export const agentClaimTokens = pgTable("agent_claim_tokens", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  projectId: varchar("project_id", { length: 36 }).notNull().references(() => projects.id),
  claimedBy: varchar("claimed_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  claimedAt: timestamp("claimed_at"),
}, (t) => ({
  byProject: index("agent_claim_tokens_project_idx").on(t.projectId),
}));
export type AgentClaimTokenRow = typeof agentClaimTokens.$inferSelect;

// Conversational builder transcript. tool_events records the agent's actions
// for replay in the panel; doc_version links a mutating turn to the
// site_documents version it produced (the undo target).
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id", { length: 36 }).notNull().references(() => projects.id),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  toolEvents: jsonb("tool_events").$type<Array<{ name: string; ok: boolean; detail: string }> | null>(),
  docVersion: integer("doc_version"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  byProject: index("chat_messages_project_idx").on(t.projectId, t.createdAt),
}));
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type InsertChatMessage = Omit<ChatMessageRow, "id" | "createdAt">;

// Product acquisition funnel: append-only log of the stages a person moves
// through from anonymous trial to paying Pro. Aggregated by shared/funnel.ts
// and read at /api/admin/funnel. Never references users(id) so a hard user
// delete can't orphan-fail an insert; anonId is a salted IP hash, not a PII.
export const productEvents = pgTable("product_events", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  ts: bigint("ts", { mode: "number" }).notNull(),
  event: text("event").notNull(),
  userId: varchar("user_id", { length: 36 }),
  anonId: text("anon_id"),
  meta: jsonb("meta"),
}, (t) => ({
  byEventTs: index("product_events_event_ts_idx").on(t.event, t.ts),
}));
export type ProductEventRow = typeof productEvents.$inferSelect;
