# Project Research Summary

**Project:** Rede Social (white-label community platform)
**Domain:** Multi-tenant, white-label community / branded social-app SaaS (single URL, mobile-first PWA, admin-publishes-everything in V1)
**Researched:** 2026-09-11
**Confidence:** MEDIUM

## Executive Summary

Rede Social is a multi-tenant community SaaS in the Circle / Mighty Networks / Bettermode category, with two twists the comparables do not have: full white-label at every tier inside one URL (branding resolved from the logged-in account, not the hostname) and institution-grade features (admin broadcast stories, RSVP + self check-in, a support-desk chat role) aimed at Brazilian creators, churches, schools and associations. Experts build this shape as a **shared-schema Postgres with `tenant_id` on every row and RLS as defense in depth**, a **modular monolith API** (one deployable, feature modules by folder, per-tenant feature flags gating both routes and navigation), and a thin **Next.js BFF + renderer** that never owns business rules. The fixed stack (Next.js on Vercel, Node/TS API on Cloud Run, Supabase, GitHub CI/CD) fits this shape well; the research pinned concrete versions (Next 16.3, Hono 4.13, Drizzle 0.45, Supabase CLI 2.117, Serwist 9.5) and verified them against npm and official docs on 2026-09-11.

The recommended approach is: build the **core kernel first** (tenants, users, `memberships`, RLS transaction lane, JWKS auth, module registry, `/me/bootstrap`), then **branding + PWA shell**, then a **media broker** (signed direct-to-Storage uploads, external video transcoding), then content modules in dependency order (feed -> communities -> stories -> events), then **notifications + Realtime**, **Web Push**, **chat**, **moderation/admin**, and **pilot hardening**. Each step is independently deployable and each establishes a convention the next reuses (nullable-FK likes/comments, keyset pagination, domain events -> worker jobs, id-only Broadcast signals).

