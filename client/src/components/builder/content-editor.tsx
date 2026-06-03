import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pencil, Loader2, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";

// No-code content editor (CMS): edit a generated site's text directly, no AI.
// Works on a deep-cloned copy; "Save" hands the updated document back to the builder.

type AnyDoc = any;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

const inputCls =
  "w-full rounded-md border border-gold/15 bg-graphite px-2.5 py-1.5 text-sm text-parchment outline-none transition-colors focus:border-gold/45 placeholder:text-parchment/30";
const labelCls = "block text-[0.62rem] uppercase tracking-[0.16em] text-gold-dim mb-1";

export function ContentEditor({
  open,
  onOpenChange,
  doc,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: AnyDoc | null;
  onSave: (updated: AnyDoc) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<AnyDoc | null>(null);

  useEffect(() => {
    if (open && doc) setDraft(clone(doc));
  }, [open, doc]);

  if (!draft) return null;

  const setMeta = (k: string, v: string) => setDraft((d: AnyDoc) => ({ ...d, meta: { ...d.meta, [k]: v } }));
  const setField = (i: number, k: string, v: string) =>
    setDraft((d: AnyDoc) => {
      const sections = d.sections.map((s: AnyDoc, idx: number) => (idx === i ? { ...s, [k]: v } : s));
      return { ...d, sections };
    });
  const setItem = (si: number, ii: number, k: string, v: string) =>
    setDraft((d: AnyDoc) => {
      const sections = d.sections.map((s: AnyDoc, idx: number) => {
        if (idx !== si) return s;
        const items = (s.items ?? []).map((it: AnyDoc, j: number) => (j === ii ? { ...it, [k]: v } : it));
        return { ...s, items };
      });
      return { ...d, sections };
    });

  // --- Collections: owner-managed list items (add / remove / reorder) ---
  // A section's items[] IS its collection. The renderer already maps over it and
  // the document saves through the existing PUT route, so this is purely client-side.
  const blankItemFor = (type: string): AnyDoc => {
    switch (type) {
      case "menu":
      case "products":
        return { name: "", description: "", price: "" };
      case "testimonials":
        return { quote: "", author: "" };
      case "services":
      default:
        return { name: "", description: "" };
    }
  };
  const COLLECTION_TYPES = ["services", "menu", "products", "testimonials"];
  const isCollection = (s: AnyDoc) => Array.isArray(s.items) || COLLECTION_TYPES.includes(s.type);

  const mutSection = (si: number, fn: (s: AnyDoc) => AnyDoc) =>
    setDraft((d: AnyDoc) => ({ ...d, sections: d.sections.map((s: AnyDoc, idx: number) => (idx === si ? fn(s) : s)) }));
  const addItem = (si: number) =>
    mutSection(si, (s) => ({ ...s, items: [...(s.items ?? []), blankItemFor(s.type)] }));
  const removeItem = (si: number, ii: number) =>
    mutSection(si, (s) => ({ ...s, items: (s.items ?? []).filter((_: AnyDoc, j: number) => j !== ii) }));
  const moveItem = (si: number, ii: number, dir: number) =>
    mutSection(si, (s) => {
      const items = [...(s.items ?? [])];
      const j = ii + dir;
      if (j < 0 || j >= items.length) return s;
      [items[ii], items[j]] = [items[j], items[ii]];
      return { ...s, items };
    });

  const Text = ({ label, value, onChange, area }: { label: string; value: any; onChange: (v: string) => void; area?: boolean }) => (
    <div>
      <label className={labelCls}>{label}</label>
      {area ? (
        <textarea className={inputCls} rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-gold/20 bg-graphite-soft text-parchment">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-parchment">
            <Pencil className="h-5 w-5 text-gold" /> Edit content
          </DialogTitle>
          <DialogDescription className="text-parchment/55">
            Edit your text and manage list items — add, remove, reorder. No regeneration, no AI.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-auto pr-1">
          <div className="rounded-lg border border-gold/15 bg-graphite p-3">
            <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-gold-dim">Business</p>
            <div className="grid grid-cols-2 gap-3">
              <Text label="Name" value={draft.meta?.name} onChange={(v) => setMeta("name", v)} />
              <Text label="Tagline" value={draft.meta?.tagline} onChange={(v) => setMeta("tagline", v)} />
            </div>
          </div>

          {draft.sections.map((s: AnyDoc, i: number) => (
            <div key={i} className="rounded-lg border border-gold/15 bg-graphite p-3">
              <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-gold-dim">{s.type}</p>
              <div className="space-y-3">
                {"headline" in s && <Text label="Headline" value={s.headline} onChange={(v) => setField(i, "headline", v)} />}
                {"subheadline" in s && <Text label="Subheadline" value={s.subheadline} onChange={(v) => setField(i, "subheadline", v)} area />}
                {"title" in s && <Text label="Title" value={s.title} onChange={(v) => setField(i, "title", v)} />}
                {"body" in s && <Text label="Body" value={s.body} onChange={(v) => setField(i, "body", v)} area />}
                {s.cta && <Text label="Button label" value={s.cta.label} onChange={(v) => setDraft((d: AnyDoc) => { const sections = d.sections.map((x: AnyDoc, idx: number) => idx === i ? { ...x, cta: { ...x.cta, label: v } } : x); return { ...d, sections }; })} />}
                {s.type === "contact" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Text label="Email" value={s.email} onChange={(v) => setField(i, "email", v)} />
                    <Text label="Phone" value={s.phone} onChange={(v) => setField(i, "phone", v)} />
                    <Text label="Address" value={s.address} onChange={(v) => setField(i, "address", v)} />
                    <Text label="Hours" value={s.hours} onChange={(v) => setField(i, "hours", v)} />
                  </div>
                )}
                {isCollection(s) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-gold-dim">
                        Items{Array.isArray(s.items) ? ` · ${s.items.length}` : ""}
                      </span>
                    </div>
                    {(s.items ?? []).map((it: AnyDoc, ii: number) => (
                      <div key={ii} className="flex items-start gap-2 rounded-md border border-gold/10 p-2">
                        <div className="grid flex-1 grid-cols-12 gap-2">
                          {"name" in it && <input className={`${inputCls} col-span-4`} value={it.name ?? ""} placeholder="name" onChange={(e) => setItem(i, ii, "name", e.target.value)} />}
                          {"quote" in it && <input className={`${inputCls} col-span-7`} value={it.quote ?? ""} placeholder="quote" onChange={(e) => setItem(i, ii, "quote", e.target.value)} />}
                          {"author" in it && <input className={`${inputCls} col-span-3`} value={it.author ?? ""} placeholder="author" onChange={(e) => setItem(i, ii, "author", e.target.value)} />}
                          {"description" in it && <input className={`${inputCls} col-span-6`} value={it.description ?? ""} placeholder="description" onChange={(e) => setItem(i, ii, "description", e.target.value)} />}
                          {"price" in it && <input className={`${inputCls} col-span-2`} value={it.price ?? ""} placeholder="price" onChange={(e) => setItem(i, ii, "price", e.target.value)} />}
                        </div>
                        <div className="flex flex-col gap-0.5 pt-0.5">
                          <button type="button" title="Move up" disabled={ii === 0} onClick={() => moveItem(i, ii, -1)} className="rounded p-0.5 text-parchment/45 transition-colors hover:text-gold disabled:opacity-25 disabled:hover:text-parchment/45">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" title="Move down" disabled={ii === (s.items?.length ?? 0) - 1} onClick={() => moveItem(i, ii, 1)} className="rounded p-0.5 text-parchment/45 transition-colors hover:text-gold disabled:opacity-25 disabled:hover:text-parchment/45">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" title="Delete item" onClick={() => removeItem(i, ii)} className="rounded p-0.5 text-parchment/45 transition-colors hover:text-error">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => addItem(i)} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gold/25 py-1.5 text-xs font-medium text-gold-dim transition-colors hover:border-gold/50 hover:text-gold">
                      <Plus className="h-3.5 w-3.5" /> Add item
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="gap-2 bg-gold font-semibold text-graphite hover:bg-gold" disabled={saving} onClick={() => onSave(draft)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
