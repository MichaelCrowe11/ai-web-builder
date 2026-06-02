import { describe, it, expect } from "vitest";
import express from "express";
import { registerGrowthRoutes } from "./growth-routes";

async function call(app: express.Express, method: "get" | "post", path: string, body?: unknown) {
  const http = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: method.toUpperCase(),
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  server.close();
  return { status: res.status, text };
}

describe("POST /api/t", () => {
  it("400s an invalid batch", async () => {
    const app = express(); app.use(express.json()); registerGrowthRoutes(app);
    const r = await call(app, "post", "/api/t", []); // empty batch invalid
    expect(r.status).toBe(400);
  });
});
