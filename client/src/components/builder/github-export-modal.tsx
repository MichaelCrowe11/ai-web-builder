import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Github, Loader2, ExternalLink, Check, Lock } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  html: string;
  css: string;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "my-site";

export function GitHubExportModal({ open, onOpenChange, name, html, css }: Props) {
  const [token, setToken] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRepoName(slug(name));
      setError(null);
      setRepoUrl(null);
    }
  }, [open, name]);

  const push = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/projects/export/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), repoName: repoName.trim(), isPrivate, name, html, css }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Export failed");
      setRepoUrl(d.repoUrl);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const input =
    "w-full rounded-lg border border-gold/20 bg-graphite px-3 py-2.5 text-sm text-parchment outline-none transition-colors placeholder:text-parchment/35 focus:border-gold/50";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-gold/20 bg-graphite-soft text-parchment">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-parchment">
            <Github className="h-5 w-5 text-gold" /> Export to GitHub
          </DialogTitle>
          <DialogDescription className="text-parchment/55">
            Push this site to a new repository as a ready-to-deploy <span className="font-mono text-parchment/70">index.html</span>.
          </DialogDescription>
        </DialogHeader>

        {repoUrl ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-gold/25 bg-gold/[0.06] px-4 py-3 text-sm text-gold">
              <Check className="h-4 w-4" /> Pushed to GitHub.
            </div>
            <a href={repoUrl} target="_blank" rel="noreferrer">
              <Button className="w-full gap-2 bg-gold font-semibold text-graphite hover:bg-gold">
                Open repository <ExternalLink className="h-4 w-4" />
              </Button>
            </a>
            <button onClick={() => onOpenChange(false)} className="w-full text-xs text-parchment/50 hover:text-parchment/80">
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/55">
                Repository name
              </label>
              <input className={input} value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="my-site" />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/55">
                GitHub access token
              </label>
              <input
                className={input}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
              />
              <p className="mt-1.5 text-[0.7rem] leading-relaxed text-parchment/45">
                Used once to create the repo, never stored.{" "}
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=AI%20Web%20Builder"
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold/80 underline hover:text-gold"
                >
                  Create a token
                </a>{" "}
                with the <span className="font-mono">repo</span> scope.
              </p>
            </div>

            <button
              onClick={() => setIsPrivate((p) => !p)}
              className="flex items-center gap-2 text-sm text-parchment/70 hover:text-parchment"
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${isPrivate ? "border-gold bg-gold/20" : "border-gold/30"}`}>
                {isPrivate && <Check className="h-3 w-3 text-gold" />}
              </span>
              <Lock className="h-3.5 w-3.5" /> Private repository
            </button>

            {error && <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}

            <Button
              onClick={push}
              disabled={loading || !token.trim() || !repoName.trim()}
              className="w-full gap-2 bg-gold font-semibold text-graphite hover:bg-gold disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
              {loading ? "Pushing…" : "Create repo & push"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
