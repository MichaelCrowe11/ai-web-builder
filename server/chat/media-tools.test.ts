import { describe, it, expect, vi } from "vitest";
import { buildServiceTools } from "./media-tools";
import { ToolInputError } from "./site-tools";
import { fixtureDoc } from "./fixtures";

const deps = () => ({
  generateSiteImage: vi.fn(async (hint: string) => `data:image/jpeg;base64,FAKE-${hint}`),
  startVideo: vi.fn(async () => "vid-123"),
  rebuildDocument: vi.fn(async (prompt: string) => ({ ...fixtureDoc(), meta: { ...fixtureDoc().meta, name: `Rebuilt: ${prompt}` } })),
  onVideoStarted: vi.fn(),
  onUpsell: vi.fn(),
});

describe("buildServiceTools", () => {
  it("pro user gets all three defs; free user gets rebuild_site + suggest_upgrade", () => {
    const d = deps();
    expect(buildServiceTools(true, d).defs.map((t) => t.function.name).sort())
      .toEqual(["generate_image", "rebuild_site", "start_hero_video"]);
    expect(buildServiceTools(false, d).defs.map((t) => t.function.name).sort())
      .toEqual(["rebuild_site", "suggest_upgrade"]);
  });

  it("suggest_upgrade invokes onUpsell with the feature and does not mutate the doc", async () => {
    const d = deps();
    const tools = buildServiceTools(false, d);
    const out = await tools.run(fixtureDoc(), "suggest_upgrade", { feature: "photos" });
    expect(d.onUpsell).toHaveBeenCalledWith("photos");
    expect(out.mutated).toBe(false);
    expect((out.result as any).shown).toBe("upgrade card");
  });

  it("suggest_upgrade falls back to 'media' when feature arg is absent", async () => {
    const d = deps();
    const tools = buildServiceTools(false, d);
    await tools.run(fixtureDoc(), "suggest_upgrade", {});
    expect(d.onUpsell).toHaveBeenCalledWith("media");
  });

  it("generate_image attaches the image to the indexed section", async () => {
    const d = deps();
    const tools = buildServiceTools(true, d);
    const out = await tools.run(fixtureDoc(), "generate_image", { index: 1, hint: "baker at dawn" });
    expect((out.doc.sections[1] as any).image.url).toContain("FAKE-baker at dawn");
    expect(out.mutated).toBe(true);
  });

  it("generate_image rejects a section that has no image slot", async () => {
    const d = deps();
    const tools = buildServiceTools(true, d);
    // contact (index 2 in the fixture) has no image field in the schema
    await expect(tools.run(fixtureDoc(), "generate_image", { index: 2, hint: "x" })).rejects.toThrow(ToolInputError);
  });

  it("generate_image surfaces pipeline failure as a model-correctable error", async () => {
    const d = { ...deps(), generateSiteImage: vi.fn(async () => null) };
    const tools = buildServiceTools(true, d);
    await expect(tools.run(fixtureDoc(), "generate_image", { index: 0, hint: "x" })).rejects.toThrow(/could not be generated/);
  });

  it("start_hero_video starts the render, notifies, and does NOT mutate the doc", async () => {
    const d = deps();
    const tools = buildServiceTools(true, d);
    const out = await tools.run(fixtureDoc(), "start_hero_video", { prompt: "bakery at golden hour" });
    expect(d.startVideo).toHaveBeenCalled();
    expect(d.onVideoStarted).toHaveBeenCalledWith("vid-123");
    expect(out.mutated).toBe(false);
    expect((out.result as any).status).toBe("rendering");
  });

  it("rebuild_site replaces the whole document", async () => {
    const d = deps();
    const tools = buildServiceTools(false, d);
    const out = await tools.run(fixtureDoc(), "rebuild_site", { prompt: "a coffee truck in Tempe" });
    expect(out.doc.meta.name).toBe("Rebuilt: a coffee truck in Tempe");
    expect(out.mutated).toBe(true);
  });

  it("unknown service tool throws ToolInputError", async () => {
    const d = deps();
    await expect(buildServiceTools(true, d).run(fixtureDoc(), "explode", {})).rejects.toThrow(ToolInputError);
  });
});
