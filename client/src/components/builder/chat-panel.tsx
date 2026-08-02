import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowUp } from "lucide-react";
import { nextFlash, type SectionFlash } from "@/lib/section-flash";
import { STARTERS } from "@/lib/starters";

// Conversational builder side panel (the default interface; ?chat=0 restores
// the legacy dock). Talks to
// POST /api/chat/:projectId/turns and renders the SSE stream: tool chips
// appear as the agent works; doc_updated swaps the live preview.

interface ToolEvent { name: string; ok: boolean; detail: string; running?: boolean }
// upsell is transient client state — it is not persisted and will not appear on reload (acceptable).
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  toolEvents?: ToolEvent[];
  docVersion?: number | null;
  upsell?: boolean;
  upsellFeature?: string | null;
}

interface ChatPanelProps {
  projectId: string;
  /** True once a site has been generated and saved (projectId is non-empty and
   *  the document exists). While false, the first message routes through
   *  onFirstMessage instead of the turn endpoint. */
  ready: boolean;
  onFirstMessage?: (text: string) => Promise<void>;
  onDocUpdate: (document: any, html: string, css: string) => void;
  onQuota: (quota: any) => void;
  onVideoStarted?: (videoId: string) => void;
  onUpgrade?: () => void;
  /** Preview section-flash: called with the section being touched while a
   *  section-addressed tool runs, and null when it should stop flashing. */
  onSectionFlash?: (flash: SectionFlash | null) => void;
}

// Parse an SSE stream from a fetch body: yields { event, data } frames.
async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
      const dataRaw = /^data: (.*)$/m.exec(frame)?.[1];
      if (dataRaw) yield { event, data: JSON.parse(dataRaw) };
    }
  }
}

function upgradeCopy(feature?: string | null) {
  const isVideo = typeof feature === "string" && feature.toLowerCase().includes("video");
  return {
    headline: isVideo ? "Hero video comes with Pro." : "Photo generation comes with Pro.",
    body: isVideo
      ? "Upgrade to unlock hero video, photo generation, unlimited generations, and export code."
      : "Upgrade to unlock photo and video generation, unlimited generations, and export code.",
  };
}

