import { useEffect, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, Plus, Pencil, ExternalLink, Trash2, Loader2, Globe, FileWarning,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  slug: string | null;
  isPublished: boolean;
  publishedUrl: string | null;
  updatedAt: string;
  prompt: string | null;
}

// "My sites" — lists the signed-in user's saved projects, the surface that was
// missing entirely (Save wrote to a void with nowhere to see the result).
export default function Projects() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/users/${user.id}/projects`, { credentials: "include" });
      const data = await res.json();
      // Newest first.
      const sorted = (Array.isArray(data) ? data : []).sort(
        (a: Project, b: Project) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
      );
      setProjects(sorted);
    } catch {
      toast({ title: "Couldn't load your sites", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) load();
    else if (!authLoading) setLoading(false);
  }, [user, authLoading, load]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this site? This can't be undone.")) return;
    setDeletingId(id);
    try {
      await apiRequest("DELETE", `/api/projects/${id}`);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast({ title: "Deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  // Not signed in.
  if (!authLoading && !user) {
    return (
      <Shell>
        <div className="mx-auto mt-24 max-w-md text-center">
          <FileWarning className="mx-auto mb-4 h-10 w-10 text-[#bfa669]" />
          <h1 className="font-heading text-2xl">Sign in to see your sites</h1>
          <p className="mt-2 text-[rgba(232,226,207,0.6)]">
            Your saved sites live in your account. Head to the builder to sign in or create one.
          </p>
          <Link href="/builder">
            <Button className="mt-6 rounded-full bg-[#e8e2cf] px-6 font-semibold text-[#0b0b0c] hover:bg-[#d4be84]">
              Go to the builder
            </Button>
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-heading text-3xl">Your sites</h1>
            <p className="mt-1 text-sm text-[rgba(232,226,207,0.6)]">
              {projects.length} saved {projects.length === 1 ? "site" : "sites"}
            </p>
          </div>
          <Link href="/builder">
            <Button className="gap-1.5 rounded-full bg-[#e8e2cf] px-5 font-semibold text-[#0b0b0c] hover:bg-[#d4be84]">
              <Plus className="h-4 w-4" /> New site
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-[#bfa669]" />
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[rgba(191,166,105,0.3)] py-20 text-center">
            <Globe className="mx-auto mb-4 h-10 w-10 text-[rgba(191,166,105,0.5)]" />
            <p className="text-[rgba(232,226,207,0.7)]">No sites yet.</p>
            <Link href="/builder">
              <Button variant="ghost" className="mt-3 text-[#bfa669]">
                Build your first one →
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex flex-col rounded-2xl border border-[rgba(191,166,105,0.18)] bg-[#15151a] p-5 transition-colors hover:border-[rgba(191,166,105,0.4)]"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="font-heading text-lg leading-snug">{p.name}</h3>
                  {p.isPublished && (
                    <span className="shrink-0 rounded-full bg-[rgba(191,166,105,0.15)] px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[#bfa669]">
                      Live
                    </span>
                  )}
                </div>
                {p.prompt && (
                  <p className="mb-4 line-clamp-2 text-xs text-[rgba(232,226,207,0.5)]">{p.prompt}</p>
                )}
                <div className="mt-auto flex items-center gap-1.5 pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 text-[rgba(232,226,207,0.85)]"
                    onClick={() => navigate(`/builder?project=${p.id}`)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Open
                  </Button>
                  {p.isPublished && p.slug && (
                    <a href={`/s/${p.slug}`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-[#bfa669]">
                        <ExternalLink className="h-3.5 w-3.5" /> Visit
                      </Button>
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-8 w-8 p-0 text-[rgba(232,226,207,0.4)] hover:text-red-400"
                    onClick={() => handleDelete(p.id)}
                    disabled={deletingId === p.id}
                  >
                    {deletingId === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

// Minimal on-brand chrome (the builder uses its own full-screen layout, so this
// page brings its own header rather than the marketing Layout).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b0b0c] font-sans text-[#e8e2cf]">
      <header className="flex h-16 items-center justify-between border-b border-[rgba(191,166,105,0.18)] px-5">
        <Link href="/">
          <button className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e8e2cf] font-heading text-base italic leading-none text-[#0b0b0c]">
              a
            </div>
            <span className="font-heading text-base">AI Web Builder</span>
          </button>
        </Link>
        <Link href="/builder">
          <button className="flex h-9 items-center gap-1.5 rounded-full border border-[rgba(191,166,105,0.18)] px-3 text-sm text-[rgba(232,226,207,0.7)] transition-colors hover:bg-[#15151a]">
            <ArrowLeft className="h-4 w-4" /> Builder
          </button>
        </Link>
      </header>
      {children}
    </div>
  );
}
