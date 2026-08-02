import { describe, it, expect } from "vitest";
import { nextFlash } from "./section-flash";

describe("nextFlash", () => {
  it("starts a flash when a section-addressed tool starts", () => {
    expect(nextFlash("tool_start", { name: "edit_section", label: "Editing Our story", target: "1:about" }))
      .toEqual({ target: "1:about", label: "Editing Our story" });
  });

  it("clears the flash when a non-section tool starts", () => {
    expect(nextFlash("tool_start", { name: "set_theme", label: "Restyling: warm-bakery" })).toBeNull();
  });

  it("keeps the flash through tool_result — sync tools finish in microseconds, so the flash lives until the turn moves on", () => {
    expect(nextFlash("tool_result", { name: "edit_section", ok: true, detail: "Editing Our story" })).toBeUndefined();
  });

  it("clears the flash when the turn ends", () => {
    expect(nextFlash("turn_done", { reply: "Done." })).toBeNull();
  });

  it("leaves the flash untouched for unrelated events", () => {
    expect(nextFlash("doc_updated", { document: {}, html: "", css: "" })).toBeUndefined();
    expect(nextFlash("upsell", { feature: "photo" })).toBeUndefined();
  });
});
