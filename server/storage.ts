import {
  type User,
  type InsertUser,
  type Project,
  type InsertProject,
  type ProjectVersion,
  type InsertProjectVersion,
  type ExperimentRow,
  type AgentClaimTokenRow,
  type ChatMessageRow,
  type InsertChatMessage,
  users,
  projects,
  siteDocuments,
  siteGoals,
  telemetryEvents,
  experiments,
  decisionLog,
  formSubmissions,
  siteMedia,
  agentClaimTokens,
  chatMessages,
  projectVersions,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import postgres from "postgres";
import type { SiteDocument } from "@shared/site-document";
import type { SiteGoal } from "@shared/site-goal";
import { experimentSchema, type Experiment } from "@shared/experiment";
import type { TelemetryEvent, VariantStat } from "@shared/telemetry";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserGenerations(id: string, count: number): Promise<void>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;

  // Project operations
  getProject(id: string): Promise<Project | undefined>;
  getProjectBySlug(slug: string): Promise<Project | undefined>;
  getProjectsByUser(userId: string): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;
  // Version-first publish: immutable saved deployment candidates.
  getProjectVersion(id: string): Promise<ProjectVersion | undefined>;
  getProjectVersionsByProject(projectId: string): Promise<ProjectVersion[]>;
  createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion>;

  // Living Sites — documents + versions
  saveDocumentVersion(projectId: string, document: SiteDocument): Promise<{ version: number }>;
  getLatestDocument(projectId: string): Promise<{ version: number; document: SiteDocument } | undefined>;
  listDocumentVersions(projectId: string): Promise<number[]>;
  restoreDocumentVersion(projectId: string, version: number): Promise<{ version: number }>;
  // Goals
  getGoal(projectId: string): Promise<SiteGoal | undefined>;
  setGoal(projectId: string, goal: SiteGoal): Promise<void>;
  // Telemetry
  insertTelemetry(events: TelemetryEvent[]): Promise<void>;
  recentTelemetry(siteId: string, limit?: number): Promise<TelemetryEvent[]>;
  // Experiments
  insertExperiment(exp: Experiment): Promise<void>;
  getExperiment(id: string): Promise<Experiment | undefined>;
  getRunningExperiment(siteId: string): Promise<Experiment | undefined>;
  getActionableExperiment(siteId: string): Promise<Experiment | undefined>;
  updateExperiment(id: string, patch: Partial<Pick<Experiment, "status" | "winnerVariantId">>): Promise<void>;
  variantStats(experimentId: string): Promise<VariantStat[]>;
  // Decision log
  appendDecision(siteId: string, kind: string, detail: unknown): Promise<void>;
  listDecisions(siteId: string, limit?: number): Promise<Array<{ ts: number; kind: string; detail: unknown }>>;
  // Growth scheduler
  projectsWithGoals(): Promise<string[]>;
  // Lead capture (form submissions)
  saveSubmission(projectId: string, data: unknown): Promise<void>;
  listSubmissions(projectId: string, limit?: number): Promise<Array<{ id: string; data: unknown; createdAt: Date | null }>>;
  // Durable media (generated video/image blobs)
  saveMedia(id: string, mime: string, data: Buffer): Promise<void>;
  getMedia(id: string): Promise<{ mime: string; data: Buffer } | undefined>;
  // Agent claim tokens
  createClaimToken(tokenHash: string, projectId: string): Promise<void>;
  getClaimTokenByHash(tokenHash: string): Promise<AgentClaimTokenRow | undefined>;
  getClaimTokenByProject(projectId: string): Promise<AgentClaimTokenRow | undefined>;
  claimToken(tokenHash: string, claimedBy: string): Promise<boolean>;
  // Conversational builder transcript
  addChatMessage(msg: InsertChatMessage): Promise<ChatMessageRow>;
  getChatMessages(projectId: string, limit?: number): Promise<ChatMessageRow[]>;
}

