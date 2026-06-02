import type { Express, Request, Response } from "express";
import { ingest } from "./telemetry";
import { storage } from "./storage";
import { siteGoalSchema } from "@shared/site-goal";

export function registerGrowthRoutes(app: Express) {
  // First-party telemetry beacon sink.
  app.post("/api/t", async (req: Request, res: Response) => {
    try {
      const n = await ingest(req.body);
      res.status(204).end();
      void n;
    } catch {
      res.status(400).json({ error: "invalid telemetry batch" });
    }
  });

  // Mission Control: read the live state for a site.
  app.get("/api/sites/:projectId/growth", async (req, res) => {
    const { projectId } = req.params;
    const [goal, exp, decisions] = await Promise.all([
      storage.getGoal(projectId),
      storage.getRunningExperiment(projectId),
      storage.listDecisions(projectId, 50),
    ]);
    const stats = exp ? await storage.variantStats(exp.id) : [];
    res.json({ goal: goal ?? null, experiment: exp ?? null, stats, decisions });
  });

  // Set / update the goal.
  app.put("/api/sites/:projectId/goal", async (req, res) => {
    const parsed = siteGoalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    await storage.setGoal(req.params.projectId, parsed.data);
    res.json({ ok: true });
  });

  // Approve a proposed experiment -> running. Reject -> rejected.
  app.post("/api/sites/:projectId/experiments/:id/:action", async (req, res) => {
    const { id, action } = req.params;
    const exp = await storage.getExperiment(id);
    if (!exp) return res.status(404).json({ error: "not found" });
    if (action === "approve") await storage.updateExperiment(id, { status: "running" });
    else if (action === "reject") await storage.updateExperiment(id, { status: "rejected" });
    else return res.status(400).json({ error: "unknown action" });
    res.json({ ok: true });
  });

  // Rollback to a prior document version.
  app.post("/api/sites/:projectId/rollback/:version", async (req, res) => {
    const v = Number(req.params.version);
    if (!Number.isInteger(v)) return res.status(400).json({ error: "bad version" });
    const { version } = await storage.restoreDocumentVersion(req.params.projectId, v);
    await storage.appendDecision(req.params.projectId, "owner_rollback", { toVersion: v, newVersion: version });
    res.json({ ok: true, version });
  });
}