The four researchers converged on **six decisions that refine or contradict PROJECT.md constraints** and must be confirmed by the user before roadmapping (see "Decisions Requiring User Confirmation"): two narrow exceptions to "frontend never talks to Supabase" (Realtime subscribe-only; Supabase Auth session mechanics via `@supabase/ssr` in the Next.js *server*), identity != membership schema, an external video vendor, pinned-story expiry semantics, and the Supabase Pro plan. The highest risks are silent tenant leakage (API using the service role so RLS is dead code; Next.js path-keyed caches serving one tenant's brand to another), iOS Web Push only working after Home-Screen install, and V1 rules leaking into the schema in ways that force a V2 rewrite. All four have cheap, well-documented preventions if applied in the Foundation and Tenant Shell phases; all four are expensive to retrofit.

## Decisions Requiring User Confirmation

These emerged from research and conflict with, or sharpen, PROJECT.md. The roadmapper should treat them as blocking inputs; the user must confirm or override each.

| # | Decision | What PROJECT.md says | What research recommends | Why |
|---|----------|----------------------|--------------------------|-----|
| 1 | **Realtime = Supabase Broadcast, browser subscribes directly** | "Frontend does not talk to Supabase directly" | Allow one **read-only** exception: the browser subscribes to private Broadcast topics with `@supabase/realtime-js`; payloads are ids only; all reads/writes still go through the API | Cloud Run WebSockets have a 60-min cap, best-effort affinity, no shared state (needs Redis), and bill while sockets are open. Supabase Realtime already solves fan-out, auth (RLS on `realtime.messages`) and reconnection. Fallback (SSE from Cloud Run + Redis) is designed in if the rule must stay absolute. |
| 2 | **Supabase Auth session mechanics via `@supabase/ssr` in the Next.js server** | Same constraint | Second exception: login / refresh / password-recovery run **server-side in Next.js** (`@supabase/ssr`, HttpOnly cookies). Sign-up that binds a user to a tenant, admin creation and blocking still go through the API. Alternative: API-owned `/auth/*` endpoints with a Next.js cookie BFF (STACK.md pattern) -- purer, more code. | Supabase Auth is an identity provider, not the database; token refresh has to happen somewhere near the cookie. Either option keeps tokens out of `localStorage`. Recommend `@supabase/ssr` for the pilot; the swap is local. |
| 3 | **Identity != membership: `tenant_members` table, not `profiles.tenant_id`** | "A user belongs to exactly one tenant in V1 (schema should not preclude multi-tenant later)" | `users` (1:1 with `auth.users`) + `memberships(tenant_id, user_id, role, status)`; V1 "one tenant" enforced by a partial unique index that V2 simply drops. Roles live on the membership; `super_admin` is a separate platform table. Profile (name/avatar/bio) hangs off the membership. | Supabase Auth has one global `auth.users` per project (email unique project-wide). A `tenant_id` column on the user makes V2 multi-tenancy a rewrite of every join and policy. |
| 4 | **Video needs an external transcoding vendor (Mux or Cloudflare Stream)** | "Images, video, embeds and file attachments in V1" | Supabase Storage does not transcode. iPhone HEVC/MOV uploads will not play on Android/Chrome. Use vendor direct-upload + webhook -> `media.assets.status='ready'` + HLS player. Stream is cheaper per minute; Mux has richer SDKs/analytics. Choose in the Media phase. Only fallback: H.264 MP4 only, reject HEVC at the API. | Cloud Run also caps HTTP/1 bodies at 32 MiB, so uploads must never pass through the API regardless. |
| 5 | **Pinned-story expiry semantics** | "Stories visible for 24 h; expired stories kept; admin can pin a story to a community so it also appears there" | Recommend: **pins outlive expiry** -- a story pinned to a community stays visible on that community page after its 24 h strip window (Instagram Highlights model). Expiry is a `WHERE expires_at > now()` predicate, no cron. | This is the reason PROJECT.md keeps the record; it must be encoded explicitly or the community page silently drops pinned stories at hour 25. |
| 6 | **Supabase Pro plan is required from the pilot onward** | Not stated | Pro is needed for image transformations (thumbnails/WebP), files > 50 MB, 500 Realtime connections (Free: 200) and > 6 MB resumable uploads in practice. Two projects minimum (staging + production). | Free tier is dev-only; every media and realtime decision above assumes Pro. Budget line item. |

Secondary points the researchers disagreed on, resolved here (roadmapper can take these as given unless the user objects):

- **API framework:** Hono 4 on `@hono/node-server` (STACK.md, verified) rather than NestJS/Fastify mentioned in ARCHITECTURE.md; module boundaries are enforced by folder + lint rules, not by a DI framework. Hono's RPC client gives web<->API types with no codegen.
- **Custom Access Token Hook:** skip in V1. The API reads `memberships` per request (blocking takes effect immediately) and injects the claims RLS needs itself inside the transaction. Realtime policies use `auth.uid()` joins. Add the hook only if a Realtime policy ever needs a claim it cannot derive.
- **Likes/comments target shape:** nullable FKs + `CHECK (num_nonnulls(...) = 1)` + partial unique indexes (ARCHITECTURE.md) over a polymorphic `target_type/target_id` table (PITFALLS.md). Real FKs and cascades matter more than one-table tidiness; both are V2-safe.
- **Job queue:** pg-boss on Postgres in a separate Cloud Run worker service (same image, `ROLE=worker`, min-instances 1). No Redis, no Cloud Tasks in V1.

## Key Findings

### Recommended Stack

The fixed choices are sound; the research's contribution is the *how*. Node 24 LTS everywhere; TypeScript 7 with Biome (typescript-eslint lags TS 7 until 7.1); Next.js 16.3 App Router with Turbopack, `proxy.ts` (not `middleware.ts`), Cache Components, and `@serwist/turbopack` for the service worker (`next-pwa` is dead). API is Hono 4 with `@hono/zod-openapi`, Zod 4 shared via a `contracts` package, Drizzle ORM (the only mainstream TS ORM with first-class Supabase RLS helpers) over postgres.js through the Supavisor transaction pooler with `prepare: false`. Migrations: `drizzle-kit generate` -> `supabase/migrations` -> applied by Supabase CLI in CI (never two appliers). JWTs verified locally with `jose` against the project JWKS (ES256 asymmetric keys, not the legacy HS256 secret). Tailwind v4 `@theme inline` binds shadcn tokens to runtime `--brand-*` variables for zero-flash white-labeling. Full detail: `STACK.md`.

**Core technologies:**
- **Next.js 16.3 + React 19.3 on Vercel:** PWA shell, BFF, SSR of tenant theme -- fixed choice; 16.x specifics (Turbopack, `proxy.ts`, async `cookies()`, `useOffline`) matter for a mobile PWA
- **Hono 4.13 + Zod 4 + `@hono/zod-openapi`:** Cloud Run API -- tiny cold start, Web-standard handlers, zero-codegen RPC types for the web app
- **Drizzle 0.45 + postgres.js 3.4 + Supabase CLI 2.117:** schema, RLS policies as code, migrations -- policies live next to tables and are code-reviewed
- **`jose` 6 + Supabase JWKS (ES256):** stateless per-request auth in the API -- no Auth round trip, zero-downtime key rotation
- **Supabase Realtime Broadcast (private channels, DB triggers):** chat + notification signals -- avoids a stateful WebSocket tier on Cloud Run
- **pg-boss 12 in a Cloud Run worker:** notification fan-out, push send, link unfurl, video webhooks -- Postgres-backed, no Redis
- **Supabase Storage (signed URLs, TUS) + Mux/Cloudflare Stream:** media -- bytes never cross Cloud Run; video is transcoded to HLS
- **`@serwist/turbopack` + `web-push`:** service worker, offline shell, VAPID push
- **Tailwind 4 + shadcn/ui + next-intl:** runtime theming, pt-BR catalogue
- **pnpm 12 + Turborepo 2.10, Biome, Vitest 5, Playwright, pgTAP:** monorepo, lint, tests -- pgTAP cross-tenant negative tests are non-negotiable

### Expected Features

Table stakes are "what a tenant's members notice missing in week one", scoped to V1's admin-publishes model. Stories are **not** table stakes in this category (no comparable has them; Fleets/LinkedIn Stories died) -- they are table stakes only because the product promises them, so they must ship with the full Instagram gesture set or not at all. Several features the user did not list are cheap and expected: pin post, member directory with "hide me", per-category notification preferences with quiet defaults, member **report** action + moderation log (comments are UGC), event reminders + add-to-calendar, branded auth emails, and LGPD account deletion. Full detail: `FEATURES.md`.

**Must have (table stakes):**
- Tenant branding (logo, colors, favicon, name) applied server-side incl. per-tenant PWA manifest/icons -- the product's core value
- Feature flags per tenant driving bottom navigation *and* API 404s for disabled modules
- Rede Social platform panel: create tenant, branding, flags, first `admin_tenant`
- Public sign-up link per tenant, email/password + recovery, first-login photo/bio nudge, duplicate-email UX
- Media pipeline: multi-image, capped video, files, link previews + YouTube/Vimeo oEmbed
- Feed: chronological posts, like, comment, one-level reply, comment likes, **pin**, edit/delete, share deep link that survives login
- Communities: list/detail, community-scoped posts, `community_members` table from day one
- Stories: strip + full-screen viewer (progress, hold-to-pause, tap nav), 24 h soft expiry, seen state, like/comment, pin to community, admin view counts
- Events: list/detail, RSVP going/not going, who is going, add-to-calendar, update/cancel notices, T-24h/T-1h reminders, self check-in window + admin override, attendance list + CSV
- Support chat: one open conversation per member, realtime, attachments, unread badges, read receipts, shared support inbox
- Notifications: in-app center with grouping, per-category x per-channel preferences (quiet defaults), Web Push, iOS install guidance
- Moderation: delete comment/reply, block member (with session/Realtime/push revocation), member report + admin queue, moderation log, community rules text
- Admin panel: mobile-friendly composer, member management, reports queue, attendance, 6-8 analytics counters
- LGPD: self-service account deletion (anonymize), consent text at sign-up

**Should have (competitive):**
- Admin broadcast stories as "the organization's daily status" with viewer list and re-share-to-post -- a differentiator no community SaaS has
- Self check-in window without QR hardware -- differentiator for churches/schools/associations
- Full white-label proof points: push sender name/icon per tenant, branded emails, tenant home-screen icon
- Support chat as a first-class tenant role (help desk, not DMs)
- Deep links that re-enter the branded app after login (every WhatsApp forward becomes a re-engagement loop)
- Grouped, low-noise notifications by default

**Defer (v1.x / v2+):**
- Scheduled posts, "Maybe" RSVP + capacity, QR/geofence check-in, typing indicator, canned replies/assignment, keyword blocklist, email digest, tenant impersonation -- v1.x, mostly free once the worker exists
- Member posting, member-created communities, member-to-member chat, multi-tenant membership -- V2, all permission/index flips on the V1 schema
- Custom domains, WhatsApp channel, emoji reactions, gamification, LMS, live streaming, full offline write queues, AI moderation -- anti-features or V2+

### Architecture Approach

One shared Postgres schema, `tenant_id` on every tenant-owned row, RLS enabled everywhere, and the API -- the only Postgres client -- running each request inside a transaction that does `set_config('request.jwt.claims', ..., true); SET LOCAL ROLE authenticated` through a dedicated non-superuser DB role. A separate, explicitly named admin lane (service role) is injectable only into the `platform` module and workers. Identity is global (`users`), membership is per tenant (`memberships`), roles live on the membership, `super_admin` is a platform table. Modules (`profiles, media, feed, communities, stories, events, notifications, chat, moderation, platform`) are folders holding schema + server + contracts + UI, registered in a `MODULE_REGISTRY`, enabled per tenant in `tenant_modules`, and communicating only via a typed in-process domain event bus. One `GET /me/bootstrap` returns user, membership, tenant branding, enabled modules and counters; the authenticated Next.js layout server-renders CSS variables from it (no flash) and serves a tenant-aware manifest/icons. Realtime is Supabase Broadcast on private topics (`tenant:{tid}:user:{uid}`, `tenant:{tid}:conv:{cid}`, `tenant:{tid}:feed`) fed by `AFTER INSERT` triggers; payloads carry ids only and clients refetch via the API. Uploads go direct-to-Storage via API-brokered signed URLs (TUS above 6 MB). Full detail: `ARCHITECTURE.md`.

**Major components:**
1. **Next.js app (Vercel)** -- rendering, PWA shell, session cookies (`@supabase/ssr`), tenant theme injection, typed API client, single Realtime provider that invalidates TanStack Query keys
2. **API core kernel (Cloud Run, Hono)** -- JWKS verify, membership -> tenant context, RBAC, module registry + `requireModule` guard, `withTenantTx` RLS lane, admin lane, pg-boss jobs, domain events, `realtime.publish`
3. **Feature modules** -- `packages/modules/<name>/{db,server,contracts,ui,module.ts}`; import only core, contracts, and declared `dependsOn` contracts (lint-enforced)
4. **Worker (Cloud Run, same image)** -- notification fan-out, Web Push send, link unfurl, video webhooks, housekeeping
5. **Supabase** -- Postgres (RLS), Auth (identity only), Storage (private tenant-prefixed buckets, transforms), Realtime (Broadcast)
6. **GitHub Actions** -- `turbo lint typecheck test`, `supabase test db` (pgTAP), WIF -> Artifact Registry -> Cloud Run; Vercel Git integration with `turbo-ignore`

### Critical Pitfalls

1. **Service role as the API's default DB connection -> RLS is dead code.** Use the two-lane pattern (`withTenantTx` sets claims + `SET LOCAL ROLE authenticated`; admin lane isolated by DI + lint); seed **two tenants** in every integration test and assert zero cross-tenant rows on every list/detail endpoint. *Foundation.*
2. **Next.js path-keyed caches leak one tenant's brand/content to another on the single URL.** Every authenticated route is dynamic (read the session cookie in the root layout / `force-dynamic`); any cached tenant data has `tenantId` in the key; manifest/icons served from tenant-scoped `no-store` route handlers; `Cache-Control: private` on API responses; build-output check for "no static routes under `(app)`". *Tenant Shell.*
3. **`profiles.tenant_id` / role-specific FKs / V1 rules baked into the schema.** `memberships` table, generic `author_user_id`, `community_members` from day one, `tenant_modules` rows not boolean columns, nullable-FK targets, soft-delete/`status` columns everywhere. Ship a one-page "schema conventions" doc as a Foundation deliverable and review every migration against it. *Foundation + every feature phase.*
4. **Web Push assumed to "just work" on iOS.** iOS needs 16.4+, Home-Screen install (standalone), and a gesture-triggered permission prompt; store subscriptions per device, delete on 404/410, handle `pushsubscriptionchange`, keep in-app notifications primary. Test on a real iPhone in the Push phase, not at the end. *Tenant Shell (install flow) + Web Push.*
5. **Media proxied through Cloud Run + raw phone video stored as-is.** 32 MiB HTTP/1 cap, held instances, HEVC unplayable. API brokers signed upload URLs; private buckets with tenant-prefixed paths and storage RLS; external transcoding vendor with webhook -> `ready`; `processing` state in the UI. *Media.*

Also high-impact: synchronous notification fan-out inside the create-post request (use domain event -> pg-boss -> idempotent worker), N+1 / OFFSET pagination in the feed (one hydrated query per page, keyset cursors, `EXPLAIN` in CI), block-member that only flips a flag (per-request membership check, Realtime policy on active membership, push subscription deletion), and CI/CD/env mistakes (two Supabase projects, previews never on prod, WIF not JSON keys, migrations only via CI, `min-instances=1`). Full detail: `PITFALLS.md`.

## Implications for Roadmap

Based on research, suggested phase structure (12 phases; each deployable and testable on its own):

### Phase 1: Foundation
**Rationale:** Every later phase needs a tenant, a member, RLS, auth and flags; the isolation and schema decisions made here are the most expensive to change. CI/CD and two environments must exist before the first feature merges.
**Delivers:** Monorepo skeleton (pnpm + Turborepo, Biome, Vitest, Playwright), local Supabase stack, staging + prod Supabase projects, GitHub Actions (lint/typecheck/test/pgTAP, `supabase db push`, WIF -> Cloud Run `api` + `worker`, Vercel Git integration), core schema (`tenants`, `users`, `memberships` with V1 partial unique index, `platform_admins`, `tenant_modules`, RLS helpers, soft-delete/status conventions, chat + notification table stubs), `withTenantTx` lane + admin lane, JWKS auth middleware with per-request membership/status check, module registry + `requireModule` guard, domain event bus + pg-boss wiring, `GET /me/bootstrap`, auth flows (login/refresh/recovery via `@supabase/ssr`; `POST /public/signup/{slug}` via API), block member as membership status, "schema conventions" doc, two-tenant isolation test suite.
**Addresses:** Tenancy isolation, roles, sign-up link, auth, one-tenant-per-user (V2-safe).
**Avoids:** Pitfalls 1 (service role), 3 (identity != membership), 4 (JWT verification), 9 (V2-blocking schema), 12 (over/under-modularization), 13 (CI/CD + envs), 14 (cold starts config).
**Confirms decisions:** #2 (auth exception), #3 (memberships), #6 (Pro plan / two projects).

### Phase 2: Tenant Shell and Platform Panel
**Rationale:** Branding is the core value and touches the app shell, manifest, icons and emails; build it before any content UI or every later phase re-touches the shell. The super_admin panel is needed to create the pilot tenant at all.
**Delivers:** Authenticated `(app)` layout rendering `--brand-*` CSS variables + `theme-color` server-side from bootstrap (Tailwind `@theme inline`, shadcn tokens), bottom navigation from enabled modules, pre-login screens brandable via tenant slug / last-tenant cookie, per-tenant manifest + icon route handlers (`no-store`, `manifest.id` per tenant), icon set generation with `sharp` at logo upload, service worker shell (Serwist, offline banner, `/~offline`), iOS "Adicionar a Tela de Inicio" install guidance component (shown after a value moment), `(platform)` panel: create tenant, branding editor with live preview + contrast check, toggle modules, create first `admin_tenant`; blocked-member screen.
**Uses:** Tailwind 4 `@theme inline`, shadcn, `@serwist/turbopack`, `sharp`, Next 16 `generateMetadata`/route handlers.
**Implements:** Pattern 3 (flags -> nav), Pattern 4 (login -> tenant -> theme).
**Avoids:** Pitfalls 2 (cache leak), 5 (flash-of-wrong-brand / manifest), 6 (install flow half).

### Phase 3: Media Pipeline and Profiles
**Rationale:** Feed, stories, events, chat and branding all upload; build the broker once. Profiles are small and need avatars, so they pair naturally.
**Delivers:** `media.assets` (tenant, owner, purpose, status, provider, dimensions), private buckets with tenant-prefixed paths + `storage.objects` policies, `POST /media/uploads` -> signed URL / TUS token -> `/complete` validation (magic bytes, size caps per kind and tenant), signed serve URLs with image transform params, client-side image resize + EXIF strip, video via chosen vendor (direct upload, webhook -> `ready`, HLS player, `processing` placeholder), link-preview worker job with SSRF guard + oEmbed for YouTube/Vimeo, `tenant_usage` bytes tracking; per-membership profile (name, avatar, bio), edit own, view others, searchable member directory with "hide me".
**Uses:** `tus-js-client`, Supabase Storage transforms (Pro), `@mux/mux-node` or Cloudflare Stream, `open-graph-scraper`, pg-boss.
**Implements:** Pattern 8 (direct-to-Storage brokered by the API).
**Avoids:** Pitfall 8 (upload through API / raw video). **Confirms decision #4** (video vendor).

### Phase 4: Feed
**Rationale:** Establishes the content conventions every later module reuses: nullable-FK likes/comments, one-level reply enforcement, trigger-maintained counters, keyset pagination, hydrated single-query pages, after-commit domain events, share deep links.
**Delivers:** `feed.posts` (generic `author_user_id`, nullable `community_id`, `link_preview`, `embed`, `status`), `post_media`, `feed.comments` (depth <= 1 via trigger; `story_id` slot reserved), `feed.likes` (nullable FKs + partial unique indexes), pin post, edit/delete (soft), admin composer (desktop-first) with media/embed detection, member feed with carousel, like/comment/reply UI, share via Web Share API / copy with `returnTo` preserved through login, cross-tenant deep link -> 404, sanitized rendering, `feed.*` domain events emitted (consumed later by notifications).
**Implements:** Pattern 5 (separate content tables + nullable-FK targets).
**Avoids:** Pitfall 10 (N+1, counters, OFFSET) -- add an `EXPLAIN` + query-count check to acceptance.

### Phase 5: Communities
**Rationale:** Small phase on top of feed; needed by stories (pins) and events (community-scoped) before those modules exist.
**Delivers:** `communities.communities` + `communities.members` (open-by-default in V1, table present for V2 private communities), community list with cover/counts, community detail with scoped posts, admin create/edit, posts scoped via `community_id`, feed query = tenant-wide OR visible community.
**Avoids:** Pitfall 9 (no `community_members` = V2 rewrite of feed queries).

### Phase 6: Stories
**Rationale:** Depends on media (vertical image/video) and communities (pins). Isolated enough to ship independently; must ship with the full viewer gesture set or not at all.
**Delivers:** `stories.stories` with `expires_at` (from `tenant_modules.settings.stories.ttlHours`, default 24), `stories.community_pins`, `story_views` (seen ring + admin view counts/viewer list), strip query `expires_at > now()`, full-screen viewer (progress segments, auto-advance, hold-to-pause, tap left/right, mute, swipe), like + comment on stories (no replies, no comment likes -- API rule + trigger), admin composer with 9:16 guidance and 15-60 s video cap, pinned stories on community pages **after expiry** (per decision #5), admin story history.
**Avoids:** UX pitfall "strip shows expired / none"; Anti-pattern 9 (hard delete). **Confirms decision #5.**

### Phase 7: Events
**Rationale:** Independent content module; needs media (cover) and optionally communities. Introduces the first scheduled jobs (reminders) that later make scheduled posts nearly free.
**Delivers:** `events.events` (in_person/online, `checkin_opens_at/closes_at`, tenant timezone), `events.attendances` (one row per user, `going | not_going | checked_in` transitions), list upcoming/past, detail, RSVP + "who is going", `.ics` + Google Calendar link, online link revealed to RSVP'd only (toggle), self check-in button gated by window + admin "marcar presenca" override, attendance list (confirmed vs checked-in) + CSV, update/cancel events emitted, reminder jobs at T-24h / T-1h enqueued via pg-boss (delivered once notifications exist).
**Avoids:** Pitfall 9 (two boolean columns instead of status), UX pitfall "check-in with no window", timezone handling (store UTC, render America/Sao_Paulo, tenant tz field).

### Phase 8: Notifications and Realtime Infrastructure
**Rationale:** Producers (feed, communities, stories, events) now exist; the bell is the simplest Realtime consumer, so Realtime infra (private topics, RLS on `realtime.messages`, triggers, client provider) is stood up here and reused by chat.
**Delivers:** `notifications.notifications` (nullable FK targets, frozen `payload`, partial unread index), `notifications.preferences` (type x in_app/push, quiet defaults: likes off), worker fan-out from domain events (idempotent on `(event_id, user_id)`; single `insert ... select` for `post.published`; hourly collapse considered), like aggregation ("Ana e mais 3"), unread count endpoint, in-app center with grouping and mark-all-read, cascade on post delete / member block; Realtime: `realtime.messages` RLS via `memberships` join, `AFTER INSERT` triggers calling `realtime.send`/`broadcast_changes` on `tenant:{tid}:user:{uid}` and `tenant:{tid}:feed`, "Allow public access" disabled, browser `RealtimeClient` provider with `setAuth` on refresh invalidating TanStack Query keys, `membership.changed` signal on block.
**Uses:** pg-boss, `@supabase/realtime-js`, Drizzle `realtimeMessages.link`.
**Implements:** Pattern 7 (fan-out on write, async), Pattern 9 (Broadcast signals only).
**Avoids:** Pitfalls 11 (sync fan-out / unread drift), 7 (`postgres_changes`), 14 (work after response). **Confirms decision #1.**

### Phase 9: Web Push and PWA Hardening
**Rationale:** Depends on the notification dispatcher and the install flow; kept separate because iOS validation on real devices is its own risk and effort.
**Delivers:** `push_subscriptions` per device (endpoint unique, `failure_count`), gesture-triggered permission UI shown only in standalone mode (iOS) after install guidance, `web-push` sender in the worker (VAPID keys in Secret Manager), 404/410 cleanup, `pushsubscriptionchange` re-subscribe, minimal payloads with tenant name/icon (absolute HTTPS >= 192 px), `notificationclick` deep links (`/p/{id}`, `/chat/{id}`), Badging API, `useOffline` banner, cache strategies for shell + last feed page, real-iPhone and Android test plan.
**Avoids:** Pitfall 6 (iOS push), security "push payloads with content".

### Phase 10: Support Chat
**Rationale:** Reuses Realtime topics, worker, push and unread patterns from Phases 8-9; the schema has existed since Foundation.
**Delivers:** `chat.conversations` (`kind` support/direct/group), `chat.participants` (`role` member/agent, `last_read_at`), `chat.messages` with per-conversation `seq` ordering, one open support conversation per member (partial unique index), get-or-create endpoint, keyset `?after=seq` catch-up on reconnect, triggers broadcasting to `tenant:{tid}:conv:{cid}`, the member's user topic and `tenant:{tid}:support-inbox`, RLS on `realtime.messages` joining `chat.participants`, attachments via media pipeline, read receipts, unread badges, member chat screen, shared support inbox for `support_tenant`/`admin_tenant` sorted by `last_message_at` with unread counts, `chat.message` notifications + push, typing indicator as client->client Broadcast if cheap.
**Implements:** Pattern 6 (generic conversations, support as a kind).
**Avoids:** Pitfall 7 (ordering, non-participant subscription, hard-coded support user).

### Phase 11: Moderation and Admin Panel
**Rationale:** Data rules (soft delete, membership status, moderation log) exist since Foundation/Feed; the screens are thin but the feature set (report, log, analytics) is expected by tenant admins and is cheap.
**Delivers:** Admin delete any comment/reply/story comment (soft, cascades to replies and notifications), block/unblock with Realtime + push revocation and sign-out, member management (list/search/role change/remove), member **report** action + admin reports queue + notification to admins, `moderation_log` append-only, tenant-editable community rules + Rede Social terms shown at sign-up, event attendance views, 6-8 analytics counters with date range, support-role assignment, platform panel tenant list/status.
**Avoids:** Pitfall 15 (moderation that doesn't take effect).

### Phase 12: Pilot Hardening
**Rationale:** Verification gate before the pilot tenant goes live; closes the "looks done but isn't" checklist.
**Delivers:** Two-tenant isolation suite run against every endpoint (incl. storage URLs and Realtime topics), build-output check for static routes under `(app)`, pgTAP RLS negative tests complete, `EXPLAIN` checks on feed/notifications/chat queries with 10k-row seed, LGPD self-service account deletion (anonymize) + consent text + data export path, pt-BR string extraction into one `next-intl` catalogue (no literals), a11y pass, Sentry + pino/Cloud Logging with `tenant_id`/`request_id`, Cloud Run config in git (`min-instances=1`, `cpu-boost`, timeouts), backups/PITR, rollback rehearsal, real-device PWA install + push smoke test on iOS and Android, CORS locked to the single origin in prod.

### Phase Ordering Rationale

- **Kernel and pipeline before features:** Foundation -> Tenant Shell -> Media is the dependency spine every content module rests on (tenant, RLS lane, flags, branding, uploads). Getting these wrong is the only category of mistake that forces rewrites (Pitfalls 1, 2, 3, 5, 8, 9, 13).
- **Feed first among content modules** because it proves the conventions (nullable-FK targets, counters, keyset pagination, domain events) that communities, stories, events, notifications and chat then copy rather than reinvent.
- **Communities before stories and events** because both reference communities (pins, scoped events); stories before events only because stories are smaller and fully independent of scheduling.
- **Notifications after all producers**, and Realtime infra introduced there rather than in chat, because the bell is the lowest-risk realtime consumer and gives chat a working transport, RLS shape and client provider to reuse.
- **Push separate from in-app notifications** so iOS device validation is a first-class deliverable, not an afterthought.
- **Chat late but chat tables early** (Foundation stubs) so the schema is reviewed against the V2 member-to-member requirement before any UI exists.
- **Moderation UI late but moderation data early**: `status`/`deleted_at`/membership status columns are Foundation conventions; only the screens are deferred.
- **Hardening as an explicit phase** because the pitfalls research shows most tenancy leaks are invisible with single-tenant test data; the two-tenant suite is the gate for "pilot live".

### Research Flags

Phases likely needing deeper research during planning (`/gsd-plan-phase --research-phase <N>`):
- **Phase 1 (Foundation):** exact Supavisor transaction-mode behavior with `SET LOCAL ROLE` + `set_config(..., true)`; dedicated `api_user` role grants; pg-boss transactional enqueue with Drizzle; Supabase asymmetric key enablement + `@supabase/ssr` 0.12 cookie flow in Next 16 `proxy.ts`. High cost of error; verify with a spike before schema freeze.
- **Phase 3 (Media):** vendor choice Mux vs Cloudflare Stream (pricing verified at phase start), TUS on mobile Safari over throttled networks, Supabase image transform signed-URL semantics, SSRF-safe unfurl implementation.
- **Phase 8 (Notifications/Realtime):** shape and cost of RLS policies on `realtime.messages` (membership join vs claim), `realtime.send` vs `broadcast_changes` trigger choice, connection quota sizing and add-on pricing beyond Pro, hybrid eager/lazy strategy for "new post" broadcasts.
- **Phase 9 (Web Push):** `@serwist/turbopack` route setup under Next 16.3, iOS 16.4+ standalone gating, Badging API support matrix, Declarative Web Push (Safari 18.4) relevance.
- **Phase 10 (Chat):** per-conversation `seq` generation under concurrent inserts, catch-up cursor semantics, private-channel authorization tests for non-participants.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Tenant Shell):** Tailwind `@theme inline`, dynamic manifest route handlers and force-dynamic segments are well documented; needs a review gate (build-output check, two-tenant smoke test), not more research. Exception: if the user rejects decision #2, the auth BFF needs a design pass.
- **Phase 4 (Feed), Phase 5 (Communities), Phase 6 (Stories), Phase 7 (Events):** conventional CRUD + Postgres patterns; risks are covered by the conventions doc and acceptance checks (`EXPLAIN`, query count, depth trigger).
- **Phase 11 (Moderation/Admin):** thin screens over existing columns.
- **Phase 12 (Hardening):** checklist-driven.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Every version verified on npm 2026-09-11 and every architectural claim against current official docs (Next 16.3, Supabase, Drizzle, Hono, Cloud Run). MEDIUM where the ecosystem is moving: TypeScript 7 tooling gaps, `@serwist/turbopack`, Drizzle RLS helpers, Supavisor + `SET LOCAL ROLE`. Framework comparison (Hono vs Fastify/NestJS) is opinion aligned with docs. |
| Features | MEDIUM | Competitor claims cross-checked across 2+ sources but vendor help pages were only readable as snippets. "No competitor has stories" is an absence-of-evidence claim (LOW). LGPD, iOS push and events norms are well corroborated. |
| Architecture | MEDIUM | Official-doc findings (RLS bypass by service role, Broadcast authorization, Storage signed uploads, Cloud Run limits) are strong; shared-schema, memberships, nullable-FK targets and fan-out patterns are ecosystem consensus. Not measured: Supavisor `SET LOCAL ROLE` behavior, pg-boss + Drizzle transactional enqueue, Realtime add-on pricing. |
| Pitfalls | MEDIUM | Tenancy, auth, RLS, Realtime, Cloud Run, iOS push and Storage pitfalls are verified against official docs; feed-counter, fan-out and cold-start numbers rest on community sources (LOW) but are consistent with general Postgres/Cloud Run practice. |

**Overall confidence:** MEDIUM -- high enough to structure the roadmap and start Foundation; the open items are implementation details to validate with spikes in Phases 1, 3 and 8, plus the six product decisions above.

### Gaps to Address

- **Six user decisions** (Realtime exception, auth exception, memberships, video vendor, pinned-story expiry, Pro plan): block on confirmation before requirements are finalized; record outcomes in PROJECT.md Key Decisions.
- **RLS-in-transaction under Supavisor transaction pooling:** design assumes `set_config(..., true)` + `SET LOCAL ROLE` die with the transaction on a pooled connection. Validate with a Foundation spike and a pgTAP/integration test before any feature table exists; fallback is a per-request Supabase client with the user JWT (PostgREST path).
- **Video vendor and cost model:** pricing figures in research are LOW confidence; verify on vendor pages at Media phase start. Decide whether the pilot tenant can defer video entirely if budget is tight.
- **Realtime capacity beyond Pro (500 connections):** enough for the pilot; add-on pricing and the SSE fallback trigger point need numbers before tenant #2-#10.
- **"New post to every member" notification strategy** (eager rows vs lazy render vs hourly collapse): decide in Phase 8 with pilot member count in hand.
- **Branded auth emails:** Supabase templates are per project; V1 accepts a neutral platform template or uses the Send Email hook. Decide in Phase 2; cheap either way but visible to members.
- **Events timezone model:** Brazil has multiple zones; store UTC + tenant timezone field; confirm pilot tenant's zone handling in Phase 7.
- **TypeScript 7 tooling:** if any tool needs the TS JS API before 7.1 ships, alias to TS 6 per STACK.md fallback; check at repo bootstrap.
- **LGPD scope for the pilot:** research covers mechanics (consent, deletion, export, logs), not legal review; flag for the user before pilot go-live.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`, 2026-09-11) -- every version and peer/engine range in STACK.md
- https://nextjs.org/docs/app/guides/progressive-web-apps, https://nextjs.org/blog/next-16, https://nextjs.org/blog/next-16-3 -- PWA guide, Turbopack default, `proxy.ts`, Cache Components, TS 7 support, `useOffline`
- https://supabase.com/docs/guides/auth/signing-keys, .../auth/jwts, .../auth/auth-hooks/custom-access-token-hook -- ES256/JWKS verification, hook contract
- https://supabase.com/docs/guides/realtime/broadcast, .../authorization, .../limits, .../benchmarks, .../postgres-changes -- Broadcast from DB, private channels, RLS on `realtime.messages`, quotas, `postgres_changes` limits
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads, .../file-limits, .../serving/image-transformations -- TUS, plan limits, Pro-only transforms
- https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv and the service-role RLS troubleshooting page -- RLS performance, service-role bypass
- https://orm.drizzle.team/docs/rls, https://orm.drizzle.team/docs/connect-supabase -- RLS helpers, pooler `prepare: false`
- https://docs.cloud.google.com/run/docs/triggering/websockets, https://docs.cloud.google.com/run/quotas -- 60-min cap, affinity, 32 MiB bodies, billing
- https://tailwindcss.com/docs/theme, https://hono.dev/docs/guides/rpc, https://serwist.pages.dev/docs/next/turbo, https://vercel.com/docs/monorepos/turborepo, https://github.com/google-github-actions/deploy-cloudrun -- theming, RPC, SW, monorepo, WIF deploy
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/, https://developer.apple.com/app-store/review/guidelines/ -- iOS push requirements, UGC baseline

### Secondary (MEDIUM confidence)
- https://github.com/orgs/supabase/discussions/30124 -- running queries as `authenticated` over a direct connection (Supabase collaborator)
- Multi-tenant Postgres guides (ClickHouse, PlanetScale, dev.to 2026) -- shared schema + memberships consensus
- GitLab database guidelines on polymorphic associations -- nullable-FK preference
- Competitor docs/reviews: Circle, Mighty Networks (official docs fetched for events/pinning), Skool, Bettermode, Kajabi, Disciple, BuddyBoss, Subsplash/Pushpay -- feature landscape
- Pushpad / OneSignal / MagicBell iOS Web Push write-ups; Luma check-in docs; LGPD overviews (securiti.ai, IAPP)
- Next.js discussions #45457, #85239, #20841, #56455, #76661, #95633 -- single-domain cache leaks, env var inlining, TS 7 detection
- Supabase discussions #1615, #19420, #18002, #2178; supabase-js issue #1936 -- global email uniqueness, no transcoding, server-side `channel.send` bug

### Tertiary (LOW confidence)
- Framework comparisons (encore.dev, betterstack) -- Hono positioning
- Video pricing comparisons (buildmvpfast, leanopstech) -- Mux vs Cloudflare Stream costs; re-verify at Media phase
- Likes/counter/pagination and notification fan-out architecture posts (algomaster, cybertec, codelit, medium) -- patterns consistent with Postgres practice
- "No community SaaS has stories" -- absence in search, not vendor confirmation
- Cloud Run cold-start numbers and Supabase Realtime add-on pricing -- community figures

---
*Research completed: 2026-09-11*
*Ready for roadmap: yes -- pending user confirmation of the six decisions above*