export function ChatPanel({ projectId, ready, onFirstMessage, onDocUpdate, onQuota, onVideoStarted, onUpgrade, onSectionFlash }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<any | null>(null);
  // Mobile bottom-sheet expansion; irrelevant on md+ (the md: classes pin the
  // desktop column layout regardless of this value).
  const [sheetOpen, setSheetOpen] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  // Hydrate the transcript. Skip when projectId is empty (pre-generation turn-zero
  // state) — there is no project to fetch against yet. When projectId appears
  // right after turn-zero, the server transcript holds the seeded founding
  // exchange (project creation records it); an empty fetch keeps local state.
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/chat/${projectId}/messages`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => {
        const fetched: ChatMsg[] = (d.messages ?? []).map((m: any) => ({ role: m.role, content: m.content, toolEvents: m.toolEvents ?? undefined, docVersion: m.docVersion ?? null }));
        setMessages((m) => (fetched.length === 0 ? m : fetched));
      })
      .catch(() => {});
  }, [projectId]);

  // Hydrate the quota pill: on mount (the endpoint is projectId-independent, so
  // turn-zero users see their allowance immediately) and again once the project
  // exists (generation consumed quota in between).
  useEffect(() => {
    fetch("/api/quota", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setQuota(d.quota))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const undo = async (toVersion: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/${projectId}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ toVersion }),
      });
      if (res.ok) {
        const d = await res.json();
        onDocUpdate(d.document, d.html, d.css);
        setMessages((m) => [...m, { role: "assistant", content: "Reverted to the previous version." }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: "Could not revert. That version may no longer be available." }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Could not revert. Connection error." }]);
    } finally {
      setBusy(false);
    }
  };

  // `preset` lets a starter chip send without a round trip through input state,
  // which would not have committed by the time send() read it.
  const send = async (preset?: string) => {
    const message = (preset ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setSheetOpen(true); // mobile: surface the transcript so tool theater is visible

    // Turn-zero: the panel is visible before any site exists. Route the first
    // message through onFirstMessage (which calls handleGenerate in the parent)
    // rather than POSTing to the turn endpoint (there is no project yet).
    // The exchange renders client-side here; the server records it durably when
    // the project is created (seedTurnZeroTranscript), so reloads/other devices
    // see the same founding messages.
    if (!ready && onFirstMessage) {
      setMessages((m) => [
        ...m,
        { role: "user", content: message },
        { role: "assistant", content: "Building your site. Watch the preview…" },
      ]);
      try {
        await onFirstMessage(message);
        setMessages((m) =>
          m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, content: "Here’s the first draft. Tell me what to change." }
              : msg,
          ),
        );
      } catch {
        setMessages((m) =>
          m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, content: "Something went wrong generating the site. Try describing it again." }
              : msg,
          ),
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "", toolEvents: [] }]);

    const patchLast = (fn: (a: ChatMsg) => ChatMsg) =>
      setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? fn(msg) : msg)));

    try {
      const res = await fetch(`/api/chat/${projectId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        patchLast((a) => ({ ...a, content: err.error ?? "That didn't go through." }));
        return;
      }
      for await (const { event, data } of sseEvents(res.body)) {
        const flash = nextFlash(event, data);
        if (flash !== undefined) onSectionFlash?.(flash);
        if (event === "tool_start") {
          patchLast((a) => ({ ...a, toolEvents: [...(a.toolEvents ?? []), { name: data.name, ok: true, detail: data.label, running: true }] }));
        } else if (event === "tool_result") {
          patchLast((a) => ({
            ...a,
            toolEvents: (a.toolEvents ?? []).map((t, i, arr) =>
              i === arr.length - 1 && t.running ? { name: data.name, ok: data.ok, detail: data.detail, running: false } : t),
          }));
        } else if (event === "assistant_delta") {
          // Optimistic paint: append fragments as they stream. turn_done's
          // reply REPLACES this, so retry/fallback duplicates self-heal.
          patchLast((a) => (a.upsell ? a : { ...a, content: a.content + data.text }));
        } else if (event === "upsell") {
          const copy = upgradeCopy(data.feature);
          patchLast((a) => ({
            ...a,
            content: copy.headline,
            upsell: true,
            upsellFeature: typeof data.feature === "string" ? data.feature : null,
          }));
        } else if (event === "doc_updated") {
          onDocUpdate(data.document, data.html, data.css);
        } else if (event === "turn_done") {
          patchLast((a) => ({
            ...a,
            content: a.upsell ? upgradeCopy(a.upsellFeature).headline : data.reply,
            docVersion: data.docVersion ?? null,
          }));
          onQuota(data.quota);
          setQuota(data.quota);
        } else if (event === "video_started") {
          onVideoStarted?.(data.videoId);
        } else if (event === "error") {
          patchLast((a) => ({ ...a, content: data.error }));
        }
      }
    } catch {
      patchLast((a) => ({ ...a, content: "Connection dropped. The change may still have applied, so reload to see the latest." }));
    } finally {
      onSectionFlash?.(null); // never leave a stale flash on the preview
      setBusy(false);
    }
  };

  return (
    // Desktop: fixed 370px side column. Mobile (<md): a bottom sheet over the
    // full-bleed preview — collapsed to the slim composer, the handle expands
    // the transcript; sending a message auto-expands so tool theater is seen.
    <div
      className={`flex flex-col bg-graphite-soft fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-accent/25 shadow-[0_-8px_30px_rgba(0,0,0,0.45)] ${
        sheetOpen ? "h-[72vh]" : ""
      } md:static md:z-auto md:h-auto md:w-[370px] md:min-w-[370px] md:rounded-none md:border-t-0 md:border-r md:border-accent/15 md:shadow-none`}
    >
      <button
        type="button"
        aria-label={sheetOpen ? "Collapse conversation" : "Expand conversation"}
        onClick={() => setSheetOpen((o) => !o)}
        className="flex w-full items-center justify-center py-2 md:hidden"
      >
        <span className="h-1 w-10 rounded-full bg-accent/40" />
      </button>
      <div className={`${sheetOpen ? "flex" : "hidden"} items-center justify-between border-b border-accent/10 px-4 py-3 md:flex`}>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-parchment/55">Conversation</span>
        {quota != null && (
          <span className="rounded-full border border-accent/30 px-2.5 py-0.5 font-mono text-[10px] text-accent">
            {quota.limit != null ? `${quota.used} / ${quota.limit} today` : "Unlimited"}
          </span>
        )}
      </div>

      <div ref={streamRef} className={`${sheetOpen ? "flex" : "hidden"} flex-1 flex-col gap-3.5 overflow-y-auto p-4 md:flex`}>
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] border border-accent/20 bg-accent/10 px-3 py-2 text-[13.5px] leading-snug">
              {m.content}
            </div>
          ) : (
            <div key={i} className="max-w-[92%] self-start text-[13.5px] leading-relaxed text-parchment/90">
              <div className="mb-1.5 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Builder
              </div>
              {(m.toolEvents?.length ?? 0) > 0 && (
                <div className="my-1.5 flex flex-col gap-1">
                  {m.toolEvents!.map((t, j) => (
                    <div key={j} className="flex items-center gap-2 rounded-lg border border-accent/10 bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-parchment/60">
                      <span className={`text-accent ${t.running ? "animate-pulse" : ""}`}>{t.running ? "[ .. ]" : t.ok ? "[done]" : "[fail]"}</span>
                      <span className="text-parchment/85">{t.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.content || (busy && i === messages.length - 1 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> : null)}
              {m.upsell && (
                <div className="mt-2 rounded-2xl border border-accent/25 bg-black/35 p-3 shadow-[0_0_0_1px_rgba(59,130,246,0.06)]">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-accent/70">Pro feature</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-parchment/92">
                    {upgradeCopy(m.upsellFeature).headline}
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-parchment/60">
                    {upgradeCopy(m.upsellFeature).body}
                  </div>
                  {onUpgrade && (
                    <button
                      type="button"
                      onClick={onUpgrade}
                      className="mt-3 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent/20"
                    >
                      Upgrade to Pro
                    </button>
                  )}
                </div>
              )}
              {typeof m.docVersion === "number" && m.docVersion > 1 && (
                <button
                  onClick={() => undo(m.docVersion! - 1)}
                  disabled={busy}
                  className="mt-1.5 font-mono text-[10.5px] text-parchment/45 hover:text-accent disabled:opacity-40"
                >
                  v{m.docVersion! - 1} &rarr; v{m.docVersion} &middot; undo
                </button>
              )}
            </div>
          ),
        )}
        {messages.length === 0 && (
          <div className="mt-6">
            <p className="text-center text-sm text-parchment/45">
              {ready
                ? "Tell the builder what to change: copy, sections, style."
                : "Describe the site you want, and the builder does the rest."}
            </p>

            {/* Empty-state starters. Landing on /builder directly used to be a
                blank room: the same instruction printed twice, once here and
                once across the preview, and nothing to act on. These are the
                same openers the home hero offers, so arriving by either door
                puts the same first move in reach. */}
            {!ready && (
              <div className="mt-5 flex flex-col gap-1.5">
                {STARTERS.map((o) => (
                  <button
                    key={o}
                    onClick={() => send(o)}
                    disabled={busy}
                    className="crowe-lift rounded-xl border border-accent/12 bg-graphite-soft px-3.5 py-2.5 text-left text-[0.82rem] leading-snug text-parchment/70 hover:text-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55 disabled:opacity-40"
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-accent/10 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-accent/30 bg-black/35 p-2 pl-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={ready ? "Tell the builder what to change…" : "Describe the site you want…"}
            rows={1}
            className="max-h-[120px] min-h-[36px] w-full resize-none border-none bg-transparent py-1.5 text-[13.5px] placeholder:text-parchment/45 focus:outline-none"
          />
          <button onClick={() => send()} disabled={busy || !input.trim()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-graphite disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
