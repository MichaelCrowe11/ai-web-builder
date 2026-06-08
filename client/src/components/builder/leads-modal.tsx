import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Inbox, Loader2, Download } from "lucide-react";

interface Submission {
  id: string;
  data: Record<string, any>;
  createdAt: string | null;
}

export function LeadsModal({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string | null;
}) {
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !projectId) return;
    setSubs(null);
    setErr("");
    fetch(`/api/projects/${projectId}/submissions`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setSubs(d.submissions ?? []))
      .catch(() => setErr("Could not load leads."));
  }, [open, projectId]);

  const exportCsv = () => {
    if (!subs?.length) return;
    const cols = Array.from(new Set(subs.flatMap((s) => Object.keys(s.data))));
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["date", ...cols].map(esc).join(","),
      ...subs.map((s) => [s.createdAt ?? "", ...cols.map((c) => s.data[c])].map(esc).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-gold/20 bg-graphite-soft text-parchment">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-parchment">
            <Inbox className="h-5 w-5 text-gold" /> Leads
          </DialogTitle>
          <DialogDescription className="text-parchment/55">
            Contact and booking form submissions from your published site.
          </DialogDescription>
        </DialogHeader>

        {!projectId ? (
          <p className="py-6 text-parchment-dim">Save your site first to start collecting leads.</p>
        ) : err ? (
          <p className="py-6 text-error">{err}</p>
        ) : subs === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
          </div>
        ) : subs.length === 0 ? (
          <p className="py-6 text-parchment-dim">
            No leads yet. When a visitor submits your contact form, it shows up here.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-gold-dim">
                {subs.length} submission{subs.length === 1 ? "" : "s"}
              </span>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
            <div className="max-h-[55vh] space-y-2 overflow-auto">
              {subs.map((s) => (
                <div key={s.id} className="rounded-lg border border-gold/15 bg-graphite p-3 text-sm">
                  <div className="mb-1.5 font-mono text-[0.62rem] text-gold-dim">
                    {s.createdAt ? new Date(s.createdAt).toLocaleString() : ""}
                  </div>
                  {Object.entries(s.data).map(([k, v]) => (
                    <div key={k} className="leading-relaxed">
                      <span className="text-parchment-dim">{k}: </span>
                      <span className="text-parchment">{String(v)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
