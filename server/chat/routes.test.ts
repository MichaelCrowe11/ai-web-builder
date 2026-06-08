import { describe, it, expect } from "vitest";
import { sseFrame, canAccessProject } from "./routes";

describe("sseFrame", () => {
  it("formats an event + JSON data frame", () => {
    expect(sseFrame("tool_start", { name: "edit_section" }))
      .toBe(`event: tool_start\ndata: {"name":"edit_section"}\n\n`);
  });
});

describe("canAccessProject", () => {
  it("allows the owner", () => {
    expect(canAccessProject({ userId: "u1" } as any, "u1")).toBe(true);
  });
  it("allows anonymous access to unowned projects", () => {
    expect(canAccessProject({ userId: null } as any, undefined)).toBe(true);
  });
  it("denies a different user", () => {
    expect(canAccessProject({ userId: "u1" } as any, "u2")).toBe(false);
  });
});
