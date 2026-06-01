import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";
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
