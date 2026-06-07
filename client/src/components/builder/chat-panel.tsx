import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowUp } from "lucide-react";

// Conversational builder side panel (C1, behind ?chat=1). Talks to
// POST /api/chat/:projectId/turns and renders the SSE stream: tool chips
// appear as the agent works; doc_updated swaps the live preview.

interface ToolEvent { name: string; ok: boolean; detail: string; running?: boolean }
interface ChatMsg { role: "user" | "assistant"; content: string; toolEvents?: ToolEvent[]; docVersion?: number | null }

interface ChatPanelProps {
  projectId: string;
  onDocUpdate: (document: any, html: string, css: string) => void;
  onQuota: (quota: any) => void;
  onVideoStarted?: (videoId: string) => void;
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

export function ChatPanel({ projectId, onDocUpdate, onQuota, onVideoStarted }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<any | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  // Hydrate the transcript.
  useEffect(() => {
    fetch(`/api/chat/${projectId}/messages`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages((d.messages ?? []).map((m: any) => ({ role: m.role, content: m.content, toolEvents: m.toolEvents ?? undefined, docVersion: m.docVersion ?? null }))))
      .catch(() => {});
  }, [projectId]);

  // Hydrate the quota pill once on mount.
  useEffect(() => {
    fetch("/api/quota", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setQuota(d.quota))
      .catch(() => {});
  }, []);

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
        setMessages((m) => [...m, { role: "assistant", content: "Could not revert — the version may no longer be available." }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Could not revert — connection error." }]);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
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
        if (event === "tool_start") {
          patchLast((a) => ({ ...a, toolEvents: [...(a.toolEvents ?? []), { name: data.name, ok: true, detail: data.label, running: true }] }));
        } else if (event === "tool_result") {
          patchLast((a) => ({
            ...a,
            toolEvents: (a.toolEvents ?? []).map((t, i, arr) =>
              i === arr.length - 1 && t.running ? { name: data.name, ok: data.ok, detail: data.detail, running: false } : t),
          }));
        } else if (event === "doc_updated") {
          onDocUpdate(data.document, data.html, data.css);
        } else if (event === "turn_done") {
          patchLast((a) => ({ ...a, content: data.reply, docVersion: data.docVersion ?? null }));
          onQuota(data.quota);
          setQuota(data.quota);
        } else if (event === "video_started") {
          onVideoStarted?.(data.videoId);
        } else if (event === "error") {
          patchLast((a) => ({ ...a, content: data.error }));
        }
      }
    } catch {
      patchLast((a) => ({ ...a, content: "Connection dropped — the change may still have applied. Reload to see the latest." }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-[370px] min-w-[370px] flex-col border-r border-gold/15 bg-graphite-soft">
      <div className="flex items-center justify-between border-b border-gold/10 px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-parchment/55">Conversation</span>
        {quota != null && (
          <span className="rounded-full border border-gold/30 px-2.5 py-0.5 font-mono text-[10px] text-gold">
            {quota.limit != null ? `${quota.used} / ${quota.limit} today` : "Unlimited"}
          </span>
        )}
      </div>

      <div ref={streamRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] border border-gold/20 bg-gold/10 px-3 py-2 text-[13.5px] leading-snug">
              {m.content}
            </div>
          ) : (
            <div key={i} className="max-w-[92%] self-start text-[13.5px] leading-relaxed text-parchment/90">
              <div className="mb-1.5 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Builder
              </div>
              {(m.toolEvents?.length ?? 0) > 0 && (
                <div className="my-1.5 flex flex-col gap-1">
                  {m.toolEvents!.map((t, j) => (
                    <div key={j} className="flex items-center gap-2 rounded-lg border border-gold/10 bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-parchment/60">
                      <span className={`text-gold ${t.running ? "animate-pulse" : ""}`}>{t.running ? "[ .. ]" : t.ok ? "[done]" : "[fail]"}</span>
                      <span className="text-parchment/85">{t.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.content || (busy && i === messages.length - 1 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" /> : null)}
              {typeof m.docVersion === "number" && m.docVersion > 1 && (
                <button
                  onClick={() => undo(m.docVersion! - 1)}
                  disabled={busy}
                  className="mt-1.5 font-mono text-[10.5px] text-parchment/45 hover:text-gold disabled:opacity-40"
                >
                  v{m.docVersion! - 1} &rarr; v{m.docVersion} &middot; undo
                </button>
              )}
            </div>
          ),
        )}
        {messages.length === 0 && (
          <p className="mt-6 text-center text-sm text-parchment/45">
            Tell the builder what to change — copy, sections, style.
          </p>
        )}
      </div>

      <div className="border-t border-gold/10 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-gold/30 bg-black/35 p-2 pl-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Tell the builder what to change…"
            rows={1}
            className="max-h-[120px] min-h-[36px] w-full resize-none border-none bg-transparent py-1.5 text-[13.5px] placeholder:text-parchment/45 focus:outline-none"
          />
          <button onClick={send} disabled={busy || !input.trim()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold text-graphite disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
