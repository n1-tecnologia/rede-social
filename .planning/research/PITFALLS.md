# Pitfalls Research

**Domain:** Multi-tenant, white-label community / social-network SaaS (Next.js PWA on Vercel + Node/TS API on Cloud Run + Supabase Postgres/Auth/Storage/Realtime), single URL for all tenants, admin-only authoring in V1, schema must survive V2
**Researched:** 2026-09-11
**Confidence:** MEDIUM overall — tenancy, auth, RLS, Realtime, Cloud Run, iOS push and Storage claims are verified against official docs (MEDIUM); feed-counter, notification-fan-out and cold-start guidance rest on community sources (LOW) and are marked as such.

Phase names used below are *suggested* roadmap phases: **Foundation** (repo, CI/CD, Supabase project, API skeleton, tenant/user/role schema, RLS, auth) → **Tenant Shell** (branding, PWA shell, manifest, feature flags, navigation) → **Profiles** → **Feed + Media** → **Communities** → **Stories** → **Events** → **Notifications** → **Chat** → **Moderation + Platform Panel** → **Pilot Hardening**. Rename freely; the mapping is by topic.

---

## Critical Pitfalls

### Pitfall 1: The API uses the service-role key for everything, so RLS is dead code

**What goes wrong:**
The project's architecture says "the central API is the only Supabase client." The obvious implementation is one `createClient(url, SERVICE_ROLE_KEY)` singleton. A client authorized with the service role **always bypasses RLS** — it is the `bypassrls` database owner role. From that moment, tenant isolation depends 100% on every single query remembering `.eq('tenant_id', ...)`. One forgotten filter on a list endpoint, one `findById` with no tenant check, one "share link" resolver that loads a post by id — and tenant A's members read tenant B's content. The PROJECT.md requirement "enforced at DB level" is silently unmet.

**Why it happens:**
Service role is the path of least resistance when the browser never talks to Supabase; the team reasons "we own the API, we'll filter." Tests don't catch it because dev databases have one tenant (the pilot), so a missing filter returns correct-looking data. [MEDIUM — Supabase RLS docs, makerkit, dev.to]

**How to avoid:**
- Run user requests **as the user**, not as the owner. Two workable options for a Node API:
  1. Per-request Supabase client created with the anon/publishable key plus the caller's JWT forwarded in `Authorization` (so Postgres runs as `authenticated` with `auth.uid()`/`auth.jwt()` populated and RLS applies); or
  2. Direct Postgres connection (pg/Drizzle/Kysely) that wraps each request in a transaction and does `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '<json>'` (or a custom `app.tenant_id` setting read by policies via `current_setting('app.tenant_id', true)`).
- Put `tenant_id` into the JWT as an `app_metadata` claim at signup/provisioning (Auth Hook or admin API) so policies read `(select auth.jwt() -> 'app_metadata' ->> 'tenant_id')` without a join.
- Keep a **separate, explicitly named** admin client (`supabaseAdmin`) for provisioning, cron jobs, and super_admin panel operations; lint-forbid importing it from feature modules.
- Every tenant-scoped table: `tenant_id uuid not null references tenants(id)`, RLS enabled, policy `tenant_id = <claim>` for `TO authenticated`, plus a **composite index leading with `tenant_id`**.
- Add a **two-tenant isolation test** to CI from Foundation onward: seed tenant A and B, call every list/detail endpoint as A, assert zero B rows. Grep-based guard: any `from('<tenant_table>')` call in feature code without a tenant filter fails review.

**Warning signs:**
`SUPABASE_SERVICE_ROLE_KEY` imported in more than one file; RLS policies exist but `EXPLAIN` shows no policy filter being applied; integration tests only ever seed one tenant; "we'll add RLS later."

**Phase to address:**
**Foundation** (define the per-request DB identity pattern before the first feature table exists). Verified again in **Pilot Hardening** with the two-tenant test suite.

---

### Pitfall 2: Next.js caches one tenant's branding/content and serves it to another on the single URL

**What goes wrong:**
All tenants share `app.seusistema.com/feed`. Any Next.js caching keyed by path — full route cache/ISR, `generateMetadata`, `'use cache'` functions, `fetch()` data cache with a shared key, `app/manifest.ts`, `icon`/`favicon` routes — is keyed by URL, not by tenant. The first tenant to render `/feed` populates the cache; the next tenant gets the first tenant's logo, colors, display name or, worse, feed HTML. Also: runtime values (`cookies()`, `headers()`) **cannot be passed as arguments into `'use cache'` functions** — attempting per-tenant caching this way errors at prerender. [MEDIUM — Next.js discussions #45457, #85239, #20841; Next.js cache docs]

**Why it happens:**
Next.js defaults reward static rendering; branding "looks static"; `generateMetadata` and `manifest.ts` feel like build-time files. Single-domain multi-tenancy removes the natural cache partition that hostnames provide.

**How to avoid:**
- Treat **every authenticated route as dynamic**: read the session cookie in the root layout (this alone opts the route out of static rendering), or set `export const dynamic = 'force-dynamic'` on the app segment. Don't use ISR for anything behind login in V1.
- If you cache tenant-derived data (branding, feature flags), the cache key **must** contain the tenant id explicitly: `unstable_cache(fn, ['branding', tenantId])` or `'use cache'` with `tenantId` passed as a plain argument that you resolved *outside* the cached function. Never `'use cache'` a function that internally calls `cookies()`.
- Route `manifest`, `favicon`, `apple-touch-icon` through a **tenant-aware route handler** with `Cache-Control: private, no-store` (or a tenant-suffixed path like `/t/{tenantSlug}/manifest.webmanifest`, see Pitfall 5).
- On the API side (Cloud Run), never use an in-process cache without a tenant-prefixed key; the classic bug is `${tenantId}:branding` becoming `undefined:branding` when the variable is misnamed, silently sharing one entry across all tenants.
- Set `Vary`/`Cache-Control: private` on API responses; never let Vercel's CDN cache an authenticated API response.

**Warning signs:**
A page under `/app` shows "○ (Static)" in the build output; `generateMetadata` doesn't read the session; seeing another tenant's logo after switching test accounts in the same browser profile; `manifest.ts` returning a constant.

**Phase to address:**
**Tenant Shell** (branding delivery) with an explicit build-output check ("no static routes under the authenticated segment") and a manual two-tenant smoke test. Re-checked in **Pilot Hardening**.

---

### Pitfall 3: Supabase Auth has one global `auth.users` — email uniqueness collides with per-tenant signup and V2 multi-tenant membership