// In-memory storage for development/fallback
export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private projectsMap: Map<string, Project>;

  constructor() {
    this.users = new Map();
    this.projectsMap = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.stripeCustomerId === stripeCustomerId,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      id,
      email: insertUser.email || null,
      plan: "free",
      generationsUsed: 0,
      generationsResetAt: new Date(),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  async updateUserGenerations(id: string, count: number): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.generationsUsed = count;
      this.users.set(id, user);
    }
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.projectsMap.get(id);
  }

  async getProjectBySlug(slug: string): Promise<Project | undefined> {
    return Array.from(this.projectsMap.values()).find((p) => p.slug === slug);
  }

  async getProjectsByUser(userId: string): Promise<Project[]> {
    return Array.from(this.projectsMap.values()).filter(
      (project) => project.userId === userId,
    );
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const id = randomUUID();
    const project: Project = {
      id,
      userId: insertProject.userId || null,
      name: insertProject.name || "Untitled Project",
      html: insertProject.html,
      css: insertProject.css,
      prompt: insertProject.prompt || null,
      slug: null,
      isPublished: false,
      publishedUrl: null,
      publishedVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.projectsMap.set(id, project);
    return project;
  }

  async updateProject(id: string, data: Partial<Project>): Promise<Project | undefined> {
    const project = this.projectsMap.get(id);
    if (!project) return undefined;

    const updated = { ...project, ...data, updatedAt: new Date() };
    this.projectsMap.set(id, updated);
    return updated;
  }

  async deleteProject(id: string): Promise<boolean> {
    // Cascade: drop this project's saved versions so they don't dangle.
    this.projectVersionsMap.forEach((version, versionId) => {
      if (version.projectId === id) this.projectVersionsMap.delete(versionId);
    });
    return this.projectsMap.delete(id);
  }

  private projectVersionsMap: Map<string, ProjectVersion> = new Map();

  async getProjectVersion(id: string): Promise<ProjectVersion | undefined> {
    return this.projectVersionsMap.get(id);
  }

  async getProjectVersionsByProject(projectId: string): Promise<ProjectVersion[]> {
    return Array.from(this.projectVersionsMap.values())
      .filter((v) => v.projectId === projectId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async createProjectVersion(insertVersion: InsertProjectVersion): Promise<ProjectVersion> {
    const id = randomUUID();
    const version: ProjectVersion = {
      id,
      projectId: insertVersion.projectId,
      versionNumber: insertVersion.versionNumber,
      name: insertVersion.name,
      html: insertVersion.html,
      css: insertVersion.css,
      prompt: insertVersion.prompt ?? null,
      createdAt: new Date(),
    };
    this.projectVersionsMap.set(id, version);
    return version;
  }

  // Living Sites — in-memory implementations
  private docVersions: Map<string, Array<{ version: number; document: SiteDocument }>> = new Map();
  private goalsMap: Map<string, SiteGoal> = new Map();
  private telemetryRows: Array<TelemetryEvent & { experimentId?: string; variantId?: string }> = [];
  private experimentsMap: Map<string, Experiment> = new Map();
  private decisionRows: Array<{ siteId: string; ts: number; kind: string; detail: unknown }> = [];

  async saveDocumentVersion(projectId: string, document: SiteDocument): Promise<{ version: number }> {
    const versions = this.docVersions.get(projectId) ?? [];
    const version = (versions.reduce((m, r) => Math.max(m, r.version), 0)) + 1;
    versions.push({ version, document });
    this.docVersions.set(projectId, versions);
    return { version };
  }

  async getLatestDocument(projectId: string): Promise<{ version: number; document: SiteDocument } | undefined> {
    const versions = this.docVersions.get(projectId) ?? [];
    if (versions.length === 0) return undefined;
    return versions.reduce((a, b) => (b.version > a.version ? b : a));
  }

  async listDocumentVersions(projectId: string): Promise<number[]> {
    const versions = this.docVersions.get(projectId) ?? [];
    return [...versions.map((r) => r.version)].sort((a, b) => b - a);
  }

  async restoreDocumentVersion(projectId: string, version: number): Promise<{ version: number }> {
    const versions = this.docVersions.get(projectId) ?? [];
    const row = versions.find((r) => r.version === version);
    if (!row) throw new Error(`no version ${version} for project ${projectId}`);
    return this.saveDocumentVersion(projectId, row.document);
  }

  async getGoal(projectId: string): Promise<SiteGoal | undefined> {
    return this.goalsMap.get(projectId);
  }

  async setGoal(projectId: string, goal: SiteGoal): Promise<void> {
    this.goalsMap.set(projectId, goal);
  }

  async insertTelemetry(events: TelemetryEvent[]): Promise<void> {
    this.telemetryRows.push(...events);
  }

  async recentTelemetry(siteId: string, limit = 5000): Promise<TelemetryEvent[]> {
    return this.telemetryRows
      .filter((e) => e.siteId === siteId)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  async insertExperiment(exp: Experiment): Promise<void> {
    this.experimentsMap.set(exp.id, exp);
  }

  async getExperiment(id: string): Promise<Experiment | undefined> {
    return this.experimentsMap.get(id);
  }

  async getRunningExperiment(siteId: string): Promise<Experiment | undefined> {
    return Array.from(this.experimentsMap.values()).find(
      (e) => e.siteId === siteId && e.status === "running",
    );
  }

  async getActionableExperiment(siteId: string): Promise<Experiment | undefined> {
    const running = await this.getRunningExperiment(siteId);
    if (running) return running;
    // Return the most-recently inserted proposed experiment (highest insertion order).
    const proposed = Array.from(this.experimentsMap.values()).filter(
      (e) => e.siteId === siteId && e.status === "proposed",
    );
    return proposed.length > 0 ? proposed[proposed.length - 1] : undefined;
  }

  async updateExperiment(id: string, patch: Partial<Pick<Experiment, "status" | "winnerVariantId">>): Promise<void> {
    const exp = this.experimentsMap.get(id);
    if (exp) this.experimentsMap.set(id, { ...exp, ...patch });
  }

  async variantStats(experimentId: string): Promise<VariantStat[]> {
    const exp = await this.getExperiment(experimentId);
    const target = exp?.targetSectionId;
    const m = new Map<string, VariantStat>();
    for (const r of this.telemetryRows) {
      if (r.experimentId !== experimentId || !r.variantId) continue;
      const s = m.get(r.variantId) ?? { variantId: r.variantId, exposures: 0, conversions: 0 };
      if (r.type === "section_view" && r.sectionId === target) s.exposures++;
      if (r.type === "conversion") s.conversions++;
      m.set(r.variantId, s);
    }
    return Array.from(m.values());
  }

  async appendDecision(siteId: string, kind: string, detail: unknown): Promise<void> {
    this.decisionRows.push({ siteId, ts: Date.now(), kind, detail });
  }

  async listDecisions(siteId: string, limit = 50): Promise<Array<{ ts: number; kind: string; detail: unknown }>> {
    return this.decisionRows
      .filter((r) => r.siteId === siteId)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
      .map((r) => ({ ts: r.ts, kind: r.kind, detail: r.detail }));
  }

  async projectsWithGoals(): Promise<string[]> {
    return Array.from(this.goalsMap.keys());
  }

  private submissionsMap = new Map<string, Array<{ id: string; data: unknown; createdAt: Date }>>();
  async saveSubmission(projectId: string, data: unknown): Promise<void> {
    const arr = this.submissionsMap.get(projectId) ?? [];
    arr.unshift({ id: randomUUID(), data, createdAt: new Date() });
    this.submissionsMap.set(projectId, arr);
  }
  async listSubmissions(projectId: string, limit = 100): Promise<Array<{ id: string; data: unknown; createdAt: Date | null }>> {
    return (this.submissionsMap.get(projectId) ?? []).slice(0, limit);
  }

  private mediaMap = new Map<string, { mime: string; data: Buffer }>();
  async saveMedia(id: string, mime: string, data: Buffer): Promise<void> {
    this.mediaMap.set(id, { mime, data });
  }
  async getMedia(id: string): Promise<{ mime: string; data: Buffer } | undefined> {
    return this.mediaMap.get(id);
  }

  private claimTokens = new Map<string, { projectId: string; claimedBy: string | null; createdAt: Date; claimedAt: Date | null }>();

  async createClaimToken(tokenHash: string, projectId: string): Promise<void> {
    this.claimTokens.set(tokenHash, { projectId, claimedBy: null, createdAt: new Date(), claimedAt: null });
  }
  async getClaimTokenByHash(tokenHash: string): Promise<AgentClaimTokenRow | undefined> {
    const r = this.claimTokens.get(tokenHash);
    if (!r) return undefined;
    return { tokenHash, projectId: r.projectId, claimedBy: r.claimedBy, createdAt: r.createdAt, claimedAt: r.claimedAt } as AgentClaimTokenRow;
  }
  async getClaimTokenByProject(projectId: string): Promise<AgentClaimTokenRow | undefined> {
    const entry = Array.from(this.claimTokens.entries()).find(([, r]) => r.projectId === projectId);
    if (!entry) return undefined;
    const [tokenHash, r] = entry;
    return { tokenHash, projectId: r.projectId, claimedBy: r.claimedBy, createdAt: r.createdAt, claimedAt: r.claimedAt } as AgentClaimTokenRow;
  }
  async claimToken(tokenHash: string, claimedBy: string): Promise<boolean> {
    const r = this.claimTokens.get(tokenHash);
    if (!r || r.claimedBy) return false;
    r.claimedBy = claimedBy;
    r.claimedAt = new Date();
    return true;
  }

  private chatLog: ChatMessageRow[] = [];

  async addChatMessage(msg: InsertChatMessage): Promise<ChatMessageRow> {
    const row: ChatMessageRow = {
      id: `${this.chatLog.length + 1}`,
      createdAt: new Date(),
      ...msg,
    } as ChatMessageRow;
    this.chatLog.push(row);
    return row;
  }

  async getChatMessages(projectId: string, limit = 200): Promise<ChatMessageRow[]> {
    return this.chatLog.filter((m) => m.projectId === projectId).slice(-limit);
  }
}

// PostgreSQL storage implementation
export class PostgresStorage implements IStorage {
  private db: ReturnType<typeof drizzle>;

  constructor(connectionString: string) {
    // Cloud SQL (Cloud Run) connects over a unix socket. postgres-js only uses
    // socket mode for a STRING host starting with "/" and containing no ":"
    // (a colon means host:port; an array means TCP failover targets — both
    // wrong here). The real socket dir /cloudsql/PROJECT:REGION:INSTANCE is full
    // of colons, so the container entrypoint symlinks it to a colon-free path
    // and exposes that via DB_SOCKET_PATH. The URL then carries only creds + db.
    // On Railway/local DB_SOCKET_PATH is unset, so behavior is unchanged.
    const socketPath = process.env.DB_SOCKET_PATH;
    const client = socketPath
      ? postgres(connectionString, { host: socketPath })
      : postgres(connectionString);
    this.db = drizzle(client);
  }

  // Raw DDL execution for boot-time additive migrations (boot-migrations.ts).
  async execRaw(sqlText: string): Promise<void> {
    await this.db.execute(sql.raw(sqlText));
  }

  async getUser(id: string): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, stripeCustomerId));
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await this.db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async updateUserGenerations(id: string, count: number): Promise<void> {
    await this.db.update(users).set({ generationsUsed: count }).where(eq(users.id, id));
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const result = await this.db.update(users).set(data).where(eq(users.id, id)).returning();
    return result[0];
  }

  async getProject(id: string): Promise<Project | undefined> {
    const result = await this.db.select().from(projects).where(eq(projects.id, id));
    return result[0];
  }

  async getProjectBySlug(slug: string): Promise<Project | undefined> {
    const result = await this.db.select().from(projects).where(eq(projects.slug, slug));
    return result[0];
  }

  async getProjectsByUser(userId: string): Promise<Project[]> {
    return await this.db.select().from(projects).where(eq(projects.userId, userId));
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const result = await this.db.insert(projects).values(insertProject).returning();
    return result[0];
  }

  async updateProject(id: string, data: Partial<Project>): Promise<Project | undefined> {
    const result = await this.db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return result[0];
  }

  async deleteProject(id: string): Promise<boolean> {
    // Cascade saved versions first — the FK has no ON DELETE CASCADE.
    await this.db.delete(projectVersions).where(eq(projectVersions.projectId, id));
    const result = await this.db.delete(projects).where(eq(projects.id, id)).returning();
    return result.length > 0;
  }

  async getProjectVersion(id: string): Promise<ProjectVersion | undefined> {
    const result = await this.db.select().from(projectVersions).where(eq(projectVersions.id, id));
    return result[0];
  }

  async getProjectVersionsByProject(projectId: string): Promise<ProjectVersion[]> {
    return this.db
      .select()
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId))
      .orderBy(desc(projectVersions.versionNumber));
  }

  async createProjectVersion(insertVersion: InsertProjectVersion): Promise<ProjectVersion> {
    const result = await this.db.insert(projectVersions).values(insertVersion).returning();
    return result[0];
  }

  // Living Sites — documents + versions
  async saveDocumentVersion(projectId: string, document: SiteDocument): Promise<{ version: number }> {
    const rows = await this.db.select({ v: siteDocuments.version }).from(siteDocuments)
      .where(eq(siteDocuments.projectId, projectId));
    const version = (rows.reduce((m, r) => Math.max(m, r.v), 0)) + 1;
    await this.db.insert(siteDocuments).values({ projectId, version, document } as any);
    return { version };
  }

  async getLatestDocument(projectId: string): Promise<{ version: number; document: SiteDocument } | undefined> {
    const rows = await this.db.select().from(siteDocuments)
      .where(eq(siteDocuments.projectId, projectId)).orderBy(desc(siteDocuments.version)).limit(1);
    return rows[0] ? { version: rows[0].version, document: rows[0].document } : undefined;
  }

  async listDocumentVersions(projectId: string): Promise<number[]> {
    const rows = await this.db.select({ v: siteDocuments.version }).from(siteDocuments)
      .where(eq(siteDocuments.projectId, projectId)).orderBy(desc(siteDocuments.version));
    return rows.map((r) => r.v);
  }

  async restoreDocumentVersion(projectId: string, version: number): Promise<{ version: number }> {
    const rows = await this.db.select().from(siteDocuments)
      .where(and(eq(siteDocuments.projectId, projectId), eq(siteDocuments.version, version))).limit(1);
    if (!rows[0]) throw new Error(`no version ${version} for project ${projectId}`);
    return this.saveDocumentVersion(projectId, rows[0].document);
  }

  // Goals
  async getGoal(projectId: string): Promise<SiteGoal | undefined> {
    const rows = await this.db.select().from(siteGoals).where(eq(siteGoals.projectId, projectId)).limit(1);
    return rows[0]?.goal;
  }

  async setGoal(projectId: string, goal: SiteGoal): Promise<void> {
    await this.db.insert(siteGoals).values({ projectId, goal } as any)
      .onConflictDoUpdate({ target: siteGoals.projectId, set: { goal, updatedAt: new Date() } });
  }

  // Telemetry
  async insertTelemetry(events: TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.insert(telemetryEvents).values(events.map((e) => ({
      siteId: e.siteId, visitorId: e.visitorId, sessionId: e.sessionId, ts: e.ts, type: e.type,
      sectionId: e.sectionId, experimentId: e.experimentId, variantId: e.variantId, meta: e.meta,
    })) as any);
  }

  async recentTelemetry(siteId: string, limit = 5000): Promise<TelemetryEvent[]> {
    const rows = await this.db.select().from(telemetryEvents)
      .where(eq(telemetryEvents.siteId, siteId)).orderBy(desc(telemetryEvents.ts)).limit(limit);
    return rows.map((r) => ({
      siteId: r.siteId, visitorId: r.visitorId, sessionId: r.sessionId, ts: r.ts, type: r.type,
      sectionId: r.sectionId ?? undefined, experimentId: r.experimentId ?? undefined,
      variantId: r.variantId ?? undefined, meta: (r.meta as any) ?? undefined,
    }));
  }

  // Experiments
  async insertExperiment(exp: Experiment): Promise<void> {
    await this.db.insert(experiments).values({
      id: exp.id, siteId: exp.siteId, status: exp.status, targetSectionId: exp.targetSectionId,
      hypothesis: exp.hypothesis, conversionEvent: exp.conversionEvent, variants: exp.variants,
      createdBy: exp.createdBy, minExposuresPerVariant: exp.minExposuresPerVariant,
      winnerVariantId: exp.winnerVariantId,
      baselineConversionRate: exp.baselineConversionRate,
    } as any);
  }

  async getExperiment(id: string): Promise<Experiment | undefined> {
    const rows = await this.db.select().from(experiments).where(eq(experiments.id, id)).limit(1);
    return rows[0] ? rowToExperiment(rows[0]) : undefined;
  }

  async getRunningExperiment(siteId: string): Promise<Experiment | undefined> {
    const rows = await this.db.select().from(experiments)
      .where(and(eq(experiments.siteId, siteId), eq(experiments.status, "running"))).limit(1);
    return rows[0] ? rowToExperiment(rows[0]) : undefined;
  }

  async getActionableExperiment(siteId: string): Promise<Experiment | undefined> {
    const running = await this.getRunningExperiment(siteId);
    if (running) return running;
    const rows = await this.db.select().from(experiments)
      .where(and(eq(experiments.siteId, siteId), eq(experiments.status, "proposed")))
      .orderBy(desc(experiments.id))
      .limit(1);
    return rows[0] ? rowToExperiment(rows[0]) : undefined;
  }

  async updateExperiment(id: string, patch: Partial<Pick<Experiment, "status" | "winnerVariantId">>): Promise<void> {
    await this.db.update(experiments).set(patch).where(eq(experiments.id, id));
  }

  async variantStats(experimentId: string): Promise<VariantStat[]> {
    const exp = await this.getExperiment(experimentId);
    const target = exp?.targetSectionId;
    const rows = await this.db.select().from(telemetryEvents).where(eq(telemetryEvents.experimentId, experimentId));
    const m = new Map<string, VariantStat>();
    for (const r of rows) {
      if (!r.variantId) continue;
      const s = m.get(r.variantId) ?? { variantId: r.variantId, exposures: 0, conversions: 0 };
      if (r.type === "section_view" && r.sectionId === target) s.exposures++;
      if (r.type === "conversion") s.conversions++;
      m.set(r.variantId, s);
    }
    return Array.from(m.values());
  }

  // Decision log
  async appendDecision(siteId: string, kind: string, detail: unknown): Promise<void> {
    await this.db.insert(decisionLog).values({ siteId, ts: Date.now(), kind, detail } as any);
  }

  async listDecisions(siteId: string, limit = 50): Promise<Array<{ ts: number; kind: string; detail: unknown }>> {
    const rows = await this.db.select().from(decisionLog)
      .where(eq(decisionLog.siteId, siteId)).orderBy(desc(decisionLog.ts)).limit(limit);
    return rows.map((r) => ({ ts: r.ts, kind: r.kind, detail: r.detail }));
  }

  async projectsWithGoals(): Promise<string[]> {
    const rows = await this.db.select({ id: siteGoals.projectId }).from(siteGoals);
    return rows.map((r) => r.id);
  }

  async saveSubmission(projectId: string, data: unknown): Promise<void> {
    await this.db.insert(formSubmissions).values({ projectId, data } as any);
  }
  async listSubmissions(projectId: string, limit = 100): Promise<Array<{ id: string; data: unknown; createdAt: Date | null }>> {
    const rows = await this.db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.projectId, projectId))
      .orderBy(desc(formSubmissions.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, data: r.data, createdAt: r.createdAt }));
  }

  async saveMedia(id: string, mime: string, data: Buffer): Promise<void> {
    await this.db.insert(siteMedia).values({ id, mime, data }).onConflictDoNothing();
  }
  async getMedia(id: string): Promise<{ mime: string; data: Buffer } | undefined> {
    const rows = await this.db.select().from(siteMedia).where(eq(siteMedia.id, id)).limit(1);
    return rows[0] ? { mime: rows[0].mime, data: rows[0].data } : undefined;
  }

  async createClaimToken(tokenHash: string, projectId: string): Promise<void> {
    await this.db.insert(agentClaimTokens).values({ tokenHash, projectId });
  }
  async getClaimTokenByHash(tokenHash: string): Promise<AgentClaimTokenRow | undefined> {
    const r = await this.db.select().from(agentClaimTokens).where(eq(agentClaimTokens.tokenHash, tokenHash)).limit(1);
    return r[0];
  }
  async getClaimTokenByProject(projectId: string): Promise<AgentClaimTokenRow | undefined> {
    const r = await this.db.select().from(agentClaimTokens).where(eq(agentClaimTokens.projectId, projectId)).limit(1);
    return r[0];
  }
  async claimToken(tokenHash: string, claimedBy: string): Promise<boolean> {
    const r = await this.db.update(agentClaimTokens)
      .set({ claimedBy, claimedAt: new Date() })
      .where(and(eq(agentClaimTokens.tokenHash, tokenHash), isNull(agentClaimTokens.claimedBy)))
      .returning();
    return r.length > 0;
  }

  async addChatMessage(msg: InsertChatMessage): Promise<ChatMessageRow> {
    const [row] = await this.db.insert(chatMessages).values(msg).returning();
    return row;
  }

  // Last N messages (the transcript tail), returned oldest-first for replay.
  async getChatMessages(projectId: string, limit = 200): Promise<ChatMessageRow[]> {
    const rows = await this.db.select().from(chatMessages)
      .where(eq(chatMessages.projectId, projectId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
    return rows.reverse();
  }
}

function rowToExperiment(r: ExperimentRow): Experiment {
  return experimentSchema.parse({
    id: r.id, siteId: r.siteId, status: r.status, targetSectionId: r.targetSectionId,
    hypothesis: r.hypothesis, conversionEvent: r.conversionEvent, variants: r.variants,
    createdBy: r.createdBy, minExposuresPerVariant: r.minExposuresPerVariant,
    winnerVariantId: r.winnerVariantId ?? undefined,
    baselineConversionRate: r.baselineConversionRate ?? undefined,
  });
}

// Create storage instance based on environment
function createStorage(): IStorage {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log("Using PostgreSQL storage");
    return new PostgresStorage(dbUrl);
  }
  console.log("Using in-memory storage (no DATABASE_URL)");
  return new MemStorage();
}

export const storage = createStorage();
