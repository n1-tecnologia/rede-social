# Phase 08.3 — API Coverage Declaration

No external API integration: first-party courses module (eleven tables, RLS, a kernel gate seam, the `/v1/courses` routes, admin screens) over the project's own Supabase database and Hono API; lesson video reuses the Phase 3 / 05.3 Mux `VideoProvider` seam unchanged and materials reuse the Phase 3 Storage signed-upload broker unchanged.

The phase integrates no new vendor, SDK or service. The two external systems it touches are already integrated and are reached only through existing kernel seams:

- **Mux** (`packages/core/server/media/video/mux.ts`, `createMuxVideoProvider`): the lesson video is one more `media_assets` purpose (`lesson`) riding the existing direct-upload, `video.asset.ready` webhook, signed-playback path. The phase changes no Mux call; it sizes the token TTL passed to the existing `signPlayback` and adds a limits entry. `VIDEO_PROVIDER=fake` serves every automated command.
- **Supabase Storage** (`packages/core/server/media/storage.ts`): materials ride the existing signed-upload broker; the phase adds a no-memo `signReadFor(key, ttl)` sibling of the existing `signRead` (same `createSignedUrl` call, caller-chosen TTL) and widens the already-integrated `media` bucket's mime allow-list by migration, as 03-06 did for video.

The detector run over the finished PLAN.md files plus the ROADMAP section returned `detected: true` on two prose matches: "**API wiring.**" (08.3-01 registering the module in our own API app) and "browser/BFF → API" (a trust-boundary row naming our own API). Neither names a vendor. In the plans, "API", "route", "endpoint", "integration test" and "wiring" describe the project's own Hono API and its integration suite, not third-party integrations — the same two false positives the 08.2 run recorded. This file exists so the seal-time re-run accepts the reasoned declaration instead of a capability matrix.

**Reason (one line, required):** every capability of this phase is first-party code over the project's own Supabase database and Hono API; the only external systems involved (Mux, Supabase Storage) are already integrated in Phases 3 and 05.3 and are reached unchanged through their kernel seams (`VideoProvider`, the media storage broker).

*Recorded: 2026-10-13 · plan-phase (standard mode)*
