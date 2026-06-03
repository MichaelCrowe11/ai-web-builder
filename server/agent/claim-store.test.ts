import { describe, it, expect, beforeEach } from "vitest";
import { MemStorage } from "../storage";

describe("claim-token storage (Mem)", () => {
  let s: MemStorage;
  beforeEach(() => { s = new MemStorage(); });

  it("creates, reads by hash and by project, and claims a token", async () => {
    const project = await s.createProject({ userId: null, name: "Agent Site", html: "<h1/>", css: "", prompt: "p" } as any);
    await s.createClaimToken("hash123", project.id);

    const byHash = await s.getClaimTokenByHash("hash123");
    expect(byHash?.projectId).toBe(project.id);
    expect(byHash?.claimedBy).toBeFalsy();

    const byProject = await s.getClaimTokenByProject(project.id);
    expect(byProject?.tokenHash).toBe("hash123");

    const ok = await s.claimToken("hash123", "crowe-id:michael");
    expect(ok).toBe(true);
    const after = await s.getClaimTokenByHash("hash123");
    expect(after?.claimedBy).toBe("crowe-id:michael");
  });

  it("rejects a second claim", async () => {
    const project = await s.createProject({ userId: null, name: "X", html: "<h1/>", css: "", prompt: "p" } as any);
    await s.createClaimToken("h", project.id);
    expect(await s.claimToken("h", "a")).toBe(true);
    expect(await s.claimToken("h", "b")).toBe(false);
  });

  it("getClaimTokenByHash returns undefined for unknown hash", async () => {
    expect(await s.getClaimTokenByHash("nope")).toBeUndefined();
  });
});
