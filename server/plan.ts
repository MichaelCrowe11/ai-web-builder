// Plan-derived limits and the shape we expose for a user to the client.
// The daily generation limit comes from the plan, not a stored column.
import { FREE_DAILY_LIMIT, type User } from "@shared/schema";

// Number of generations allowed per day for a plan. null = unlimited.
export function dailyLimitForPlan(plan: string): number | null {
  return plan === "pro" ? null : FREE_DAILY_LIMIT;
}

// Safe, client-facing view of a user (never leaks password hash or stripe IDs).
export function publicUser(user: User) {
  const limit = dailyLimitForPlan(user.plan);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    plan: user.plan,
    generationsUsed: user.generationsUsed,
    generationsLimit: limit, // null means unlimited
  };
}
