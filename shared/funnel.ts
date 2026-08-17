import { z } from "zod";

// ============================================================================
// Product acquisition funnel — the stages a person moves through from an
// anonymous trial to a paying Pro subscriber.
//
// This is distinct from telemetry.ts, which measures a PUBLISHED SITE's own
// visitor engagement. This file measures OUR funnel, so growth decisions are
// made on data, not guesses: how many trials convert to signups, how many
// signups convert to Pro, and where people fall out.
// ============================================================================

export const PRODUCT_EVENTS = [
  "landing_view",       // a human loaded the marketing page (top of funnel)
  "bot_view",           // an automated client loaded it — counted apart, never as a visitor
  "anon_trial_start",   // an anonymous visitor ran a build
  "trial_exhausted",    // an anonymous visitor hit the free-trial cap
  "signup",             // created an account
  "free_limit_reached", // a signed-in free user hit the daily cap (upgrade pressure)
  "checkout_start",     // opened Stripe checkout for Pro
  "pro_converted",      // subscription active — now paying
  "pro_churned",        // a paying subscriber lapsed back to free
  // MCP surface (ChatGPT / Claude / Cursor connectors). Its own mini-funnel:
  // a client listing tools is the closest thing to an install signal, and the
  // gap between that and a completed build is where connector users are lost.
  "mcp_tools_list",     // an MCP client enumerated our tools (install/refresh)
  "mcp_payment_required", // a paid tool was called but the caller could not pay
  "mcp_build",          // a site was actually built through MCP
] as const;
export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

export const productEventSchema = z.object({
  ts: z.number().int(),
  event: z.enum(PRODUCT_EVENTS),
  // The subject: a signed-in user id when known, else a stable hashed anon id.
  userId: z.string().optional(),
  anonId: z.string().optional(),
  meta: z.record(z.union([z.string(), z.number()])).optional(),
});
export type ProductEvent = z.infer<typeof productEventSchema>;

// The ordered stages that sit on the main conversion path, with human labels.
// `landing_view` is first on purpose: with the funnel topped by "Trial started",
// every rate below was measured against people who had already engaged, so the
// arrive-and-leave drop — the biggest one — was invisible.
export const FUNNEL_STAGES: Array<{ event: ProductEventName; label: string }> = [
  { event: "landing_view", label: "Landed" },
  { event: "anon_trial_start", label: "Trial started" },
  { event: "signup", label: "Signed up" },
  { event: "checkout_start", label: "Checkout opened" },
  { event: "pro_converted", label: "Converted to Pro" },
];

export interface FunnelStage {
  event: ProductEventName;
  label: string;
  subjects: number;   // distinct people who reached this stage
  events: number;     // raw event count (may exceed subjects; repeats dedupe)
  ofTop: number;      // percent of the first stage's subjects (0..100)
  stepRate: number;   // percent of the previous stage's subjects (0..100)
}

export interface AcquisitionFunnel {
  windowMs: number;
  stages: FunnelStage[];
  // Off-path diagnostic signals: pressure points where people stall.
  trialExhausted: number;   // distinct anon visitors who hit the trial cap
  freeLimitReached: number; // distinct free users who hit the daily cap
  botViews: number;         // distinct automated clients, excluded from `stages`
  proChurned: number;       // distinct subscribers who lapsed — gross conversions
                            // alone can look healthy while the base shrinks
  // MCP connector funnel, kept off `stages` because it is a parallel entry
  // path: these callers never touch the marketing page at all.
  mcpClients: number;       // distinct clients that listed tools
  mcpPaymentRequired: number; // distinct callers turned away at the paywall
  mcpBuilds: number;        // distinct callers who completed a build
}

// A subject is a signed-in user when known, else the hashed anonymous id.
function subjectKey(e: ProductEvent): string {
  return e.userId ?? e.anonId ?? "unknown";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pure aggregation over a set of product events. Counts DISTINCT subjects per
 * stage, so double-fired events (the same anon visitor building twice) collapse
 * to one person. Extracted from the DB read path for unit testing.
 */
export function buildAcquisitionFunnel(events: ProductEvent[], windowMs: number): AcquisitionFunnel {
  const distinct = new Map<ProductEventName, Set<string>>();
  const counts = new Map<ProductEventName, number>();
  for (const name of PRODUCT_EVENTS) {
    distinct.set(name, new Set());
    counts.set(name, 0);
  }
  for (const e of events) {
    const set = distinct.get(e.event);
    if (!set) continue;
    set.add(subjectKey(e));
    counts.set(e.event, (counts.get(e.event) ?? 0) + 1);
  }

  const top = distinct.get(FUNNEL_STAGES[0].event)!.size;
  let prev = top;
  const stages: FunnelStage[] = FUNNEL_STAGES.map((s) => {
    const subjects = distinct.get(s.event)!.size;
    const stage: FunnelStage = {
      event: s.event,
      label: s.label,
      subjects,
      events: counts.get(s.event) ?? 0,
      ofTop: top ? round1((subjects / top) * 100) : 0,
      stepRate: prev ? round1((subjects / prev) * 100) : 0,
    };
    prev = subjects;
    return stage;
  });

  return {
    windowMs,
    stages,
    trialExhausted: distinct.get("trial_exhausted")!.size,
    freeLimitReached: distinct.get("free_limit_reached")!.size,
    botViews: distinct.get("bot_view")!.size,
    proChurned: distinct.get("pro_churned")!.size,
    mcpClients: distinct.get("mcp_tools_list")!.size,
    mcpPaymentRequired: distinct.get("mcp_payment_required")!.size,
    mcpBuilds: distinct.get("mcp_build")!.size,
  };
}
