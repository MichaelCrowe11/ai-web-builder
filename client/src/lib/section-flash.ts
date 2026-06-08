// Derives the preview's "section being touched" flash from chat SSE events.
// The server tags tool_start with a section key (matching the renderer's
// data-section-key) for section-addressed tools; everything that ends or
// supersedes that tool clears the flash.

export interface SectionFlash {
  target: string; // section key, e.g. "1:about"
  label: string; // panel label, e.g. "Editing Our story"
}

/**
 * Next flash state for an SSE event:
 * - a SectionFlash → flash this section now
 * - null → clear any active flash
 * - undefined → event doesn't affect the flash
 */
export function nextFlash(event: string, data: any): SectionFlash | null | undefined {
  if (event === "tool_start") {
    return typeof data?.target === "string"
      ? { target: data.target, label: typeof data?.label === "string" ? data.label : "" }
      : null; // a non-section tool is running; any previous flash is stale
  }
  // tool_result does NOT clear: sync doc tools finish in microseconds, so the
  // flash holds the turn's attention until the next tool retargets it or the
  // turn ends (turn_done / the stream's finally in the panel).
  if (event === "turn_done") return null;
  return undefined;
}
