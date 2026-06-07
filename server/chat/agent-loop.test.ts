import { describe, it, expect, vi } from "vitest";
import { runTurn, type TurnEvent } from "./agent-loop";
import { fixtureDoc } from "./fixtures";
import type { AssistantToolTurn } from "../azure-chat";

// Script the model: each call to chatFn pops the next canned response.
function scripted(responses: AssistantToolTurn[]) {
  const calls: any[] = [];
  const fn = vi.fn(async (messages: any[], _tools: any[]) => {
    calls.push([...messages]);
    const next = responses.shift();
    if (!next) throw new Error("script exhausted");
    return next;
  });
  return { fn, calls };
}

const toolCall = (id: string, name: string, args: object): AssistantToolTurn =>
  ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const finalText = (text: string): AssistantToolTurn => ({ content: text, toolCalls: [] });

function collectEvents() {
  const events: TurnEvent[] = [];
  return { events, onEvent: (e: TurnEvent) => events.push(e) };
}

describe("runTurn", () => {
  it("executes a read-then-edit turn and reports mutation", async () => {
    const { fn } = scripted([
      toolCall("c1", "read_site", {}),
      toolCall("c2", "edit_section", { index: 0, patch: { headline: "Better bread." } }),
      finalText("Tightened the headline."),
    ]);
    const { events, onEvent } = collectEvents();
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "punchier headline",
      allowMutations: true, chatFn: fn, onEvent,
    });
    expect(out.reply).toBe("Tightened the headline.");
    expect(out.mutated).toBe(true);
    expect((out.doc.sections[0] as any).headline).toBe("Better bread.");
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(2);
    expect(events.filter((e) => e.type === "doc_updated")).toHaveLength(1); // only the mutation
  });

  it("feeds a ToolInputError back to the model, which self-corrects", async () => {
    const { fn, calls } = scripted([
      toolCall("c1", "edit_section", { index: 99, patch: { headline: "x" } }), // bad index
      toolCall("c2", "edit_section", { index: 0, patch: { headline: "Fixed." } }),
      finalText("Done."),
    ]);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "edit", allowMutations: true,
      chatFn: fn, onEvent: () => {},
    });
    expect(out.mutated).toBe(true);
    // The error text reached the model as a tool message on the next call.
    const toolMsgs = calls[1].filter((m: any) => m.role === "tool");
    expect(toolMsgs[0].content).toMatch(/index must be/);
  });

  it("abandons a tool after two consecutive failures (two-strike rule)", async () => {
    const bad = (id: string) => toolCall(id, "edit_section", { index: 99, patch: {} });
    const { fn, calls } = scripted([bad("c1"), bad("c2"), bad("c3"), finalText("I couldn't make that change.")]);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "edit", allowMutations: true,
      chatFn: fn, onEvent: () => {},
    });
    expect(out.mutated).toBe(false);
    // Third attempt was refused without executing: the tool message says abandoned.
    const lastToolMsg = calls[3].filter((m: any) => m.role === "tool").slice(-1)[0];
    expect(lastToolMsg.content).toMatch(/abandon/i);
  });

  it("stops at the tool-call cap and still returns a reply", async () => {
    const reads = Array.from({ length: 10 }, (_, i) => toolCall(`c${i}`, "read_site", {}));
    const { fn } = scripted(reads);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "loop", allowMutations: true,
      chatFn: fn, onEvent: () => {}, maxToolCalls: 3,
    });
    expect(out.reply).toMatch(/limit/i);
    expect(fn).toHaveBeenCalledTimes(3); // cap is checked before each round: 3 rounds, then refusal
  });

  it("withholds mutating tools when allowMutations=false", async () => {
    let seenTools: string[] = [];
    const fn = vi.fn(async (_m: any[], tools: any[]) => {
      seenTools = tools.map((t) => t.function.name);
      return finalText("You're out of generations today — upgrade for unlimited.");
    });
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "make it darker",
      allowMutations: false, chatFn: fn, onEvent: () => {},
    });
    expect(out.mutated).toBe(false);
    expect(seenTools.sort()).toEqual(["read_section", "read_site"]);
  });

  it("includes prior history in the messages sent to the model", async () => {
    const { fn, calls } = scripted([finalText("ok")]);
    await runTurn({
      doc: fixtureDoc(),
      history: [{ role: "user", content: "make it warm" }, { role: "assistant", content: "Warmed it up." }],
      userMessage: "now darker", allowMutations: true, chatFn: fn, onEvent: () => {},
    });
    const roles = calls[0].map((m: any) => m.role);
    expect(roles.slice(0, 4)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("refuses parallel tool calls that exceed the cap but answers every tool_call_id", async () => {
    const batch: AssistantToolTurn = { content: null, toolCalls: [
      { id: "p1", name: "read_site", arguments: "{}" },
      { id: "p2", name: "read_site", arguments: "{}" },
      { id: "p3", name: "read_site", arguments: "{}" },
    ] };
    // Capture the live (mutated) messages array so we can inspect tool replies
    // even though the turn ends without another model round.
    let live: any[] = [];
    const fn = vi.fn(async (messages: any[], _tools: any[]) => { live = messages; return batch; });
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "x", allowMutations: true,
      chatFn: fn, onEvent: () => {}, maxToolCalls: 2,
    });
    // The cap counts EXECUTIONS cumulatively: 2 execute, the 3rd is refused,
    // and the cap being reached ends the turn — no further model round.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out.reply).toMatch(/limit/i);
    expect(out.toolEvents).toHaveLength(3);
    expect(out.toolEvents.map((e) => e.ok)).toEqual([true, true, false]);
    const toolMsgs = live.filter((m: any) => m.role === "tool");
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(["p1", "p2", "p3"]); // every id answered
    expect(toolMsgs[2].content).toMatch(/limit/i);
  });

  it("caps cumulative executions across rounds, not per round", async () => {
    // maxToolCalls=3: a batch of 2 executes (2 used), the next round's batch of 2
    // gets 1 execution + 1 refusal (3 used), then the cap ends the turn.
    const batchOf2 = (a: string, b: string): AssistantToolTurn => ({ content: null, toolCalls: [
      { id: a, name: "read_site", arguments: "{}" },
      { id: b, name: "read_site", arguments: "{}" },
    ] });
    const { fn } = scripted([batchOf2("a1", "a2"), batchOf2("b1", "b2")]);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "x", allowMutations: true,
      chatFn: fn, onEvent: () => {}, maxToolCalls: 3,
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(out.reply).toMatch(/limit/i);
    expect(out.toolEvents.map((e) => e.ok)).toEqual([true, true, true, false]);
  });

  it("returns CAP_REPLY when the deadline expires (fake clock)", async () => {
    let t = 0;
    const { fn } = scripted([toolCall("c1", "read_site", {})]);
    const { events, onEvent } = collectEvents();
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "x", allowMutations: true,
      chatFn: async (...a) => { t += 61_000; return fn(...a); }, onEvent,
      deadlineMs: 60_000, now: () => t,
    });
    expect(out.reply).toMatch(/limit/i);
    expect(events.filter((e) => e.type === "assistant")).toHaveLength(1); // cap path emits too
  });

  it("feeds malformed JSON arguments to the tool as an error the model can correct", async () => {
    const { fn, calls } = scripted([
      { content: null, toolCalls: [{ id: "c1", name: "edit_section", arguments: "{not json" }] },
      finalText("ok"),
    ]);
    await runTurn({ doc: fixtureDoc(), history: [], userMessage: "x", allowMutations: true, chatFn: fn, onEvent: () => {} });
    const toolMsg = calls[1].filter((m: any) => m.role === "tool")[0];
    expect(toolMsg.content).toMatch(/Error:/);
  });
});
