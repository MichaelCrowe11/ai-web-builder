import type { SiteDocument, Section } from "./site-document";

/** Stable identity for a section: its array index plus its discriminated type. */
export function sectionKey(doc: SiteDocument, index: number): string {
  return `${index}:${doc.sections[index].type}`;
}

/** Resolve a section key back to its array index, or -1 if it no longer matches. */
export function findSectionIndex(doc: SiteDocument, key: string): number {
  const [idxRaw, type] = key.split(":");
  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 0 || idx >= doc.sections.length) return -1;
  return doc.sections[idx].type === type ? idx : -1;
}

/** Return a new document with the keyed section replaced. Never mutates the input. */
export function patchSection(doc: SiteDocument, key: string, replacement: Section): SiteDocument {
  const idx = findSectionIndex(doc, key);
  if (idx === -1) throw new Error(`patchSection: no section for key "${key}"`);
  const sections = doc.sections.slice();
  sections[idx] = replacement;
  return { ...doc, sections };
}
