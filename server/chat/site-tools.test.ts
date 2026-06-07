import { describe, it, expect } from "vitest";
import { applyTool, compactOutline, ToolInputError, TOOL_DEFS, MUTATING_TOOLS } from "./site-tools";
import { fixtureDoc } from "./fixtures";

describe("compactOutline", () => {
  it("lists sections with index, type, layout and a human label", () => {
    const out = compactOutline(fixtureDoc());
    expect(out.meta.name).toBe("Brava Bakery");
    expect(out.sections[0]).toEqual({ index: 0, type: "hero", layout: "centered", label: "Bread worth crossing town for." });
    expect(out.sections[1].label).toBe("Our story");
  });
});

describe("applyTool", () => {
  it("read_site returns the outline without mutating", () => {
    const doc = fixtureDoc();
    const { result, mutated } = applyTool(doc, "read_site", {});
    expect((result as any).sections).toHaveLength(3);
    expect(mutated).toBe(false);
  });

  it("read_section returns the full section JSON", () => {
    const { result, mutated } = applyTool(fixtureDoc(), "read_section", { index: 1 });
    expect((result as any).type).toBe("about");
    expect(mutated).toBe(false);
  });

  it("edit_section merges a patch and revalidates", () => {
    const { doc, mutated } = applyTool(fixtureDoc(), "edit_section", {
      index: 0, patch: { headline: "Five words. Better bread." },
    });
    expect((doc.sections[0] as any).headline).toBe("Five words. Better bread.");
    expect(mutated).toBe(true);
  });

  it("edit_section rejects a patch that breaks the schema", () => {
    expect(() => applyTool(fixtureDoc(), "edit_section", { index: 0, patch: { cta: "not an object" } }))
      .toThrow(ToolInputError);
  });

  it("rejects an out-of-range index", () => {
    expect(() => applyTool(fixtureDoc(), "read_section", { index: 9 })).toThrow(ToolInputError);
  });

  it("add_section inserts after the given index and revalidates", () => {
    const { doc } = applyTool(fixtureDoc(), "add_section", {
      after: 1,
      section: {
        type: "testimonials", layout: "cards", title: "What people say",
        items: [{ quote: "Best sourdough in Phoenix.", author: "Maria", role: "Regular" }],
      },
    });
    expect(doc.sections).toHaveLength(4);
    expect((doc.sections[2] as any).type).toBe("testimonials");
  });

  it("remove_section deletes by index", () => {
    const { doc } = applyTool(fixtureDoc(), "remove_section", { index: 1 });
    expect(doc.sections).toHaveLength(2);
    expect((doc.sections[1] as any).type).toBe("contact");
  });

  it("move_section reorders", () => {
    const { doc } = applyTool(fixtureDoc(), "move_section", { from: 1, to: 2 });
    expect((doc.sections[1] as any).type).toBe("contact");
    expect((doc.sections[2] as any).type).toBe("about");
  });

  it("set_theme changes preset and revalidates", () => {
    const { doc } = applyTool(fixtureDoc(), "set_theme", { preset: "nocturne-luxe" });
    expect(doc.theme.preset).toBe("nocturne-luxe");
  });

  it("set_meta updates name/tagline", () => {
    const { doc } = applyTool(fixtureDoc(), "set_meta", { tagline: "Phoenix's slow-fermented bakery" });
    expect(doc.meta.tagline).toBe("Phoenix's slow-fermented bakery");
  });

  it("unknown tool throws ToolInputError", () => {
    expect(() => applyTool(fixtureDoc(), "explode", {})).toThrow(ToolInputError);
  });
});

describe("TOOL_DEFS", () => {
  it("defines all eight tools and flags the mutating ones", () => {
    const names = TOOL_DEFS.map((t) => t.function.name).sort();
    expect(names).toEqual(["add_section", "edit_section", "move_section", "read_section", "read_site", "remove_section", "set_meta", "set_theme"]);
    expect(MUTATING_TOOLS.has("edit_section")).toBe(true);
    expect(MUTATING_TOOLS.has("read_site")).toBe(false);
  });
});
