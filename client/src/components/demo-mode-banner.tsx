import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

interface Health {
  ok: boolean;
  storage: "postgres" | "memory";
  degraded: boolean;
}

// Shows a site-wide warning when the server is running on throwaway in-memory
// storage (no DATABASE_URL). In that mode accounts and saved sites disappear on
// every restart, so we tell users plainly rather than letting the app pretend
// their work is being saved.
export function DemoModeBanner() {
  const { data } = useQuery<Health>({
    queryKey: ["/api/health"],
    queryFn: async () => {
      const res = await fetch("/api/health", { credentials: "include" });
      if (!res.ok) throw new Error("health check failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (!data?.degraded) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-300 border-b border-amber-500/30">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Demo mode — the database isn’t connected, so accounts and saved sites won’t
        persist. Generation still works.
      </span>
    </div>
  );
}
