// Daily budget for generated photography.
//
// Images are the expensive half of a build: one is a measured ~50s on Azure and
// several hundred KB inline, where the whole text document is a couple of
// seconds. They used to be Pro-only for that reason, which meant every free and
// anonymous build, that is to say every build a prospective customer ever sees,
// shipped grey gradient placeholders. The demo sold against the product.
//
// So images are on for everyone now, and this is the thing that keeps that from
// being a blank cheque. It is deliberately NOT the generation quota: a build
// that already spent its quota unit must still be able to finish fetching its
// own images, so exhausting one cannot exhaust the other. The budgets track the
// daily build limits one for one, which is what stops a caller from replaying
// /api/generate/images against a document it already has.
//
// In memory, like the anonymous generation counter, and resets on restart. That
// is the same trade already accepted there: a restart hands out a few extra
// images, and the alternative is a table write on a path that has to stay cheap.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Image JOBS per day (a job may produce several images, see imagesForPlan). */
const JOBS_PER_DAY: Record<string, number> = {
  anonymous: 3,
  free: 5,
  pro: 60,
};

/** Images per job. The hero is the one a visitor decides on; Pro gets the rest. */
export function imagesForPlan(plan: string): number {
  return plan === "pro" ? 3 : 1;
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface BudgetResult {
  ok: boolean;
  images: number;
  remaining: number;
}

/**
 * Claim one image job for `subject` under `plan`. Returns ok:false when the
 * day's jobs are spent, in which case the caller should return the document
 * untouched rather than erroring: the site is already usable with gradients.
 */
export function claimImageJob(subject: string, plan: string, now = Date.now()): BudgetResult {
  const limit = JOBS_PER_DAY[plan] ?? JOBS_PER_DAY.anonymous;
  const key = `${plan}:${subject}`;
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + DAY_MS };
    buckets.set(key, b);
  }
  if (b.count >= limit) return { ok: false, images: 0, remaining: 0 };
  b.count += 1;
  return { ok: true, images: imagesForPlan(plan), remaining: limit - b.count };
}

/** Test seam. */
export function resetImageBudget(): void {
  buckets.clear();
}
