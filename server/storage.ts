import {
  type User,
  type InsertUser,
  type Project,
  type InsertProject,
  type ProjectVersion,
  type InsertProjectVersion,
  users,
  projects,
  projectVersions,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { desc, eq, sql } from "drizzle-orm";
import postgres from "postgres";

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

  // Version operations
  getProjectVersion(id: string): Promise<ProjectVersion | undefined>;
  getProjectVersionsByProject(projectId: string): Promise<ProjectVersion[]>;
  createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion>;
}

// In-memory storage for development/fallback
export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private projectsMap: Map<string, Project>;
  private projectVersionsMap: Map<string, ProjectVersion>;

  constructor() {
    this.users = new Map();
    this.projectsMap = new Map();
    this.projectVersionsMap = new Map();
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
    const deleted = this.projectsMap.delete(id);
    if (deleted) {
      this.projectVersionsMap.forEach((version, versionId) => {
        if (version.projectId === id) this.projectVersionsMap.delete(versionId);
      });
    }
    return deleted;
  }

  async getProjectVersion(id: string): Promise<ProjectVersion | undefined> {
    return this.projectVersionsMap.get(id);
  }

  async getProjectVersionsByProject(projectId: string): Promise<ProjectVersion[]> {
    return Array.from(this.projectVersionsMap.values())
      .filter((version) => version.projectId === projectId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async createProjectVersion(insertVersion: InsertProjectVersion): Promise<ProjectVersion> {
    const id = randomUUID();
    const version: ProjectVersion = {
      ...insertVersion,
      id,
      prompt: insertVersion.prompt || null,
      createdAt: new Date(),
    };
    this.projectVersionsMap.set(id, version);
    return version;
  }
}

// PostgreSQL storage implementation
export class PostgresStorage implements IStorage {
  private db: ReturnType<typeof drizzle>;

  constructor(connectionString: string) {
    const client = postgres(connectionString);
    this.db = drizzle(client);
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
    const result = await this.db.delete(projects).where(eq(projects.id, id)).returning();
    return result.length > 0;
  }

  async getProjectVersion(id: string): Promise<ProjectVersion | undefined> {
    const result = await this.db.select().from(projectVersions).where(eq(projectVersions.id, id));
    return result[0];
  }

  async getProjectVersionsByProject(projectId: string): Promise<ProjectVersion[]> {
    return await this.db
      .select()
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId))
      .orderBy(desc(projectVersions.versionNumber));
  }

  async createProjectVersion(insertVersion: InsertProjectVersion): Promise<ProjectVersion> {
    const result = await this.db.insert(projectVersions).values(insertVersion).returning();
    return result[0];
  }

  // Raw additive DDL for boot-time schema self-healing.
  async execRaw(sqlText: string): Promise<void> {
    await this.db.execute(sql.raw(sqlText));
  }
}

// Which backend is live. Exposed via /api/health so the client can warn users
// when the app is running in throwaway in-memory mode.
export const storageMode: "postgres" | "memory" = process.env.DATABASE_URL
  ? "postgres"
  : "memory";

// Create storage instance based on environment.
//
// In-memory storage loses every account, saved site, and login on restart. That
// is fine for local dev but catastrophic in production — it makes a real app
// feel like a throwaway demo. So in production we REFUSE to boot without a
// database, unless explicitly overridden with ALLOW_MEMORY_STORAGE=1.
function createStorage(): IStorage {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log("Using PostgreSQL storage");
    return new PostgresStorage(dbUrl);
  }

  const inProd = process.env.NODE_ENV === "production";
  const allowMemory = process.env.ALLOW_MEMORY_STORAGE === "1";
  if (inProd && !allowMemory) {
    throw new Error(
      "FATAL: DATABASE_URL is not set in production. Refusing to boot with " +
        "in-memory storage — accounts, saved sites, and logins would be wiped " +
        "on every restart. Provision a Postgres database and set DATABASE_URL " +
        "(or set ALLOW_MEMORY_STORAGE=1 to override intentionally).",
    );
  }

  console.warn(
    inProd
      ? "⚠  In-memory storage in PRODUCTION (ALLOW_MEMORY_STORAGE=1). Data resets on restart."
      : "⚠  Using in-memory storage (no DATABASE_URL). Data resets on restart — fine for local dev.",
  );
  return new MemStorage();
}

export const storage = createStorage();
