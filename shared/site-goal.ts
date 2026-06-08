import { z } from "zod";

export const objectiveEnum = z.enum([
  "sell_product", "book_call", "capture_lead", "newsletter_signup", "custom",
]);
export type Objective = z.infer<typeof objectiveEnum>;

export const autonomyEnum = z.enum(["suggest", "auto"]);
export type Autonomy = z.infer<typeof autonomyEnum>;

export const constraintsSchema = z.object({
  lockedSectionIds: z.array(z.string()).default([]),
  lockedCopy: z.boolean().default(true),
  brandVoice: z.string().optional(),
  autonomy: autonomyEnum.default("suggest"),
  minExposuresPerVariant: z.number().int().positive().default(200),
});
export type Constraints = z.infer<typeof constraintsSchema>;

export const siteGoalSchema = z.object({
  objective: objectiveEnum,
  conversionEvent: z.string().min(1),
  description: z.string().optional(),
  constraints: constraintsSchema,
});
export type SiteGoal = z.infer<typeof siteGoalSchema>;

export function defaultConstraints(): Constraints {
  return constraintsSchema.parse({ lockedSectionIds: [] });
}
