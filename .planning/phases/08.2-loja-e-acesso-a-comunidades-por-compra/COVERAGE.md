# Phase 08.2 — API Coverage Declaration

No external API integration: first-party store module (tables, RLS, definers, `/v1/store` routes, screens); no payment gateway yet; product images reuse the Phase 3 media broker.

The phase has no payment gateway: a purchase is recorded as an order with provider `none`, and the gateway that will plug into that order is a later phase (ROADMAP § Phase 08.2, CONTEXT deferred ideas). The product image reuses the already-integrated Phase 3 media broker unchanged (purpose `cover`, signed direct upload), and every automated command pins `VIDEO_PROVIDER=fake`.

The detector run over this phase's ROADMAP section alone returned `{"detected":false,"signals":[]}`. Re-run over the finished PLAN.md files plus the ROADMAP section, it returned `detected: true` on three prose matches: "**API wiring.**" (08.2-01 registering the module in our own API app), "browser/BFF → API" (a trust-boundary row naming our own API) and "wraps … like the rest of its copy" (UI copy wrapping text). None names a vendor. In the plans, "API", "route", "endpoint", "integration test" and "wiring" describe the project's own Hono API and its integration suite, not third-party integrations. This file exists so the seal-time re-run accepts the reasoned declaration instead of a capability matrix.

**Reason (one line, required):** every capability of this phase is first-party code over the project's own Supabase database and Hono API; the only external-looking pieces are the existing Phase 3 media broker (reused unchanged) and the future payment gateway, which is explicitly out of this phase.

*Recorded: 2026-10-08 · plan-phase (standard mode)*