**What goes wrong:**
Supabase Auth enforces **one email = one account per project**. Tenant A's public signup link and tenant B's link both write to the same `auth.users`. Consequences: (a) a person who already exists in tenant A cannot sign up to tenant B with the same email (V2 blocker); (b) if signup stores `tenant_id` only in profile data, a naive implementation lets a user log in and be resolved to the *wrong* tenant, or to none; (c) password-recovery emails go out with TRIA's generic Supabase template, not the tenant's brand. [MEDIUM — Supabase discussions #1615/#19420, community write-ups]

**Why it happens:**
Teams model "user belongs to one tenant" as a column on `profiles` and forget that identity (auth) and membership (tenant) are different things. V1's "exactly one tenant" rule hides the problem until V2.

**How to avoid:**
- Model **identity ≠ membership** from day one: `auth.users` (identity) → `users/profiles` (1:1, global) → `tenant_members (tenant_id, user_id, role, status, joined_at)` (membership, unique on `(tenant_id, user_id)`). V1 enforces "one active membership per user" with a partial unique index or app rule; V2 drops that rule — no rewrite.
- Roles live on `tenant_members.role`, **not** on the user. `super_admin` is a platform-level flag on the user or a separate `platform_staff` table, never a tenant role.
- Signup flow: the public link carries a tenant slug/invite token; the API creates the auth user with the admin client **and** inserts the membership in the same request; put `tenant_id` (V1: the single active tenant) into `app_metadata` via Auth Hook / admin update so RLS can read it from the JWT. Design the JWT claim as "active tenant" so V2 can switch it.
- If an email already exists at signup for another tenant, V1 should show a clear pt-BR message ("este e-mail já está cadastrado; entre e peça acesso") rather than a 500 — and log it as a V2 signal.
- Brand the auth emails: Supabase email templates are per project; either use one neutral TRIA template in V1 (accepted, cheap) or send auth emails yourself via the Send Email Auth Hook with tenant branding (defer unless the pilot complains).

**Warning signs:**
`profiles.tenant_id` with no membership table; `role` column on `profiles`; signup implemented with client-side `supabase.auth.signUp` (violates "frontend never hits Supabase" *and* skips membership creation); tests never sign up the same email twice.

**Phase to address:**
**Foundation** (schema + signup flow). Blocking for V2 if wrong.

---

### Pitfall 4: Verifying Supabase JWTs the wrong way in the custom API

**What goes wrong:**
Three common failures: (1) the API calls `supabase.auth.getUser(token)` on every request, adding an Auth-server round trip to every API call (latency + Auth rate limits); (2) the API verifies JWTs against the **legacy HS256 shared JWT secret**, which breaks the moment keys are rotated and means the secret lives in Cloud Run env; (3) the API caches JWKS forever (or never) — Supabase itself caches keys ~10 min at edge + ~10 min in client libs, so a revoked key can be trusted for ~20 min unless you build cache-busting. [MEDIUM — supabase.com/docs/guides/auth/signing-keys]

**How to avoid:**
- Enable **asymmetric JWT signing keys** on the Supabase project at creation. In the API, verify locally with `jose`'s `createRemoteJWKSet('https://<ref>.supabase.co/auth/v1/.well-known/jwks.json')` (handles `kid` lookup and refresh) — or `supabase.auth.getClaims()`. Never store the JWT secret in Cloud Run.
- Validate `aud`, `exp`, and read `sub` and `app_metadata.tenant_id` from claims; then load membership/role from `tenant_members` (cheap, indexed) — do **not** trust a role claim alone unless you also invalidate JWTs on role change (blocking a member must take effect before token expiry; see Pitfall 15).
- Session handling on the Next.js side: the browser must hold the Supabase session (cookie via `@supabase/ssr`) and forward the access token to the API; refresh happens in the Next.js layer. Decide this explicitly — "frontend never talks to Supabase" must have the exception "except Auth token refresh," or route refresh through the API too (more work; not recommended).

**Warning signs:**
`SUPABASE_JWT_SECRET` in the API env; `getUser()` in the auth middleware; no `aud`/`exp` check; membership status not checked per request.

**Phase to address:**
**Foundation**.

---

### Pitfall 5: Flash-of-wrong-brand and the per-tenant PWA manifest/favicon on one origin

**What goes wrong:**
Branding applied client-side after a fetch produces a visible flash of TRIA-default (or previous tenant's) colors/logo on every cold load — fatal for the core value "feels like *their* app." Separately, PWA install artifacts are per-origin and **captured at install time**: iOS and Android read the manifest (`name`, `icons`, `theme_color`, `start_url`) when the user taps "Add to Home Screen" and don't reliably re-read it. A static manifest means every tenant's home-screen icon is TRIA's. Two installs of the same origin collide unless `manifest.id` differs. [MEDIUM — web.dev manifest, Next.js PWA guide, WebKit blog; LOW for iOS re-read behavior]

**How to avoid:**
- Render branding **server-side on first paint**: the root layout resolves the tenant from the session cookie (via the API), and emits CSS custom properties inline in `<html style="--brand-primary:...">` plus `<meta name="theme-color">`. Client components only *consume* variables. Store a lightweight "last tenant branding" copy in a cookie/localStorage as a paint fallback while logged out.
- Pre-login screens (login, signup via tenant link) must be brandable too: the signup link carries the tenant slug, the login page reads a `tenant` cookie set on last visit — otherwise the first screen is always unbranded.
- Serve manifest and icons from tenant-scoped, **non-cached** route handlers: `/api/pwa/{tenantSlug}/manifest.webmanifest`, icons at `/api/pwa/{tenantSlug}/icon-192.png` (generated from the uploaded logo, padded/maskable). Set `<link rel="manifest">` dynamically per tenant, and set `manifest.id` and `start_url` to a tenant-specific value so installs don't collide.
- Accept and document the limitation: rebranding after install won't update the home-screen icon until reinstall.
- Pre-generate icon sizes (192, 512, apple-touch 180) at logo upload time in the platform panel; don't generate on request.

**Warning signs:**
`useEffect` that sets theme after fetch; static `public/manifest.json`; a single `app/icon.png`; theme flicker visible on hard reload; two tenants' installs sharing one icon on a test phone.

**Phase to address:**
**Tenant Shell**. Icon generation belongs with the **Moderation + Platform Panel** branding editor (or earlier if the super_admin panel is built in Foundation).

---

### Pitfall 6: Web Push assumed to "just work" on iOS

**What goes wrong:**
The pilot's members are mostly on mobile Safari. Web Push on iOS requires **iOS 16.4+, the app added to the Home Screen with `display: standalone|fullscreen`, and the permission request inside a direct user gesture**. Opening the same site in a Safari tab has **separate storage** and no push. Push subscriptions expire; sending to a dead one returns **410 Gone** and must delete the row. iOS drops subscriptions when the user removes the icon; permission denied once is hard to recover. In the EU, PWAs may open in Safari tabs, disabling push and badges entirely. [MEDIUM — WebKit blog 13878; Pushpad; MDN]

**How to avoid:**
- Design the onboarding as a two-step funnel: (1) "Instale o app" instructions with iOS-specific "Compartilhar → Adicionar à Tela de Início" guidance, detected via `navigator.standalone` / `display-mode: standalone`; (2) only *inside standalone mode*, a button "Ativar notificações" that calls `Notification.requestPermission()` in the tap handler. Never prompt on page load.
- Store subscriptions per device: `push_subscriptions (user_id, tenant_id, endpoint unique, p256dh, auth, user_agent, created_at, last_success_at)`. On send, handle 404/410 by deleting; on 429/5xx, retry with backoff. Handle `pushsubscriptionchange` in the SW by re-subscribing and POSTing the new endpoint.
- Use the Badging API (`setAppBadge(unreadCount)`) from the SW on push receipt and from the page on focus — it's the only iOS-native-feeling signal you get.
- Keep push payloads small and always include absolute HTTPS icon URLs (≥192px) — broken icon URLs cause notifications to render with no icon or not at all.
- Make in-app notifications the **primary** channel and push the enhancement. Never gate a feature on push having succeeded.
- Test on a real iPhone with the pilot tenant early (Notifications phase), not at the end.

**Warning signs:**
`requestPermission()` in `useEffect`; no `410` handling; single subscription per user; no standalone-mode detection; only Android/Chrome tested.

**Phase to address:**
**Notifications**; the install-instructions flow belongs in **Tenant Shell**.

---

### Pitfall 7: Realtime chat built on `postgres_changes` or on Cloud Run WebSockets without knowing the limits

**What goes wrong:**
Two failure modes. (a) **Supabase `postgres_changes`**: processed on a single thread to preserve order and **authorizes every change against every subscriber** — with RLS on a Large+ database, 500 connected clients cap at ~40 changes/s, 4,000 clients at ~5 changes/s. Fine for the pilot, a wall for V2 member↔member chat. (b) **WebSockets on Cloud Run**: subject to the request timeout (default 5 min, max 60 min) even if the server never times out; HTTP/2 end-to-end must stay off; session affinity is best-effort; any open socket keeps the instance active and **billed**; multiple instances don't share state, so a message received on instance 1 isn't seen by a socket on instance 2 without Redis Pub/Sub. Also a common ordering bug: clients render in arrival order, and messages from two instances/retries interleave. [MEDIUM — supabase.com/docs/guides/realtime/benchmarks; docs.cloud.google.com/run/docs/triggering/websockets]

**How to avoid:**
- **Don't run WebSockets on the Cloud Run API in V1.** Let Supabase Realtime carry the transport: the API writes the message row (authorized, validated, tenant-scoped), then either a DB trigger calls `realtime.broadcast_changes()` on a private channel `tenant:{tenant_id}:conversation:{id}`, or the API broadcasts via the Realtime REST endpoint. Clients subscribe with their JWT; **Realtime Authorization** RLS on `realtime.messages` restricts who can join the channel (participants only).
  - This is the one place the frontend talks to Supabase (Realtime subscribe). Record it as an explicit exception to "API is the only client," with reads/writes still going through the API.
- Source of truth is the DB: messages carry `(conversation_id, created_at, id)` with a monotonic ordering key (use `id` from a sequence or a `seq bigint` per conversation); the client sorts by that, dedupes by `id`, and on reconnect fetches `?after=<last_seq>` from the API. Broadcast is a hint, not the record.
- Schema: `conversations (tenant_id, type: 'support'|'direct'|'group', created_by)`, `conversation_participants (conversation_id, user_id, role, last_read_seq)`, `messages (conversation_id, seq, sender_id, body, kind)`. V1 "support" is a `type` with participants = member + support pool; V2 adds `direct` without touching the tables.
- Support inbox needs "unassigned conversations" — model `support_assignments` or a nullable `assigned_to` on the conversation, not a hard-coded "support user id."
- If a self-hosted WS server is ever needed: set Cloud Run timeout to 3600s, implement client reconnect with backoff, add Redis Pub/Sub, use min-instances ≥1, and budget for always-on billing.

**Warning signs:**
`.on('postgres_changes', ...)` on the `messages` table; `ws` or `socket.io` in the API dependencies; message order determined by array push order; no `seq`/cursor endpoint; "support" hard-coded as a participant lookup by role.

**Phase to address:**
Schema in **Foundation** (chat tables ship with the initial migration set even if the UI is later); transport in **Chat**.

---

### Pitfall 8: Media upload proxied through the API — Cloud Run's 32 MiB limit, no transcoding, unbounded storage cost

**What goes wrong:**
Uploading a video by POSTing bytes to the Cloud Run API hits the **32 MiB request limit on HTTP/1** (no limit on HTTP/2, but HTTP/2 end-to-end conflicts with WebSockets and adds config), holds an instance for the whole upload, and doubles bandwidth. Then the raw phone video (H.265/HEVC, 4K, 200 MB) is stored as-is in Supabase Storage: it won't play in many browsers, costs egress on every view, and never gets a poster/thumbnail. Supabase Storage **does not transcode video**. Standard uploads cap at 5 GB and are unreliable above ~6 MB; resumable (TUS) uploads go to 50 GB on Pro+. [MEDIUM — Cloud Run quotas; Supabase upload-size troubleshooting; Storage v3 blog]

**How to avoid:**
- **Direct-to-storage uploads**: the API issues a short-lived **signed upload URL** (or TUS resumable session) for a tenant-prefixed path `tenant/{tenant_id}/posts/{post_id}/{uuid}.{ext}`; the browser uploads straight to Supabase Storage using the direct storage hostname; the API then records the `media` row and validates the object (size, mime via magic bytes, tenant prefix). The API never carries file bytes.
- Storage RLS on `storage.objects`: `(storage.foldername(name))[1] = 'tenant'` and `[2] = <tenant claim>`; buckets **private**; reads via signed URLs generated by the API with short TTL (or via image-transform signed URLs for thumbnails). Never public buckets for tenant content — a guessable public URL is cross-tenant leakage.
- Video: pick **a managed transcoding service in V1** (Cloudflare Stream or Mux — Stream is markedly cheaper for VOD: ~$1/1,000 min stored + $5/1,000 min delivered, encoding included, vs Mux's separate encoding/delivery fees). Client uploads to the service via its direct-upload URL; the webhook flips `media.status` from `processing` to `ready` with an HLS URL and poster. Self-hosting ffmpeg on Cloud Run is only worth it at very high steady volume. [LOW on pricing specifics — verify on vendor pages when the Feed + Media phase starts]
- Images: resize/strip EXIF client-side before upload (max ~2048 px, WebP/JPEG) and use Supabase image transforms for thumbnails; enforce per-tenant caps (max file size, max files per post) in the API and bucket config.
- Files (PDF etc.): size cap per tenant plan field; serve via signed URL with `Content-Disposition`.
- Track storage bytes per tenant (`tenant_usage`) from day one so billing later has data.

**Warning signs:**
`multer`/`busboy` in the API; `<video src=...mp4>` pointing at the raw upload; public bucket; no `media.status` column; no per-tenant size limits; upload "works" on Wi-Fi with a 5 MB clip only.

**Phase to address:**
**Feed + Media** (this phase needs its own deeper research on the transcoding vendor; flag it).

---

### Pitfall 9: Schema decisions that force a V2 rewrite

**What goes wrong:**
V1 rules ("only admin posts," "only admin creates communities," "support-only chat," "one tenant per user") get baked into the schema instead of into permissions. Examples: `posts.author_id` referencing an `admins` table; `communities.admin_id`; `messages.from_support boolean`; `profiles.tenant_id` (see Pitfall 3); story comments modeled in a separate `story_comments` table with different columns from `comments`; likes in three tables (`post_likes`, `comment_likes`, `story_likes`).

**How to avoid:**
- Authorship is always a `users.id` (`author_id`); *who may author* is a permission check in the API (`can('post.create', membership)`), gated by a per-tenant policy (`tenant_settings.member_posting_enabled = false` in V1). Flipping V2 on is a settings change plus UI.
- One polymorphic-but-typed reaction table: `reactions (tenant_id, user_id, target_type enum('post','comment','story'), target_id, kind default 'like', unique(user_id,target_type,target_id))`. One `comments` table with `target_type`, `parent_id` (nullable, one level enforced by API + check that `parent.parent_id is null`), and a per-target-type rule for "no replies on stories" in the API. Emoji reactions in V2 = new `kind` values.
- `posts.community_id nullable` — a post may or may not belong to a community. Stories: `stories` + `story_pins (story_id, community_id)` (pinning to many communities later is free).
- Communities: `community_members` from day one even if V1 auto-joins everyone — otherwise "private communities" in V2 rewrites feed queries.
- Events: `event_attendance (event_id, user_id, status enum('rsvp','checked_in','cancelled'), rsvp_at, checked_in_at)`; one row per user, status transitions, not two boolean columns.
- Feature flags: `tenant_features (tenant_id, feature_key, enabled, config jsonb)` — not boolean columns on `tenants` (adding a module = new row, not a migration); the API exposes `/me/tenant` returning enabled modules to drive navigation.
- Soft-expiry for stories: `expires_at` column + query filter `expires_at > now()`; **no job needed** to hide them. A job is only needed if you want to *notify* or archive; don't build a cron in V1 for something a `WHERE` does.
- All tenant-scoped tables carry `tenant_id` even when derivable via a join (needed for RLS and indexes; denormalization is intentional).

**Warning signs:**
Any FK to a role-specific table; boolean columns named after V1 roles; per-feature copies of `likes`; feature toggles as columns; story visibility computed by a cron.

**Phase to address:**
**Foundation** for the core (tenants, members, roles, features, reactions, comments); each feature phase adds its tables following the same conventions. A short "schema conventions" doc is a deliverable of Foundation.

---

### Pitfall 10: Denormalized counters and pagination that break the feed

**What goes wrong:**
(a) The feed does N+1: one query for posts, then per post: author, media, like count, comment count, "liked by me." With 20 posts × 5 queries = 100 round trips per page from Cloud Run to Supabase (cross-region latency compounds). (b) `like_count` maintained by an `UPDATE posts SET like_count = like_count + 1` on every like becomes a hot row on popular posts (lock contention, MVCC bloat); worse, counters drift when a like insert succeeds but the update fails. (c) `OFFSET` pagination on an insert-heavy feed skips/duplicates posts as new content arrives and gets slower with depth. [LOW — community sources; consistent with general Postgres practice]

**How to avoid:**
- One feed endpoint that returns a fully hydrated page: post + author + media[] + counts + `viewer_has_liked` via a single SQL statement (CTE/lateral joins) or batched `IN (...)` lookups. Enforce a "max 3 queries per page" rule in code review.
- At pilot scale, **counts computed by the DB inside the page query** (subselect with index on `reactions(target_type, target_id)`) are fine and never drift. If you denormalize, do it in the same transaction as the reaction insert/delete (trigger), and keep the source table authoritative so a nightly recount can repair drift.
- **Keyset pagination**: `WHERE (created_at, id) < ($cursor_ts, $cursor_id) ORDER BY created_at DESC, id DESC LIMIT 20`, with index `(tenant_id, community_id, created_at DESC, id DESC)`; opaque base64 cursor in the API. Same pattern for comments, notifications, messages.
- Comments: return top-level page + first N replies per comment in one query; "view more replies" is a separate keyset call.
- Add an EXPLAIN check to CI for the feed query as part of Feed + Media acceptance.

**Warning signs:**
`page=2&limit=20`; loops with `await` inside `map`; `like_count` column with no reconciliation; slow feed only after seeding 5k posts.

**Phase to address:**
**Feed + Media** (establish the pattern); reused in Communities, Stories, Events, Notifications, Chat.

---

### Pitfall 11: Notification fan-out and unread-count drift

**What goes wrong:**
"New post" notifications naively inserted synchronously inside the create-post request for every member (1 post × 5,000 members = 5,000 inserts + 5,000 pushes inside one HTTP request → Cloud Run timeout, partial fan-out, duplicate sends on retry). Unread badge maintained as a separate counter (`profiles.unread_count++`) drifts from the rows after failures, bulk mark-as-read, deletes of the underlying post, or a member being blocked. Push and in-app treated as the same thing, so a failed push loses the in-app entry. [LOW — community architecture sources; well-established pattern]

**How to avoid:**
- Separate **event** from **delivery**: the request writes a `notification_events` row (or enqueues) and returns; a worker (Cloud Run Job / Cloud Tasks / pg_cron-driven function) fans out into `notifications (tenant_id, user_id, type, actor_id, target_type, target_id, read_at, created_at)` in batches, idempotent on `(event_id, user_id)`; push is a second consumer of the same rows. Cloud Tasks + a Cloud Run handler is the simplest GCP-native queue for a small team; pg_cron + a polling endpoint is an acceptable V1 shortcut for one tenant.
- For "new post" broadcasts, consider **not** creating per-user rows: one `announcements`-style notification rendered per user at read time with `last_seen_feed_at` — hybrid: eager rows for personal events (like/comment/reply/support reply), lazy for broadcasts. Decide per type in the Notifications phase.
- Unread count = `SELECT count(*) WHERE user_id=$1 AND read_at IS NULL` on partial index `(user_id) WHERE read_at IS NULL`; cache in memory on the client, recompute on focus/reconnect. Deleting a post/comment or blocking a member cascades/soft-deletes its notifications.
- Dedupe/aggregate: "João e 3 outros curtiram seu post" — collapse repeated like events per target within a window; otherwise the bell becomes noise (the pilot admin will ask for this).

**Warning signs:**
Notification inserts inside the post-creation transaction; `unread_count` column; no `event_id` idempotency; push failures throwing inside the request path.

**Phase to address:**
**Notifications** (worker + tables); the `notifications` table and the "after-commit side-effects" hook exist from **Feed + Media** so likes/comments produce events even before the bell UI exists.

---

### Pitfall 12: Over-modularization that stalls a small team (and its opposite)

**What goes wrong:**
"Modularize everything" becomes a monorepo of 12 packages, one Cloud Run service per module, per-module Supabase schemas, an events bus, and a plugin system for navigation — before a single tenant is live. The team spends the first month on infrastructure and the feature modules still couple through the DB anyway. The opposite failure: one 4,000-line `routes.ts` and a `utils` folder, with tenant checks copy-pasted, making toggling modules per tenant a UI hack.

**How to avoid:**
- **One deployable API, one Next.js app, modular by folder**: `modules/{feed,stories,communities,events,chat,notifications}/` each with `schema.sql` (migration files prefixed by module), `routes.ts`, `service.ts`, `types.ts`, and a `manifest.ts` exporting `{ key: 'feed', routes, requiredFeatures }`. A tiny core provides tenant context, auth, DB, storage, and the feature-flag gate (`requireFeature('feed')` middleware).
- Same on the frontend: `modules/feed/` with its pages, components, hooks, and a `nav.ts` contribution; the shell composes navigation from enabled modules.
- Shared types via a single `packages/shared` (or a `shared/` folder) — one package, not one per module.
- Cross-module interaction through **explicit service calls or an in-process domain-event emitter** (`events.emit('post.created')`), not through raw table access into another module's tables. This is what makes reuse in other TRIA products plausible later.
- Defer splitting into separate services/packages until a second product actually needs a module.

**Warning signs:**
Turborepo with >3 packages before first feature; a message broker in the V1 diagram; modules importing each other's repository files directly; feature flag checks scattered in JSX.

**Phase to address:**
**Foundation** (module skeleton + `requireFeature` gate + event emitter) and a written module convention. Revisit at **Pilot Hardening**.

---

### Pitfall 13: CI/CD and environment mistakes across Vercel + GCP + Supabase

**What goes wrong:**
`NEXT_PUBLIC_*` variables are **inlined at build time** — a preview build with the staging API URL promoted to production keeps pointing at staging; changing a public var requires a rebuild, not a restart. Vercel Preview deployments point at the *production* Supabase project/API because there's only one, so QA on a PR mutates real pilot data (or leaks it to reviewers). Cloud Run deploys via a long-lived service-account JSON key stored in GitHub Secrets. Supabase migrations are applied by hand in the dashboard, so the schema in git and the real schema diverge; RLS policies edited in the SQL editor never reach git. Cloud Run min-instances left at 0, so the pilot's first chat/API call of the morning takes seconds. [MEDIUM — Next.js env docs and discussions #56455/#76661; google-github-actions/auth]

**How to avoid:**
- Environments: **Local (Supabase CLI local stack) → Staging (own Supabase project + Cloud Run service `api-staging` + Vercel Preview) → Production**. Two Supabase projects minimum; never point previews at production.
- Vercel: set env vars per environment (Development/Preview/Production); use `vercel env pull` locally; only the API base URL and the Supabase URL/publishable key are `NEXT_PUBLIC_`; everything secret is server-only. Prefer promoting a *rebuilt* production deploy over "promote preview."
- GCP: GitHub Actions with **Workload Identity Federation** (`google-github-actions/auth`, `id-token: write`), no JSON keys; secrets in Secret Manager mounted as env on Cloud Run; separate staging/prod services; set `--min-instances=1 --cpu-boost --timeout=…` explicitly in the deploy step (config lives in git, e.g. a `service.yaml`).
- Supabase: schema **only** via migration files (`supabase/migrations`, applied with `supabase db push` in CI on merge to main; local via `supabase db reset`). Include RLS policies, storage bucket definitions and policies, and Auth Hooks in migrations. Diff the dashboard against git (`supabase db diff`) in CI to catch drift.
- Order of deploys: migration → API → web. Additive-only migrations (add column nullable, backfill, then constrain) so the old API can run against the new schema during rollout.
- CORS: the API must allow `app.seusistema.com` and `*.vercel.app` previews for staging only; lock production to the single origin.

**Warning signs:**
One Supabase project; `GCP_SA_KEY` secret; `.env.production` committed; `supabase/migrations` empty while tables exist; "just run this SQL in the dashboard."

**Phase to address:**
**Foundation** (pipeline is a deliverable before the first feature merges).

---

### Pitfall 14: Cloud Run cold starts and timeouts hitting exactly the interactive paths

**What goes wrong:**
With `min-instances=0`, the first request after idle pays container start + Node boot + app init (JWKS fetch, DB pool warm-up) — several seconds on a fat image — and the pilot's admin experiences it every morning. Long operations (fan-out, media validation) run inside requests and hit the default 5-minute timeout or get killed on scale-down because CPU is throttled outside requests by default. [LOW for exact numbers — community; MEDIUM for the mechanisms — Cloud Run docs]

**How to avoid:**
- `--min-instances=1` in production from day one for the API (pilot cost is small), `--cpu-boost`, distroless/alpine image with only production deps, lazy-load heavy modules, and a `/healthz` that doesn't touch the DB.
- Nothing that outlives the response runs in the request: use Cloud Tasks / Cloud Run Jobs, or enable "CPU always allocated" if you must do post-response work. Never `setTimeout`-and-forget after `res.end()` on default settings.
- Use a small DB pool (Supabase pooler in transaction mode, port 6543) with `max` ≈ 3–5 per instance; concurrency 80 × many instances × big pools exhausts Postgres connections.

**Warning signs:**
p95 latency spikes at 08:00; background work after response; `pg` pool `max: 20`; image > 500 MB.

**Phase to address:**
**Foundation** for config; **Notifications** for the job/queue pattern.

---

### Pitfall 15: Moderation and blocking that don't actually take effect

**What goes wrong:**
"Block member" flips a flag in `tenant_members.status` but: the member's JWT is still valid for up to an hour; their Realtime channel subscriptions stay open; their push subscriptions keep receiving; their existing comments stay visible with no bulk action; deleted comments leave orphaned notifications and replies; there is no audit of who deleted what; admins can delete but members can't report, so the admin never learns about problematic content between logins.

**How to avoid:**
- Membership status checked **per request** in the API (Pitfall 4) and in RLS policies (`exists (select 1 from tenant_members where user_id = auth.uid() and tenant_id = ... and status = 'active')` via a `security definer` helper for performance). Blocking also: revokes Realtime by making channel-join RLS depend on active membership, deletes push subscriptions, and optionally signs the user out via the admin API.
- Soft delete (`deleted_at`, `deleted_by`, `reason`) for posts/comments/messages; queries filter `deleted_at is null`; child replies of a deleted comment are hidden with it; related notifications removed.
- Minimum V1 moderation set: delete any comment/reply/story-comment, block/unblock member, and a **report** action from members (even if it just lands in an admin list and a notification) — cheap and expected by community admins.
- `moderation_log (tenant_id, actor_id, action, target_type, target_id, reason, created_at)` — required for disputes and, in Brazil, useful for LGPD requests.
- LGPD basics for the pilot: consent text at signup, a way to delete an account (anonymize `users`, keep tenant content attribution as "usuário removido"), and data export on request — schedule the mechanics, not the legal review, in Pilot Hardening.

**Warning signs:**
Hard `DELETE` on comments; block implemented only in the frontend; no per-request status check; no report button.

**Phase to address:**
**Moderation + Platform Panel**; the `status` check and soft-delete columns exist from **Foundation**.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Service-role client for all API queries | Zero RLS friction | Tenant leakage risk with no safety net; RLS never actually tested | Never for user-facing requests; OK for provisioning/jobs via a clearly separated admin client |
| Static manifest/favicon, client-side theming | Ships in an hour | Wrong-brand flash and TRIA icon on every tenant's home screen; reinstall needed to fix | Only in local dev; never in the pilot |
| `postgres_changes` for chat | No trigger/broadcast code | Throughput wall (single-threaded, per-subscriber auth) once V2 chat arrives | Prototype only; switch before Chat phase acceptance |
| Proxying uploads through the API | Simple code path | 32 MiB HTTP/1 cap, instance held during upload, double egress | Only for tiny files (avatars ≤ 2 MB) if you insist; not for post media |
| Storing raw phone video without transcoding | No vendor | Unplayable HEVC, huge egress, no poster; retrofit means re-encoding the catalogue | Never for feed video; acceptable to *defer* video entirely if the pilot agrees |
| Synchronous notification fan-out in the request | No worker | Timeouts and partial fan-out as soon as a tenant has >1k members | Only if the pilot tenant is < 500 members and you schedule the worker before tenant #2 |
| One Supabase project for everything | Cheaper | Previews mutate production data; no safe migration rehearsal | Never once real members exist |
| Boolean feature columns on `tenants` | Easy | Every new module is a migration; no per-feature config | Never — the `tenant_features` table is the same effort |
| `OFFSET` pagination | Familiar | Duplicate/skip on live feeds; slow at depth | Admin lists (attendance, members) only |
| Skipping soft-delete | Simpler queries | Moderation and notification cleanup become destructive; no audit | Never for user content |
| Denormalized `like_count` without reconciliation | Fast reads | Drift on failures; hot rows | Fine if maintained by trigger in the same transaction and recounted nightly |
| Single-tenant test data | Quick tests | Missing-tenant-filter bugs invisible | Never — seed two tenants in every integration test run |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase Auth | Verifying JWTs with the legacy shared secret; calling `getUser()` per request | Asymmetric signing keys + JWKS verification via `jose`; check membership status per request |
| Supabase Auth | Client-side `signUp` from Next.js, membership created "later" | API-driven signup: create auth user + `tenant_members` row + `app_metadata.tenant_id` in one flow |
| Supabase Auth | Assuming per-tenant email uniqueness | Email is global per project; identity ≠ membership tables; friendly duplicate-email UX |
| Supabase RLS | `auth.uid() = user_id` unwrapped; no index on policy columns; policies on joins | `(select auth.uid())`, index every policy column, `security definer` helpers, `TO authenticated`, explicit `tenant_id` filters in app queries (official benchmarks: 100–1000× faster) |
| Supabase Realtime | `postgres_changes` on messages; public channels | Broadcast from triggers/API on private per-conversation channels with Realtime Authorization RLS |
| Supabase Storage | Public buckets; upload through API; standard uploads for video | Private buckets with tenant-prefixed paths + storage RLS; signed upload URLs / TUS direct from browser; signed read URLs |
| Supabase migrations | Dashboard edits | Everything in `supabase/migrations`, applied by CI, `db diff` drift check |
| Cloud Run | `min-instances=0`, default 5-min timeout, work after response, HTTP/2 on with WebSockets | `min-instances=1`, `cpu-boost`, explicit timeout, Cloud Tasks/Jobs for async work, HTTP/1 unless no WS |
| Cloud Run | Uploads > 32 MiB via HTTP/1 | Never carry file bytes; direct-to-storage |
| Cloud Run ↔ Supabase | Direct Postgres connections with large pools | Supabase transaction pooler, small pool per instance, or PostgREST via supabase-js |
| Vercel | `NEXT_PUBLIC_` secrets; previews pointing at prod; static routes under login | Per-environment vars, staging backend for previews, force-dynamic authenticated segment |
| Vercel ↔ Cloud Run | CDN caching API responses; wildcard CORS in prod | `Cache-Control: private, no-store` on API; explicit allowed origins per env |
| GitHub Actions ↔ GCP | Service-account JSON keys in secrets | Workload Identity Federation (`google-github-actions/auth`) |
| Web Push | Prompt on load; one subscription per user; ignoring 410 | Gesture-triggered prompt in standalone mode; per-device rows; delete on 404/410; handle `pushsubscriptionchange` |
| Video vendor (Stream/Mux) | Storing only the raw file; polling for readiness | Direct upload URL from vendor, webhook → `media.status='ready'`, store HLS + poster URLs; hide post media until ready |
| Link previews (embeds) | Server fetching arbitrary URLs from the API | SSRF-safe fetcher (deny private IP ranges, timeouts, size cap), oEmbed for YouTube/Vimeo, cache previews per URL per tenant |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| RLS policy with unwrapped `auth.uid()`/joins and no index | Feed query 100 ms → seconds as posts grow | Wrap in `(select ...)`, index `tenant_id` + policy columns, `security definer` membership helper | ~10–50k rows per table (official benchmarks show 179 ms → 9 ms at 100k rows) |
| N+1 in feed/comments | Page load proportional to items; Cloud Run→Supabase latency multiplies | Single hydrated query per page; batch `IN` lookups | Immediately noticeable at 20 posts with cross-region hops |
| Offset pagination | Duplicates/skips on infinite scroll; slow deep pages | Keyset cursors with composite indexes | Any active feed; deep pages beyond ~1k rows |
| `postgres_changes` chat | Messages lag under load; ordering issues | Broadcast + DB sequence ordering | ~500 concurrent subscribers with RLS |
| WebSockets on Cloud Run with autoscale | Messages missing between instances; disconnects every 5 min | Avoid in V1; else Redis Pub/Sub + 60-min timeout + reconnect | Second instance |
| Synchronous fan-out | Post creation slow or timing out; duplicate pushes on retry | Event table + worker, idempotent inserts | Tenants > ~1k members |
| Unbounded media | Storage/egress bill grows with views; slow feed on mobile | Client-side resize, transforms/thumbnails, video via streaming vendor, per-tenant caps | First tenant that posts daily video |
| Big DB pool per instance | `too many connections` under scale-out | Pooler + small `max` per instance | ~10 instances |
| Cold start on `min-instances=0` | First request of the day 2–5 s | `min-instances=1`, `cpu-boost`, slim image | From day one for admin UX |
| Unread count via `count(*)` without partial index | Bell query slows as notifications accumulate | Partial index `where read_at is null`; prune read notifications after N days | ~100k notifications per tenant |
| Stories strip computed over all stories | Home slower every day | Index `(tenant_id, expires_at desc)`; query only `expires_at > now()` | Months of stories |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Service-role key for user requests (Pitfall 1) | Cross-tenant read/write | Run as user; RLS as second wall; two-tenant tests |
| Trusting `tenant_id` from the request body/query | Attacker reads/writes another tenant by changing an id | Tenant always derived from the verified JWT/membership; ids in the body are validated to belong to that tenant |
| IDOR on deep links (`/post/{id}`), media, events | Enumerable UUIDs still resolve cross-tenant if unfiltered | Every "by id" lookup includes `tenant_id`; use UUIDv4 (not serial) ids |
| Public storage buckets or long-lived signed URLs | Tenant media leaks via URL sharing/guessing | Private buckets, short TTL signed URLs, tenant-prefixed paths + storage RLS |
| Role from JWT claim only | Blocked/demoted user keeps access until token expiry | Per-request membership status/role check; short access-token TTL |
| `super_admin` as a tenant role | Privilege confusion; a tenant admin escalation path | Platform-level flag/table, separate panel routes, separate audit |
| Link-preview fetcher with no SSRF protection | API used to probe GCP metadata / internal services | Block private/link-local ranges, resolve-then-connect checks, timeouts, size caps |
| Uploads validated by extension/`Content-Type` only | Stored HTML/SVG executed as XSS via storage domain; malware PDFs | Magic-byte sniffing, allowlist, strip SVG or serve as attachment, `Content-Disposition: attachment` for files |
| Rich text/embeds rendered raw | Stored XSS in posts/comments | Sanitize server-side (allowlist), render embeds via known providers only |
| Public signup link with no abuse controls | Spam accounts flood a tenant | Rate limits per IP, email verification, optional tenant-level "approve members" switch (also a V2 feature seed) |
| Sharing tenant `slug` in the signup link but resolving tenant by hostname later | Custom-domain V2 breaks resolution | Keep tenant resolution a single function that accepts slug/cookie/host inputs |
| Push payloads with content | Sensitive support messages on lock screens | Send minimal payloads ("Nova mensagem do suporte"), fetch details on open |
| Web Push VAPID private key in the frontend or in git | Anyone can send pushes as the app | Secret Manager on Cloud Run only |
| Missing LGPD basics | Legal exposure for TRIA and the tenant | Consent at signup, account deletion/anonymization, moderation and access logs |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Unbranded login/signup screens | First impression is "TRIA's app," not the organization's | Tenant slug in signup link + last-tenant cookie brand the pre-login screens |
| Wrong-brand flash on load | App feels broken/generic every open | Server-rendered CSS variables and theme-color |
| Push permission prompt on first load | iOS denies forever; Android users tap "block" | Explain value, then gesture-triggered prompt; only in standalone mode |
| No install guidance on iOS | Members never install → no push, no badge | Detect Safari-not-standalone; show "Adicionar à Tela de Início" walkthrough |
| Video "posted" while still processing | Broken player, confused members | `processing` state with poster placeholder; publish when `ready` |
| Deep-link share that lands on a generic login | Share loop: login → home, post lost | Preserve `returnTo` through login; open the post after auth |
| Story strip that shows expired items or none | Stale or empty strip | `expires_at > now()` server-side, "seen" state per member |
| Notification noise (one row per like) | Bell becomes ignorable | Aggregate per target within a window |
| Support chat with no "who is answering" | Members think nobody's there | Assignment + typing/online presence + "responde em até X" copy |
| Check-in with no time window | Members check in a week early | Check-in enabled from N hours before start until end |
| Desktop as afterthought | Admin (who authors everything) works on desktop | Admin composer and moderation designed for desktop first, members' views mobile-first |
| Blocked member sees an infinite spinner | Support tickets | Explicit "sua conta foi bloqueada" screen with the tenant's contact |

## "Looks Done But Isn't" Checklist

- [ ] **Tenant isolation:** RLS policies exist — verify the API actually runs as the user (not service role) and a two-tenant test hits every list/detail/mutation endpoint.
- [ ] **Branding:** Colors apply — verify no flash on hard reload, `manifest`/icons per tenant, `theme-color`, and that a second tenant on the same phone gets its own home-screen icon.
- [ ] **Auth:** Login works — verify JWT verified via JWKS, `aud`/`exp` checked, blocked member rejected within one request, password-recovery flow ends inside the branded app.
- [ ] **Signup link:** Creates a member — verify duplicate email UX, membership row + `app_metadata.tenant_id` set, rate limiting.
- [ ] **Feed:** Posts render — verify keyset pagination, `EXPLAIN` on the feed query, `viewer_has_liked`, one-level reply enforcement, sanitized HTML, embeds only from allowlisted providers.
- [ ] **Media:** Upload works on Wi-Fi with a small file — verify 100 MB video over 4G, resumable upload, HEVC phone recordings play after transcoding, poster/thumbnail present, signed URL expiry handled by the client (refresh on 403).
- [ ] **Stories:** Show for 24 h — verify `expires_at` filter server-side, pinned stories still visible in communities after expiry (per PROJECT.md) — decide whether pinned means "exempt from expiry" and encode it.
- [ ] **Events:** RSVP saves — verify check-in window, attendance list export, timezone handling (store UTC, render America/Sao_Paulo, but keep tenant timezone field).
- [ ] **Notifications:** Bell shows count — verify count matches rows after mark-all-read, after post deletion, after member block; aggregation; fan-out is async and idempotent.
- [ ] **Web Push:** Works on Android Chrome — verify on a real iPhone in standalone mode, 410 cleanup, `pushsubscriptionchange`, badge set/cleared.
- [ ] **Chat:** Messages appear live — verify ordering by `seq`, reconnect catch-up via cursor, private channel authorization (a non-participant cannot subscribe), support inbox shows unassigned conversations, offline send retry.
- [ ] **Feature flags:** Module hidden from nav — verify the API also returns 404/403 for disabled modules (not just the UI).
- [ ] **Moderation:** Delete comment works — verify soft delete cascades to replies/notifications, audit log row, block revokes Realtime + push.
- [ ] **CI/CD:** Deploys on merge — verify migrations run first, previews use staging Supabase, WIF (no JSON keys), Cloud Run flags in git, rollback path tested once.
- [ ] **Super_admin panel:** Creates tenants — verify it seeds branding, features, the first `admin_tenant`, and generates PWA icon sizes.
- [ ] **i18n readiness:** pt-BR strings — verify all UI strings live in one message catalogue (e.g., `messages/pt-BR.json`) with no literals in components.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Service-role everywhere discovered late | MEDIUM | Introduce per-request user client behind the DB accessor; enable RLS table by table with the two-tenant test as the gate; audit logs for past leakage |
| Cache leaking branding | LOW | Force-dynamic the authenticated segment; add tenant id to every cache key; purge Vercel cache; add build-output check |
| `profiles.tenant_id` instead of memberships | MEDIUM (before V2), HIGH (after) | Create `tenant_members`, backfill from profiles, move role, switch API/RLS to membership, drop column |
| Chat on `postgres_changes` | LOW–MEDIUM | Add broadcast trigger + private channels; clients switch subscription; keep tables |
| Raw video stored | MEDIUM | Batch job submits existing objects to the vendor; `media.status` backfill; keep originals |
| Sync fan-out | LOW | Move insert loop to a worker; add `event_id` idempotency; backfill nothing |
| Preview deploys hit production data | LOW | Create staging Supabase project; rotate keys; re-point Preview env vars |
| Static manifest already installed by pilot members | MEDIUM (people cost) | Ship tenant manifest; ask members to reinstall via in-app banner; accept stragglers |
| Denormalized counters drifted | LOW | Nightly recount job from source tables |
| Wrong-brand flash | LOW | Move variable injection to root layout; cookie fallback |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Service-role bypasses RLS | Foundation | CI two-tenant isolation suite; grep guard on admin client imports; `EXPLAIN` shows policy filter |
| 2. Next.js cache leaks tenant | Tenant Shell | Build output has no static routes under authenticated segment; two-account smoke test; cache keys include tenant id |
| 3. Global email / identity ≠ membership | Foundation | Schema review: `tenant_members` exists, role lives there; duplicate-email signup test |
| 4. JWT verification | Foundation | Auth middleware test: forged/expired/rotated-key tokens rejected; no `JWT_SECRET` env |
| 5. Flash-of-wrong-brand / manifest | Tenant Shell (+ Platform Panel for icon generation) | Hard-reload video shows no flash; two tenants installed on one phone show distinct icons |
| 6. iOS Web Push | Notifications (install flow in Tenant Shell) | Real-iPhone test plan: standalone install, gesture prompt, badge, 410 cleanup |
| 7. Realtime chat design | Foundation (schema), Chat (transport) | Non-participant subscription rejected; reconnect catch-up test; ordering by `seq` under concurrent sends |
| 8. Media upload/video | Feed + Media (flag for deeper research: transcoding vendor) | 100 MB upload over throttled network; HEVC playback; signed URL expiry; per-tenant cap enforced by API and bucket |
| 9. V2-blocking schema | Foundation + each feature phase | "Schema conventions" doc; review checklist per migration (tenant_id, no role FKs, polymorphic reactions/comments) |
| 10. Counters/pagination/N+1 | Feed + Media | Query count per endpoint asserted in tests; `EXPLAIN` in acceptance; seeded 10k-post load check |
| 11. Fan-out/unread drift | Notifications (event hook from Feed + Media) | Count-vs-rows invariant test; idempotent re-run of a fan-out; 5k-member seed fan-out under timeout |
| 12. Over/under-modularization | Foundation | Module skeleton + `requireFeature` gate exist; no cross-module table access in review |
| 13. CI/CD & env | Foundation | Staging + prod Supabase projects; WIF auth; migrations via CI; `db diff` clean; Vercel envs per environment |
| 14. Cold starts/timeouts | Foundation (config), Notifications (async pattern) | Cloud Run config in git with `min-instances=1`, `cpu-boost`; no post-response work |
| 15. Moderation gaps | Moderation + Platform Panel (columns from Foundation) | Block takes effect within one request; soft-delete cascade test; audit rows; report action exists |

**Phases most likely to need their own deeper research:** Feed + Media (transcoding vendor, image pipeline), Notifications (queue choice on GCP, iOS push validation), Chat (Realtime Authorization + broadcast trigger specifics). Foundation and Tenant Shell follow well-documented patterns but carry the highest cost of getting wrong — they need a schema/isolation review gate, not more research.

## Sources

Official documentation (verified, MEDIUM):
- Cloud Run WebSockets — https://docs.cloud.google.com/run/docs/triggering/websockets (timeouts 5 min default / 60 min max, HTTP/2 caveat, best-effort affinity, billing, external state sync)
- Cloud Run quotas — https://docs.cloud.google.com/run/quotas (32 MiB request limit on HTTP/1, 32 MiB response unless chunked, 60-min timeout, concurrency)
- Supabase RLS performance and best practices — https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv (benchmarks for indexes, `(select auth.uid())`, security definer, explicit filters, `TO authenticated`)
- Supabase Realtime benchmarks — https://supabase.com/docs/guides/realtime/benchmarks (single-threaded `postgres_changes`, per-subscriber authorization limits, Broadcast scale)
- Supabase JWT signing keys — https://supabase.com/docs/guides/auth/signing-keys (JWKS endpoint, ~20 min cache lag, `getClaims()`, rotation)
- Supabase upload size restrictions — https://supabase.com/docs/guides/troubleshooting/upload-file-size-restrictions-Y4wQLT (5 GB standard, 50 GB resumable/S3, >6 MB use resumable)
- Supabase service role troubleshooting — https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z
- Supabase Row Level Security — https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage buckets — https://supabase.com/docs/guides/storage/buckets/fundamentals ; Resumable uploads — https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- WebKit: Web Push for web apps on iOS and iPadOS — https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Next.js PWA guide — https://nextjs.org/docs/app/guides/progressive-web-apps ; web.dev manifest — https://web.dev/learn/pwa/web-app-manifest
- MDN `pushsubscriptionchange` — https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event
- google-github-actions/auth (Workload Identity Federation) — https://github.com/google-github-actions/auth
- Cloud Run general development tips — https://docs.cloud.google.com/run/docs/tips/general

Community / vendor sources (LOW unless corroborated above):
- Next.js multi-tenant discussions — https://github.com/vercel/next.js/discussions/45457 , https://github.com/vercel/next.js/discussions/85239 , https://github.com/vercel/next.js/discussions/20841 ; "Multi-tenancy leaks IRL" — https://dev.to/lardcanoe/multi-tenancy-leaks-irl-4c4p
- Makerkit Supabase RLS best practices — https://makerkit.dev/blog/tutorials/supabase-rls-best-practices ; dev.to multi-tenant RLS — https://dev.to/issuecapture/row-level-security-in-supabase-multi-tenant-saas-from-day-one-4lon
- Supabase multi-tenant auth discussions — https://github.com/orgs/supabase/discussions/1615 , https://github.com/orgs/supabase/discussions/19420 ; Medium "Multi-Tenant Authentication with Supabase" — https://medium.com/@kriryk/multi-tenant-authentication-with-supabase-a-production-implementation-0f6064f50d55
- Supabase Realtime in production limits — https://www.agilesoftlabs.com/blog/2026/05/supabase-realtime-in-production-what ; dev.to Realtime deep dive — https://dev.to/kanta13jp1/supabase-realtime-deep-dive-postgres-changes-broadcast-and-presence-1bei
- Pushpad iOS requirements and 410 handling — https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications , https://pushpad.xyz/blog/web-push-error-410-the-push-subscription-has-expired-or-the-user-has-unsubscribed ; MagicBell PWA iOS limitations — https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- Multi-tenant PWA manifest — https://imohammadreza.medium.com/multi-tenant-pwa-with-manifest-api-51da8dc3fca7
- Likes counting system design — https://blog.algomaster.io/p/designing-a-scalable-likes-counting-system ; Cybertec pagination — https://www.cybertec-postgresql.com/en/pagination-problem-total-result-count/ ; Tiger Data counters — https://www.tigerdata.com/blog/counter-analytics-in-postgresql-beyond-simple-data-denormalization
- Notification system architecture — https://dev.to/viktoriaholikova/how-to-build-a-real-time-notification-system-for-a-classified-marketplace-architecture-transport-580f , https://codelit.io/blog/notification-system-architecture
- Cloud Run 32 MB workaround — https://dev.to/stack-labs/how-to-overcome-cloud-runs-32mb-request-limit-190j ; min-instances guide — https://oneuptime.com/blog/post/2026-02-17-how-to-configure-minimum-instances-on-cloud-run-to-eliminate-cold-starts-for-production-services/view ; cloud-run-faq — https://github.com/ahmetb/cloud-run-faq
- Video pricing comparisons (verify before vendor choice) — https://www.buildmvpfast.com/api-costs/video , https://leanopstech.com/blog/mux-vs-cloudflare-stream-vs-cloudfront-2026/
- Next.js env var pitfalls — https://github.com/vercel/next.js/discussions/56455 , https://github.com/vercel/next.js/discussions/76661
- Supabase TUS >6 MB local issue — https://github.com/supabase/cli/issues/2729

---
*Pitfalls research for: multi-tenant white-label community platform (Next.js/Vercel + Node/Cloud Run + Supabase)*
*Researched: 2026-09-11*
