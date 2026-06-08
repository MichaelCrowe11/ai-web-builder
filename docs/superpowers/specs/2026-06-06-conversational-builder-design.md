# Conversational Builder — Design

**Date:** 2026-06-06
**Status:** Approved in brainstorm; pending written-spec review
**Origin:** "It just has basic templates, no true AI chat and build system like Replit has."

## Problem

Every site is AI-generated (outline → fill via Azure GPT-5), but the experience
stops at one shot plus six preset refine chips. The capability is hidden: the
backend (`refineDocument`) already applies arbitrary natural-language
instructions to the structured site document, yet users can only press canned
buttons. The product feels templated even though it isn't.

## Decision

Build a **full agent runtime** (approach C — chosen over a thinner
tool-routing chat, approach A): fine-grained tools, multi-step agentic turns,
live tool events streaming into a side panel, with the preview updating
mid-turn. The Replit feel, scoped to websites.

Decisions locked during brainstorm:

| Question | Decision |
|---|---|
| Capabilities at launch | All four: copy+style edits, restructure sections, media on command, site-wide regeneration. "Launch" = the public unflag at end of phase C2; C1 ships flagged with the first two. |
| Gating | Chat for all, metered: mutating turns count against the free 5/day quota; Q&A turns free; media tools Pro-only (server-enforced) |
| Layout | Side panel (Replit-style), 370px, preview keeps ~70% width |
| Assistant identity | Labeled "Builder". No character name, no model names ever in UI (Crowe doctrine) |

## Architecture: the turn loop

A turn is `POST /api/chat/:projectId/turns` with the user message. Server-side
agentic loop:

1. Send conversation history + compact site outline to Azure via a new
   tool-calling chat variant.
2. Model responds with tool calls; server executes them against a **working
   copy** of the site document.
3. Tool results feed back; repeat until the model emits a final text reply.
4. Caps: **8 tool calls and ~60s wall clock per turn.**

The turn streams to the panel over **SSE**: `tool_start`, `tool_result`,
`doc_updated` (preview re-renders mid-turn), `assistant_delta`, `turn_done`,
`error`. Cloud Run `min=max=1` keeps SSE simple (one instance); the existing
`runLimited` cap guards Azure spend.

On `turn_done`, the mutated doc persists as a new `siteDocuments` version
(versioning already exists: `projectId + version` unique) and the transcript
persists to a new table:

```
chat_messages (
  id uuid PK,
  project_id varchar(36) NOT NULL,        -- FK projects
  role text NOT NULL,                     -- 'user' | 'assistant'
  content text NOT NULL,
  tool_events jsonb,                      -- ordered tool_start/result records
  doc_version integer,                    -- version this turn produced (null = no mutation)
  created_at timestamp DEFAULT now()
)
```

**Undo = revert to the previous siteDocuments version.** One tap, no modal,
itself undoable.

## Tool inventory

Token-frugal by design: the model reads the site like a filesystem instead of
receiving the whole document every turn.

| Tool | Does | Notes |
|---|---|---|
| `read_site()` | Compact outline: section ids, types, headline snippets | Always cheap |
| `read_section(id)` | Full JSON of one section | Read before edit |
| `edit_section(id, patch)` | Zod-validated merge | The workhorse |
| `add_section(type, after, content)` | Insert section | |
| `remove_section(id)` | Delete section | |
| `move_section(id, to)` | Reorder | |
| `set_theme(preset)` | Visual treatment | |
| `set_meta(...)` | Name, tagline | |
| `generate_image(sectionId, slot, prompt)` | Targeted photo | **Pro-gated server-side** |
| `generate_hero_video(prompt)` | Sora hero video | **Pro-gated server-side** |
| `rebuild_site(prompt)` | Existing outline→fill pipeline | "Make it a coffee truck instead" |

Every mutation is validated by the existing zod `validate()` before touching
the working copy. Invalid patches bounce back to the model as tool errors (it
self-corrects). Only a validate-clean doc persists; a turn can never commit a
corrupted site.

