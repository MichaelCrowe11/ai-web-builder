import { storage } from "./storage";
import { runGrowthCycle, evaluateAndMaybePromote } from "./growth-agent";

const INTERVAL_MS = Number(process.env.GROWTH_INTERVAL_MS ?? 15 * 60 * 1000);

/** Run one tick across all sites that have a goal. Safe to call repeatedly; one experiment/site is enforced by the governor + DB index. */
export async function growthTick(): Promise<void> {
  const projectIds = await storage.projectsWithGoals();
  for (const pid of projectIds) {
    try {
      await evaluateAndMaybePromote(pid); // conclude/promote first
      await runGrowthCycle(pid);          // then maybe launch the next
    } catch (e) {
      console.error(`[growth] tick failed for ${pid}:`, (e as Error).message);
    }
  }
}

export function startGrowthScheduler(): void {
  if (process.env.GROWTH_AGENT_ENABLED !== "1") return;
  console.log(`[growth] scheduler enabled, every ${INTERVAL_MS}ms`);
  setInterval(() => { void growthTick(); }, INTERVAL_MS);
}
