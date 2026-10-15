# Phase 08.4 — API Coverage Declaration

No external API integration: course and live product links move into the first-party store module over the project's own Supabase database and Hono API.

The phase adds store-owned course/live link tables, retires the 08.3 `course_products` / `course_live_products` tables by migration, rewrites the store and courses integration tests, and adds course and live pickers to the product form. It integrates no new vendor, SDK or service and changes no call to an already-integrated one (Mux, Supabase Storage, web push).

The verify-time detector returned `detected: true` on prose matches ("API" surface, "integration" + "api"). In the plans and summaries, "API", "route", "integration test" and "integration rewrite" describe the project's own Hono API and its integration suite, not third-party integrations — the same false positive the 08.2 and 08.3 runs recorded. This file exists so the gate accepts the reasoned declaration instead of a capability matrix.

**Reason (one line, required):** every capability of this phase is first-party code over the project's own Supabase database and Hono API; no external system is added or changed.

*Recorded: 2026-10-15 · verify-work*