Metering: a turn that fires any mutating tool = one generation against quota.
Pure Q&A turns are free, so the conversation never goes dead. Media tools
refuse politely for free users with an in-stream upgrade card.

## Side panel UI

Mockup reviewed and approved (2026-06-06).

- **Anatomy:** 370px left panel — `CONVERSATION` header + live quota pill
  ("3 / 5 today"), transcript, composer pinned at bottom. Preview keeps ~70%.
- **Tool theater:** each agent action streams in as a mono chip inside the
  assistant message as it runs (`[done] edit_section — Hero`, pulsing
  `[ .. ] generate_image`). The preview simultaneously flashes a gold outline
  on the section being touched, with an "Updating — <Section>" badge.
- **Undo:** mutating turns footer with `v12 → v13 · undo`.
- **Pro gating in-stream:** refusals are quiet gold-bordered cards in the
  conversation, not errors.
- **The bottom dock dies:** prompt bar, refine chips, and the iframe empty
  state are removed (in phase C2). The conversation is the single interface
  from turn zero: an empty project opens with one assistant message
  ("Describe the site you want…") and the first user message is the
  generation. One mental model, no mode switch.
- **Mobile:** panel becomes a bottom sheet — collapsed to a slim input over
  the full-bleed preview, drag up for transcript. Desktop-first; the sheet is
  a later milestone (C3), not launch-blocking.

## Error handling

| Failure | Behavior |
|---|---|
| Invalid tool patch | Tool error back to model, self-corrects in-turn; two strikes on the same tool → abandon that action and say so |
| Broken doc at turn end | Impossible by construction: working copy + validate-before-persist; worst case the turn commits nothing |
| Azure outage | Existing retry/fallback chain absorbs transients; dead turn = calm in-panel message, nothing changed |
| Runaway loop | 8-call / ~60s caps; partial commit of validated work + honest report |
| Quota exhausted | Mutating turns refuse with upsell card; Q&A keeps working |
| SSE drop | Turn finishes server-side; client reconciles on reconnect (refetch transcript + latest doc version) |

## Model + streaming mechanics

New `azureChatTools()` alongside `azureChat` — same endpoint/retry/fallback
semantics, accepts tool definitions, returns tool calls or text. **Known
wrinkle:** a mid-conversation model fallback replays the full tool transcript
(tool-call state lives in messages) — needs an explicit test. Final reply
streams as `assistant_delta`. Token cost for a copy tweak: hundreds of tokens,
not the 3.2k whole-doc rewrite of the current refine.

## Testing

- **Unit:** every tool against fixture docs — happy path + malformed-patch
  rejection. The zod boundary is the safety contract; densest coverage here.
- **Agent loop:** fake-model injection (existing `azure-chat.test.ts`
  pattern) with scripted tool-call sequences — multi-step turns,
  self-correction, cap enforcement, partial commit, fallback-with-tools.
- **Gating:** mutating vs Q&A metering; media tools as free user must refuse
  server-side regardless of UI.
- **SSE:** event ordering, reconnect reconciliation.

## Build phases

1. **C1 — the core feel:** tool runtime + `azureChatTools` + SSE turn
   endpoint + side panel with tool chips. Edit/restructure/theme tools.
   Ships the Replit feel behind a flag.
2. **C2 — full capability:** media tools (Pro-gated), `rebuild_site`, undo,
   quota pill, bottom-dock removal + turn-zero flow.
3. **C3 — polish:** preview section-flash, streaming text deltas, mobile
   bottom sheet, cross-device transcript.

Each phase shippable behind a flag; the dock is not removed until C2 proves
the panel fully replaces it.

## Out of scope

- Arbitrary code generation / full web apps (that ambition belongs to the
  Crowe Code platform, not ai-web-builder)
- Voice input, multi-user collaboration
- Agent API (`/v1/agent/*`) chat parity — machine clients keep the existing
  build/refine routes
