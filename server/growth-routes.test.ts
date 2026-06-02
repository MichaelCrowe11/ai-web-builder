import { describe, it, expect } from "vitest";
import express from "express";
import session from "express-session";
import { registerGrowthRoutes } from "./growth-routes";

// Build a test app with session middleware (no user logged in unless opts.userId set).
function makeApp(opts: { userId?: string } = {}) {
  const app = express();
  app.use(express.json());
  // Minimal session middleware — memory store, no DB needed.
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    }),
  );
  // Optionally seed a userId into the session for ownership tests.
  if (opts.userId) {
    app.use((req, _res, next) => {
      req.session.userId = opts.userId;
      next();
    });
  }
  registerGrowthRoutes(app);
  return app;
}

async function call(
  app: express.Express,
  method: "get" | "post" | "put",
  path: string,
  body?: unknown,
) {
  const http = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: method.toUpperCase(),
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  server.close();
  return { status: res.status, text };
}

// ── /api/t stays public (no auth) ──────────────────────────────────────────
describe("POST /api/t", () => {
  it("400s an invalid batch WITHOUT requiring authentication", async () => {
    // No session middleware, no userId — proving the route is public.
    const app = express();
    app.use(express.json());
    registerGrowthRoutes(app);
    const r = await call(app, "post", "/api/t", []); // empty batch invalid
    expect(r.status).toBe(400);
  });
});

// ── Protected routes require auth ─────────────────────────────────────────
describe("GET /api/sites/:projectId/growth (auth guard)", () => {
  it("returns 401 when not authenticated", async () => {
    const app = makeApp(); // no userId in session
    const r = await call(app, "get", "/api/sites/some-project-id/growth");
    expect(r.status).toBe(401);
  });
});

describe("PUT /api/sites/:projectId/goal (auth guard)", () => {
  it("returns 401 when not authenticated", async () => {
    const app = makeApp();
    const r = await call(app, "put", "/api/sites/some-project-id/goal", {
      metric: "conversion",
      autonomy: "suggest",
    });
    expect(r.status).toBe(401);
  });
});

describe("POST /api/sites/:projectId/experiments/:id/:action (auth guard)", () => {
  it("returns 401 when not authenticated", async () => {
    const app = makeApp();
    const r = await call(app, "post", "/api/sites/some-project-id/experiments/exp-1/approve");
    expect(r.status).toBe(401);
  });
});

describe("POST /api/sites/:projectId/rollback/:version (auth guard)", () => {
  it("returns 401 when not authenticated", async () => {
    const app = makeApp();
    const r = await call(app, "post", "/api/sites/some-project-id/rollback/1");
    expect(r.status).toBe(401);
  });
});
