import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { useState, useEffect, useCallback } from "react";
import { Copy, Check, Trash2 } from "lucide-react";

// API keys page: how a person connects this product to Claude, Cursor, or any
// MCP client. Without it the MCP server is only usable by an agent holding
// USDC, because the key endpoints need a session cookie no chat client can send.
//
// The raw key is returned exactly once, at creation. Everything here is built
// around not losing it: it stays on screen until dismissed, with a copy button
// and an explicit warning, and it is never re-fetchable afterwards.
//
// The signed-out state deliberately shows the same explanation and setup steps
// as the signed-in one. Hiding how it works behind a login asks someone to
// commit before they understand what they are committing to.

interface KeyRow {
  id: string;
  name: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const MCP_URL = "https://ai-webbuilder.com/mcp";

const STEPS = [
  { n: "01", title: "Create a key", body: "One key per client. Name it so you can tell them apart later." },
  { n: "02", title: "Add the connector", body: "Point your client at the endpoint and set the key as its Authorization header." },
  { n: "03", title: "Ask for a site", body: "Describe the business in the chat. The build runs and returns a live URL." },
];

/** Mono label, used for kickers and field captions. */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-parchment/40">
      {children}
    </span>
  );
}

export default function ApiKeysPage() {
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
    // Optimistic: the row disappears on click, then the server confirms.
    setKeys((cur) => cur.filter((k) => k.id !== id));
    await fetch(`/api/keys/${id}`, { method: "DELETE", credentials: "include" });
    await load();
  };

  const copy = async (text: string, tag: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(null), 1600);
  };

  const cliCommand = `claude mcp add --transport http aiwb ${MCP_URL} \\\n  --header "Authorization: Bearer YOUR_KEY"`;

  return (
    <Layout variant="console">
      <div className="min-h-screen bg-graphite text-parchment">
        <div className="container mx-auto max-w-6xl px-6 py-20 lg:py-24">

          {/* Header: copy on the left, the product moment on the right. A single
              column left the right half of the viewport empty at desktop. */}
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-16">
            <div className="min-w-0">
              <Kicker>Connect</Kicker>
              <h1 className="mt-5 font-display text-[clamp(1.9rem,4vw,2.7rem)] font-medium leading-[1.08] tracking-[-0.02em]">
                Build sites from your assistant
              </h1>
              <p className="mt-4 max-w-lg text-[1.02rem] leading-relaxed text-parchment/55">
                Connect Claude, Cursor, or any MCP client to this account. Ask for
                a site in the chat and get back a live URL. Builds are billed to
                your plan, so there is no wallet or payment step in the client.
              </p>

              {!user && (
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Button onClick={() => setShowAuth(true)}>Sign in to create a key</Button>
                  <span className="text-sm text-parchment/40">Free plan included</span>
                </div>
              )}
            </div>

            {/* What the connection actually buys you, shown rather than described. */}
            <div className="crowe-raised min-w-0 rounded-[var(--crowe-r-lg)] p-5">
              <Kicker>In your client</Kicker>
              <div className="mt-4 space-y-3 font-mono text-[12.5px] leading-relaxed">
                <p className="text-parchment/85">
                  <span className="text-parchment/35">you  </span>
                  build a site for a bakery in Tucson
                </p>
                <p className="text-accent/90">
                  <span className="text-parchment/35">tool </span>
                  build_site
                </p>
                <div className="rounded-[var(--crowe-r-sm)] border border-parchment/10 bg-graphite/60 p-3">
                  <p className="text-parchment/50">siteUrl</p>
                  <p className="mt-1 break-all text-parchment/85">ryeandember.com</p>
                  <p className="mt-2 text-parchment/50">paidWith</p>
                  <p className="mt-1 text-parchment/85">account</p>
                </div>
              </div>
            </div>
          </div>

          {/* Steps: visible signed out, because the cost of connecting should be
              legible before anyone creates an account. */}
          <div className="mt-20 border-t border-parchment/10 pt-10">
            <Kicker>How it works</Kicker>
            <ol className="mt-6 grid gap-8 sm:grid-cols-3 sm:gap-10">
              {STEPS.map((s) => (
                <li key={s.n} className="min-w-0">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-accent/80">{s.n}</span>
                  <h2 className="mt-3 text-[0.95rem] font-medium text-parchment">{s.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-parchment/50">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>

          {user && (
            <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
              <div className="min-w-0">
                <Kicker>Your keys</Kicker>

                <div className="mt-5 flex flex-wrap gap-3">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !busy) void create(); }}
                    placeholder="Name this key, for example Claude on my laptop"
                    className="min-w-0 flex-1 rounded-[var(--crowe-r-sm)] border border-parchment/15 bg-parchment/[0.03] px-3 py-2 text-sm text-parchment transition-colors placeholder:text-parchment/30 focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                  />
                  <Button onClick={create} disabled={busy}>
                    {busy ? "Creating" : "Create key"}
                  </Button>
                </div>
                {error && <p className="mt-3 text-sm text-[var(--crowe-error)]">{error}</p>}

                {/* Shown once. No endpoint can return it again. */}
                {freshKey && (
                  <div className="crowe-raised mt-6 rounded-[var(--crowe-r-md)] border border-accent/25 p-4">
                    <Kicker>Copy this now. It cannot be shown again.</Kicker>
                    <div className="mt-3 flex items-center gap-2">
                      <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--crowe-r-sm)] bg-graphite/70 px-3 py-2 font-mono text-[13px] text-parchment">
                        {freshKey}
                      </code>
                      <Button variant="outline" size="sm" onClick={() => copy(freshKey, "key")} aria-label="Copy key">
                        {copied === "key" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <button
                      onClick={() => setFreshKey(null)}
                      className="mt-3 text-xs text-parchment/45 underline underline-offset-4 transition-colors hover:text-parchment/75"
                    >
                      I have saved it
                    </button>
                  </div>
                )}

                {keys.length === 0 ? (
                  <p className="mt-6 text-sm text-parchment/40">No keys yet.</p>
                ) : (
                  <ul className="mt-6 divide-y divide-parchment/10 rounded-[var(--crowe-r-md)] border border-parchment/10">
                    {keys.map((k) => (
                      <li key={k.id} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-parchment">{k.name || "Unnamed key"}</p>
                          <p className="font-mono text-[11px] text-parchment/35">
                            {k.lastUsedAt
                              ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                              : "never used"}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => revoke(k.id)} aria-label={`Revoke ${k.name || "key"}`}>
                          <Trash2 className="h-4 w-4 text-parchment/45" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="min-w-0">
                <Kicker>Add the connector</Kicker>
                <p className="mt-5 text-sm text-parchment/55">Claude Code</p>
                <div className="mt-2 flex items-start gap-2">
                  <pre className="crowe-panel min-w-0 flex-1 overflow-x-auto rounded-[var(--crowe-r-sm)] p-3 font-mono text-[11.5px] leading-relaxed text-parchment/85">
{cliCommand}
                  </pre>
                  <Button variant="outline" size="sm" onClick={() => copy(cliCommand.replace(/\\\n\s*/g, ""), "cli")} aria-label="Copy command">
                    {copied === "cli" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>

                <p className="mt-6 text-sm text-parchment/55">Cursor and other MCP clients</p>
                <dl className="mt-2 space-y-2 font-mono text-[11.5px]">
                  <div className="crowe-panel rounded-[var(--crowe-r-sm)] p-3">
                    <dt className="text-parchment/40">url</dt>
                    <dd className="mt-1 break-all text-parchment/85">{MCP_URL}</dd>
                  </div>
                  <div className="crowe-panel rounded-[var(--crowe-r-sm)] p-3">
                    <dt className="text-parchment/40">header</dt>
                    <dd className="mt-1 break-all text-parchment/85">Authorization: Bearer YOUR_KEY</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </div>
      </div>
      <AuthModal open={showAuth} onOpenChange={setShowAuth} />
    </Layout>
  );
}
