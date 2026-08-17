import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { useState, useEffect, useCallback } from "react";
import { Copy, Check, Trash2 } from "lucide-react";

// API keys page — how a person connects this product to ChatGPT, Claude, Cursor
// or any MCP client. Without it the MCP server is only usable by an agent
// holding USDC, because the key endpoints need a session cookie that no chat
// client can supply.
//
// The raw key is returned exactly once, at creation. Everything on this page is
// built around not losing it: it stays on screen until dismissed, with a copy
// button and an explicit warning, and it is never re-fetchable afterwards.

interface KeyRow {
  id: string;
  name: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const MCP_URL = "https://ai-webbuilder.com/mcp";

export default function ApiKeysPage() {
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/keys", { credentials: "include" });
    if (res.ok) setKeys((await res.json()).keys ?? []);
  }, []);

  useEffect(() => { if (user) void load(); }, [user, load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? "Could not create a key."); return; }
      setFreshKey(data.key);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: "DELETE", credentials: "include" });
    await load();
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Layout variant="console">
      <div className="min-h-screen bg-graphite text-parchment">
        <div className="container mx-auto max-w-3xl px-6 py-24">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-accent/90">
            Connect
          </div>
          <h1 className="font-display text-[clamp(1.9rem,4vw,2.7rem)] font-medium leading-[1.08] tracking-[-0.02em]">
            Use it from your assistant
          </h1>
          <p className="mt-4 max-w-xl text-[1.02rem] leading-relaxed text-parchment/55">
            Create a key, add it to Claude, Cursor, or any MCP client, and build
            sites by asking. Calls are billed to this account under your plan.
          </p>

          {!user ? (
            <div className="mt-10">
              <Button onClick={() => setShowAuth(true)}>Sign in to create a key</Button>
            </div>
          ) : (
            <>
              <div className="mt-10 flex gap-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name this key, e.g. Claude on my laptop"
                  className="flex-1 rounded-md border border-parchment/15 bg-parchment/[0.03] px-3 py-2 text-sm text-parchment placeholder:text-parchment/35 focus:border-accent/40 focus:outline-none"
                />
                <Button onClick={create} disabled={busy}>
                  {busy ? "Creating…" : "Create key"}
                </Button>
              </div>
              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

              {/* Shown once. There is no endpoint that can return it again. */}
              {freshKey && (
                <div className="mt-6 rounded-lg border border-accent/30 bg-accent/[0.05] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent/90">
                    Copy this now — it cannot be shown again
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto rounded bg-graphite/60 px-3 py-2 font-mono text-sm text-parchment">
                      {freshKey}
                    </code>
                    <Button variant="outline" size="sm" onClick={() => copy(freshKey)}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <button
                    onClick={() => setFreshKey(null)}
                    className="mt-3 text-xs text-parchment/45 underline underline-offset-4 hover:text-parchment/70"
                  >
                    I've saved it
                  </button>
                </div>
              )}

              <div className="mt-10">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment/45">
                  Your keys
                </h2>
                {keys.length === 0 ? (
                  <p className="mt-3 text-sm text-parchment/45">No keys yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-parchment/10 rounded-lg border border-parchment/10">
                    {keys.map((k) => (
                      <li key={k.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm text-parchment">{k.name || "Unnamed key"}</p>
                          <p className="text-xs text-parchment/40">
                            {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "Never used"}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => revoke(k.id)} aria-label="Revoke key">
                          <Trash2 className="h-4 w-4 text-parchment/50" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-12">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment/45">
                  Add the connector
                </h2>
                <p className="mt-3 text-sm text-parchment/55">Claude Code:</p>
                <code className="mt-2 block overflow-x-auto rounded bg-graphite/60 px-3 py-2 font-mono text-xs text-parchment/85">
                  claude mcp add --transport http aiwb {MCP_URL} --header "Authorization: Bearer YOUR_KEY"
                </code>
                <p className="mt-4 text-sm text-parchment/55">
                  Cursor and other MCP clients: use the URL{" "}
                  <code className="font-mono text-parchment/85">{MCP_URL}</code> and set an{" "}
                  <code className="font-mono text-parchment/85">Authorization</code> header of{" "}
                  <code className="font-mono text-parchment/85">Bearer YOUR_KEY</code>.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      <AuthModal open={showAuth} onOpenChange={setShowAuth} />
    </Layout>
  );
}
