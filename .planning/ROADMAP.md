# Roadmap: Rede Social

## Overview

Rede Social is a multi-tenant, white-label community PWA: one deployment, each organization reached on its own custom domain (the platform domain serves the platform's `super_admin`), each organization's members see their own brand and only their own content. The roadmap follows the dependency spine the research identified (kernel + tenancy + auth -> branded shell + platform panel -> media broker + profiles) and then ships content modules in the order that lets each one reuse the conventions of the previous (feed establishes likes/comments/pagination/domain events; communities and stories build on posts; events introduce scheduled jobs). The realtime layer (notifications, Web Push, support chat) comes after all event producers exist, and the last phase gives the tenant admin their moderation and admin panel while running the pilot go-live gate. Eight phases, each a deployable vertical slice (schema + API + UI) except the unavoidable foundation phase, which still ends with a real login against a real tenant.

**Structure:** Vertical MVP slices (`PROJECT_MODE=mvp`). **Granularity:** standard (8 phases, 3-5 plans each). **Requirement coverage:** 79/79 v1 requirements mapped, each to exactly one phase.

**Cross-cutting rules carried by every phase after the one that creates them:**

- Two-tenant isolation suite (TENANT-05, Phase 1) is re-run with every new table, endpoint, storage bucket and Realtime topic; it is the exit gate of every phase.
- Schema conventions doc (Phase 1): `tenant_id` on every tenant-owned row, RLS on every table, `memberships` not `profiles.tenant_id`, generic `author_user_id`, soft-delete/`status` columns, nullable-FK targets, `tenant_modules` rows not booleans.
- Module package layout + lint boundary (MOD-01/02, Phase 1) and module registry (MOD-04, Phase 2): every feature module is a package, registered, flag-gated in both API and navigation.
- Design language (UI-01, Phase 2): feature screens are ported from `reference/frontend-design/` into their module package; screens the prototype lacks get a UI-SPEC in the prototype's language reviewed with the design team (UI-04, established in Phase 2).
- pt-BR message catalog (PWA-03, Phase 2): no string literals in UI; Phase 8 audits.
- Supabase **Free** plan for the pilot (PROJECT.md constraint): no native image transforms (worker resizes), 50 MB per file, Realtime quotas; Pro upgrade is a V2 item.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD** - Monorepo + kernel, core schema with RLS tenant lane, JWKS auth with per-request membership, sign-up link / login / recovery, module registry guard, two-tenant isolation suite, GitHub -> Vercel + Cloud Run pipelines as code (local stack) (completed 2026-09-14)
- [ ] **Phase 01.1: Cloud Provisioning & First Release (INSERTED)** - Account decisions, GitHub repo + environments, two Supabase projects, GCP/Vercel/Resend provisioning, DNS, first PR -> staging -> production; deferred until the accounts exist, does not block Phases 2-8
- [ ] **Phase 2: Tenant Shell, Branding & Platform Panel** - Ported design system + responsive app shell rendering the tenant's brand server-side, flag-driven navigation, per-tenant PWA install, pt-BR catalog, branded auth e-mails, super_admin platform panel to provision tenants
- [ ] **Phase 3: Media Pipeline & Member Profiles** - Signed direct-to-Storage uploads under tenant paths, worker image resizing, streaming-vendor video, member profile (photo, name, bio), other members' profiles and searchable directory
- [ ] **Phase 4: Feed** - Admin rich-post composer (images, video, embeds, files), member feed with likes / comments / one-level replies / comment likes, edit + soft delete, share deep links, domain event bus
- [x] **Phase 5: Communities & Stories** - Admin-created communities with scoped posts, community pages with pinned stories, 24 h stories strip + full-screen viewer, story likes and flat comments (completed 2026-09-25)
- [x] **Phase 05.1: Community Authoring Entry Points (INSERTED)** - Reachable create-community CTA, archived communities findable and reactivatable without a UUID, stories publishable from inside a community and a community choice in the story composer (born attached, one mechanism) (completed 2026-09-25)
- [ ] **Phase 05.2: Story Highlights (INSERTED)** - Instagram-style stories: one grouped circle of active stories on Início plus highlight circles beside it, highlights-only on communities, replacing loose community pins
- [ ] **Phase 05.3: Reels (INSERTED)** - Full-screen vertical video pager over the feed's video posts, per the design print: a new tab that filters the feed to video, part of the MVP
- [ ] **Phase 6: Events** - In-person / online events, upcoming + past lists, RSVP and self check-in window, admin attendance list, calendar export
- [ ] **Phase 7: Notifications, Web Push & Chat** - Realtime infrastructure (Supabase Broadcast on private topics), event-driven notification center with live unread count, Web Push with iOS install flow, event reminders, 1:1 member <-> support chat with support inbox
- [ ] **Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening** - Delete any comment, block/unblock with immediate revocation, moderation log, branding editor with live preview, member/role management, rules editor, mobile admin flows, per-module READMEs, pilot go-live gate
- [ ] **Phase 9: Rede Social - Follow, Member Posts and Explorar** - Post-MVP. Toggleable "Rede social" module: follow graph, member feed posts, Explorar tab of followed people, Início limited to admin posts, member videos in Reels for followers
- [ ] **Phase 10: Rede Social - Member Stories and Communities** - Post-MVP. Members publish stories and create communities; only a community's creator publishes in it
- [ ] **Phase 11: Rede Social - Direct Messages, Member Blocking and Reports** - Post-MVP. 1:1 direct messages between members, member-to-member blocking, follower-scoped notifications, moderation of member content and a reports queue

**MVP scope** (user decision 2026-09-25): the MVP is the pilot going live, closed by the Phase 8 go-live gate. It covers Phases 1-8 and their decimal insertions (01.1, 05.1, 05.2, 05.3). The "Rede social" module (Phases 9-11) is V2 scope promoted into this milestone; it is post-MVP, runs after Phase 8, and no MVP phase may depend on it.

## Phase Details

### Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD

**Goal**: Two isolated tenants exist on the local Supabase stack, with the deploy pipeline written as code (the hosted staging + production stack lands in Phase 01.1); a person can sign up through a tenant's public link, log in, stay logged in, recover their password and log out, and the API serves only their tenant's data through an RLS-protected database lane.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: TENANT-01, TENANT-03, TENANT-05, MOD-01, MOD-02, ROLE-01, ROLE-02, ROLE-06, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):

  1. A user who signs up through tenant A's public sign-up link on tenant A's own domain (accepting A's community rules and the platform's terms, recorded with a timestamp) becomes a `member` of tenant A, can log in with e-mail and password, stays logged in after closing and reopening the browser, can recover a forgotten password via e-mail link, and can log out; the sign-up link survives the register -> login round-trip.
  2. After login, `GET /me/bootstrap` returns the user's tenant, role and enabled modules resolved from their membership row (the hostname only selects the public shell; a session whose membership does not belong to the host's tenant gets 403 `TENANT_HOST_MISMATCH`); a member whose membership is set to blocked receives 401/403 on their very next API request without redeploy or re-login.
  3. The automated two-tenant isolation suite (pgTAP + API integration tests) passes: every tenant-owned table carries `tenant_id` with RLS enabled, the API's tenant lane runs under a non-service database role inside a per-request transaction, no list or detail endpoint returns another tenant's rows, and routes of a module disabled for the tenant return 404.
  4. The monorepo has a kernel package, a feature-module package template and lint/dependency rules that fail the build when a module imports another module's internals; the delivery pipeline exists as code (Cloud Run image for API + worker, `ci.yml` mirroring the local exit gate, `deploy-api.yml` with staging on PR and a gated production job, `docs/DEPLOY.md` listing every secret) and is validated locally (YAML, grep assertions, Docker build/run). Running it against real accounts is Phase 01.1.

**Plans**: 9/9 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Walking skeleton: toolchain + @rede-social monorepo scaffold (all packages except `apps/web`); tracer JWT → JWKS auth → membership → RLS tenant lane → `GET /v1/me/bootstrap`; `tenant_domains` + `GET /v1/public/tenants/by-host` + host/membership match (403 `TENANT_HOST_MISMATCH`) + seeded tenant hosts (D-20/D-23/D-24)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — `@rede-social/web` scaffold + browser login/logout slice: host → tenant resolution in proxy.ts (tenant / platform / generic hosts, D-20/D-21), `@supabase/ssr` session, pt-BR catalog, `/entrar` (tenant name from the host, D-22), `/inicio`, "Sair", Playwright on iPhone 14 against `rede-demo.localhost`
- [x] 01-03-PLAN.md — Supavisor/PgBouncer lane spike + LOCAL-settings guard + fallback doc; `platform_admins`, chat/notification stubs, SCHEMA-CONVENTIONS.md
- [x] 01-09-PLAN.md — Pipeline as code: Dockerfile (API + worker), ci.yml, deploy-api.yml (staging on PR, gated prod on main), seed-prod, keep-alive, DEPLOY.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — Sign-up slice: `https://{tenant-domain}/cadastro` (slug from the host) + `/cadastro/{slug}` on generic hosts (D-22), two consents → `consent_records`, `POST /v1/public/signup/:slug` (admin lane, duplicate 409), legal texts
- [x] 01-05-PLAN.md — Password recovery (origin-derived links, Mailpit e2e, `/auth/confirm` guard), blocked-member contract (403 on next request, "acesso suspenso") and host-mismatch screen ("Este endereço não pertence à sua comunidade.", D-23)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-06-PLAN.md — Module registry, `tenant_modules`, flags cache, `requireModule`/`requireRole`/`requireSuperAdmin` (platform sessions only off tenant hosts, D-23), bootstrap modules + permissions, platform-host `/inicio` for the super_admin (D-21), seed per D-17 (hosts kept)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-07-PLAN.md — `@rede-social/module-example` (D-19): table + guarded routes + typed event + transactional pg-boss job + worker role + widget on `/inicio`

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-08-PLAN.md — Two-tenant isolation suite (pgTAP + API, incl. `tenant_domains` and "session of A on B's host → 403 `TENANT_HOST_MISMATCH`"), boundary negative fixture, [BLOCKING] clean `supabase db reset` + full suite

**Research needed**: Supavisor transaction pooling with `set_config(..., true)` + `SET LOCAL ROLE authenticated` (verify with a spike before schema freeze; fallback is a per-request Supabase client with the user JWT); dedicated `api_user` role grants; pg-boss transactional enqueue with Drizzle; Supabase asymmetric signing keys + `@supabase/ssr` cookie flow in Next 16 `proxy.ts`; TypeScript 7 tooling at repo bootstrap.
**Notes**: Auth routes in this phase are functional-minimal (plain forms); their visual port to the prototype's design lands in Phase 2 with the shared UI package. Chat and notification table stubs and the "schema conventions" doc are Foundation deliverables so later modules are reviewed against V2-safe shapes. Tenants are seeded by script/migration until the platform panel exists in Phase 2. Each tenant is served on its own custom domain (`tenant_domains`, host -> tenant lookup in `proxy.ts`); the platform domain hosts the platform's `super_admin`; the seed tenants use platform-owned hostnames so staging/production smoke tests run on real tenant domains.

### Phase 01.1: Cloud Provisioning & First Release (INSERTED)

**Goal**: The Phase 1 codebase runs on a deployed staging + production stack: the accounts exist, the pipeline written in Phase 1 is wired to them, and a push to `main` deploys the web app to Vercel and the API + worker to Cloud Run through GitHub Actions with separate preview/staging and production environments (two Supabase projects, migrations applied only by CI).
**Mode:** mvp
**Depends on**: Phase 1 (plans 01-08 and 01-09). Does NOT block Phases 2-8, which are developed against the local stack; run this phase as soon as the GitHub, Supabase, GCP, Vercel and Resend accounts and DNS control exist.
**Requirements**: PWA-04 (plus hosted evidence for TENANT-03 and AUTH-03: the staging Supavisor transaction-pooler spike and a real recovery e-mail through Resend)
**Success Criteria** (what must be TRUE):

  1. The account shape for D-11/D-12 is decided and recorded in `docs/DEPLOY.md`; the repository exists under `n1-tecnologia` with `main` protected and `staging`/`production` environments; two Supabase projects (`rede-social-staging`, `rede-social-prod`) exist and their credentials are GitHub environment secrets.
  2. GCP (Cloud Run prerequisites, Artifact Registry, Secret Manager, WIF), Vercel (project, Git integration, env vars, platform domain + two seed tenant domains) and Resend (domain + API key) are provisioned; per-remote Supabase auth/SMTP config with per-host redirect allow-lists is committed; DNS records exist.
  3. The first pull request produces a Vercel Preview and a staging deploy; the staging Supavisor spike passes (the authoritative transaction-pooler proof for TENANT-03); a remote Playwright smoke passes on the Preview URL; the merge to `main` goes through the production approval, the one-time production seed runs, and a real recovery e-mail arrives through Resend.

**Plans**: 3 plans (all `autonomous: false` — every plan stops for account decisions, CLI logins, tokens, DNS records or the production approval)

Plans:
**Wave 1**

- [ ] 01.1-01-PLAN.md — Account decisions (GitHub plan, Vercel team, GCP, Supabase org, DNS) + provision GitHub repo/`main`/environments and the two Supabase projects

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01.1-02-PLAN.md — Provision GCP (WIF, Artifact Registry, Secret Manager), Vercel project/env + platform domain + two seed tenant domains, per-host auth allow-lists, Resend SMTP, Phase 2 custom-domain runbook; DNS (three CNAMEs) + ES256 key checkpoint

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01.1-03-PLAN.md — First PR → Preview + staging, staging Supavisor spike, remote smoke (Preview keeps the slug/cookie fallback), merge → production approval, seed-prod, production smokes on the seed tenant host (member) and the platform host (super_admin), real e-mail check

**Notes**: These three plans were originally Phase 1 waves 7-9 (01-10, 01-11, 01-12). They were split out on 2026-09-14 because the accounts did not exist yet and every other phase can be built locally; the plan bodies are unchanged apart from renumbering. Until this phase runs, the local Supavisor's refusal of `api_user` means TENANT-03's transaction-pooler proof rests on the direct-port spike from plan 01-03 only.

### Phase 2: Tenant Shell, Branding & Platform Panel

**Goal**: Members open their organization's own domain and see its branded, installable app on phone and desktop, branded already on the login page; Rede Social can provision a tenant end-to-end (branding, modules, custom domain, first admin) from the platform panel on the platform domain without touching the database.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: TENANT-02, TENANT-06, TENANT-07, MOD-04, ROLE-03, ROLE-04, ROLE-05, UI-01, UI-03, UI-04, PWA-01, PWA-03
**Success Criteria** (what must be TRUE):

  1. After login, a member of tenant A sees A's logo, colors, favicon and display name server-rendered in the whole app shell (top bar, bottom navigation, theme-color) with no default-brand flash, on a phone and in a real desktop layout; a member of tenant B logging in on B's domain sees only B's brand, and the login page of each domain already carries that tenant's brand before authentication (verified by the two-tenant smoke test and a build-output check that no authenticated route is static).
  2. `super_admin` can create a tenant in the platform panel (name, slug, initial branding, enabled modules, first `admin_tenant` invited by e-mail), list all tenants with status, open any tenant's settings, toggle a module, and attach a custom domain (registered with the hosting provider and the auth redirect allow-list automatically, with the DNS records to create and the verification status shown); the module change appears in that tenant's navigation and its API routes (404 when disabled) without a redeploy.
  3. The prototype's shared primitives (Button, IconButton, Avatar, Badge, BottomSheet, ConfirmDialog, EmptyState, Input, Skeleton, Tabs, Toast, TopBar, BottomNav, PullToRefresh, SafeAreaWrapper) and design tokens live in the kernel shared-UI package; hardcoded brand hex literals, "Igor Alves" strings and `lib/nav.ts` are replaced by tenant theme variables, tenant display name and registry-driven navigation; the platform-panel screens (which the prototype lacks) are designed in the prototype's language and reviewed with the design team.
  4. The app is installable as a PWA (manifest + service worker) and runs in standalone mode on iOS and Android; password-recovery and confirmation e-mails show the tenant's display name and logo; every shell and auth string is pt-BR and comes from a central message catalog.

**Plans**: 20/20 plans executed (16 executed + 4 gap-closure)
**Wave 1**

- [x] 02-01-PLAN.md
- [x] 02-02-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-03-PLAN.md
- [x] 02-04-PLAN.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-05-PLAN.md

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-06-PLAN.md
- [x] 02-07-PLAN.md
- [x] 02-08-PLAN.md
- [x] 02-09-PLAN.md
- [x] 02-12-PLAN.md

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-10-PLAN.md
- [x] 02-11-PLAN.md
- [x] 02-13-PLAN.md
- [x] 02-15-PLAN.md

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 02-14-PLAN.md

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 02-16-PLAN.md

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 02-17-PLAN.md — gap closure (wave 8): CR-01 domain poller re-arms / expires on the provider-error path (fake `provider-fails-once` + checkDomain fix + integration proof); WR-01 last_error cleared after a successful verified re-run
- [x] 02-18-PLAN.md — gap closure (wave 8): WR-05 bootstrap membership scoped by tenant (membershipOfRecord), WR-06 2 s timeout on the by-host lookup, WR-07 upload hook error boundary (+ happy-dom / Testing Library in apps/web)

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 02-19-PLAN.md — gap closure (wave 9): WR-02/WR-03/WR-04 invite refusals (identityConflict pre-check, reasons email_in_use / user_in_other_tenant, create-time adminEmail check, recovery-link resend fallback, last_error 'invite:<reason>')

**Wave 10** *(blocked on Wave 9 completion)*

- [x] 02-20-PLAN.md — gap closure (wave 10): panel surfaces + catalog for the refusals, two e2e proofs, and the phase exit gate (affected suites + full `pnpm verify`) recorded

**UI hint**: yes
**Research needed**: Vercel Domains REST API + verification flow for customer-owned domains (add domain, read DNS/verification records, poll status) and Supabase redirect allow-list updates per domain; `@serwist/turbopack` service-worker setup under Next 16.3; branded auth e-mails on Supabase (per-project templates vs Send Email hook) - decide here; the rest (Tailwind `@theme inline`, dynamic manifest route handlers, `force-dynamic` segments) is well documented and needs a review gate, not research.
**Notes**: Establishes the UI-SPEC review pattern for prototype-less screens that Phases 4-8 reuse (admin composers, stories viewer, support inbox, admin panel, moderation). Per-tenant manifest/icons are served from `no-store` route handlers; the iOS "Adicionar a Tela de Inicio" hint component is built here but only wired to push in Phase 7.

### Phase 3: Media Pipeline & Member Profiles

**Goal**: Members have a profile with photo, name and bio and can find each other inside their tenant; the platform accepts images, files and phone video safely under tenant scope through a single upload broker that every later module reuses.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: TENANT-04, MEDIA-01, MEDIA-02, MEDIA-03, PROF-01, PROF-02, PROF-03
**Success Criteria** (what must be TRUE):

  1. Member can upload a profile photo from a phone (browser -> Supabase Storage directly through a signed upload URL brokered by the API; bytes never transit Cloud Run), edit their display name and bio, and see the photo served through a signed, tenant-checked URL in display sizes produced by the worker.
  2. Member can open another member's profile and browse a paginated, name-searchable member directory that only ever lists members of their own tenant.
  3. Uploading a file over the size cap (Supabase Free plan: 50 MB) or with a disallowed type is rejected with a clear message at confirmation time (magic-byte and size validation); valid images are resized/compressed into display sizes within seconds and the original limits are enforced per kind.
  4. `admin_tenant` can upload a phone-recorded video (including iPhone HEVC) that is transcoded by the chosen streaming vendor and plays back as HLS with a thumbnail on iOS Safari and Android Chrome, showing a "processando" placeholder until ready; the isolation suite proves a tenant-B session cannot obtain a signed URL for a tenant-A object.

**Plans**: 8/8 plans executed

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Media broker keystone: `media_assets`, the private `media` bucket, signed direct upload, worker WebP variants and the zero-DB-read 302 serving endpoint (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — Member profile: `member_profiles` keyed by membership with its trigger, backfill and search indexes; own-profile read/write; a real `bootstrap.membership.profile` (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-03-PLAN.md — Member directory API: accent-insensitive keyset search, D-47 staff-hidden filters, and the other-member profile route (wave 3)
- [x] 03-04-PLAN.md — Profile screens: `/perfil`, `/perfil/editar`, the generalised upload hook with TUS and the silent HEIC re-encode, `MediaImage` (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-05-PLAN.md — Directory screens `/membros` and `/membros/[membershipId]`, plus the D-02 first-access nudge card on `/inicio` (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03-06-PLAN.md — Video ingest: the `VideoProvider` seam with a Mux adapter and a local fake, the signature-verified webhook and the idempotent event job (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03-07-PLAN.md — Signed playback tokens, the `admin_tenant` media screen `/configuracoes/midia` and the three-state `VideoPlayer` (wave 6)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 03-08-PLAN.md — Orphan sweeper, the extended two-tenant isolation suite, the phase smoke and the `pnpm verify` exit gate (wave 7)

**UI hint**: yes
**Research needed**: Video vendor choice (Mux vs Cloudflare Stream) with pricing verified at phase start (and whether the pilot can defer video if budget is tight); TUS resumable uploads on mobile Safari over throttled networks; Supabase signed-URL semantics without native transforms on the Free plan (worker-produced variants); direct-upload + webhook -> `media.assets.status='ready'` flow.
**Notes**: Video has no content consumer until Phase 4, so verification uses the admin upload flow plus a playback check; keep it in this phase so the whole broker (images, files, video) is one contract. `media.assets` carries tenant, owner, purpose, status, provider, dimensions; private buckets use tenant-prefixed paths with `storage.objects` policies.

### Phase 4: Feed

**Goal**: `admin_tenant` publishes rich posts from a phone and members consume and interact with them in the branded feed; this phase fixes the content conventions (likes/comments shape, one-level replies, keyset pagination, after-commit domain events, share deep links) every later module copies.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04, FEED-05, FEED-06, FEED-07, FEED-08, MEDIA-04, MOD-03, UI-02
**Success Criteria** (what must be TRUE):

  1. `admin_tenant` can create a post from a phone with text plus any combination of multiple images (swipeable carousel), one video (HLS player), a link preview or YouTube/Vimeo embed unfurled server-side at create time with an SSRF guard and cached on the post, and file attachments (PDF etc.); can edit it (shown as "editado") and soft-delete it.
  2. Member sees the tenant's posts newest first with cursor pagination, infinite scroll and pull-to-refresh; can like/unlike a post (idempotent toggle, incl. double-tap) and see the count, comment, reply one level (a deeper reply is rejected by a DB constraint), and like/unlike comments and replies, using the prototype's ported PostCard / CommentSheet interactions.
  3. Member can share a post through the native share sheet (copy link on desktop); opening the internal deep link while logged out routes through login and lands on the post; a member of another tenant gets 404.
  4. Post, like and comment actions emit typed domain events (`post.published`, `post.liked`, `comment.created`, ...) on the kernel bus after commit, received by a test subscriber; posts/communities/stories carry a generic `author_user_id` and a per-tenant posting policy so member posting in V2 is a permission flip; feed pages execute a bounded number of queries (no N+1, keyset cursors) checked in CI.

**Plans**: 10/10 plans executed
**UI hint**: yes
**Research needed**: None beyond the conventions doc; acceptance checks (`EXPLAIN`, query count, depth trigger) cover the risks. SSRF-safe unfurl (deny private ranges, follow-redirect limits, timeouts) is implementation detail for the worker job.
**Notes**: `feed.comments` reserves a `story_id` slot and `feed.likes` uses nullable FKs + partial unique indexes so Phase 5 reuses them. Counters are trigger-maintained. The admin composer is the first prototype-less screen designed under the Phase 2 UI-SPEC pattern (ADMIN-04 is verified across all composers in Phase 8).

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Tracer: `@rede-social/module-feed` + `feed_posts` + keyset `GET /v1/feed` + permission-guarded create + `post.published` + the D-55 home slot

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — Kernel UI primitives (`InfiniteScroll`, `DoubleTapHeart`, the `--color-like` token) + the D-33 mockup gate for the six `[designed]` surfaces
- [x] 04-03-PLAN.md — Likes, comments and one-level replies: nullable-FK likes, the declarative depth constraint, counter triggers, the six domain events

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-04-PLAN.md — Post media composition: `feed_post_media`, gallery XOR video as a DB constraint, attachments, the carousel and the attachment row

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04-05-PLAN.md — MEDIA-04: the connector-pinned SSRF guard, the unfurl worker job, the per-tenant preview cache and the no-iframe preview card *(carries the package-legitimacy checkpoint)*

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 04-06-PLAN.md — Feed interactions: infinite scroll, pull-to-refresh, the meta row, the optimistic like and the double-tap

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 04-07-PLAN.md — Comments UI: one `CommentsList` in two containers, per-root reply expansion, the removed-author row

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 04-08-PLAN.md — FEED-07: the `/post/[postId]` share target, the server-derived share URL and the one-screen 404 collapse

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 04-09-PLAN.md — FEED-01/FEED-03: the full-screen composer and edit screen, the create control, `PATCH`/`DELETE` and the overflow menu

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 04-10-PLAN.md — D-19: remove `@rede-social/module-example`, the forward-only drop migration, the phase-4 smoke witness and the `pnpm verify` exit gate

### Phase 5: Communities & Stories

**Goal**: `admin_tenant` organizes content into communities and broadcasts 24 h stories; members browse communities with their posts and pinned stories, and watch stories in a full-screen viewer with the complete gesture set.
**Depends on**: Phase 4
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, STORY-01, STORY-02, STORY-03, STORY-04, STORY-05
**Success Criteria** (what must be TRUE):

  1. `admin_tenant` can create, edit and archive communities (name, description, cover image) and post directly into a community from its page; the main feed shows tenant-wide posts plus posts from communities the member can see, and every member sees every community in V1 while a `community_members` table already exists.
  2. Member can browse the community list (cover, name, description, post count) and open a community to see its posts and its pinned stories.
  3. `admin_tenant` can publish a story (image or video up to ~60 s via the streaming vendor, optional caption) from a phone; members see active stories in a horizontally scrollable strip and a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause.
  4. A story leaves the strip 24 h after publishing (hidden by `expires_at`, record retained); a story pinned to one or more communities stays visible on those community pages after expiry until unpinned.
  5. Member can like a story and comment on it; attempts to like or reply to a story comment are rejected by the API and the DB.

**Plans**: 8/8 executed + 4 gap-closure plans (05-09..05-12) planned from `05-VERIFICATION.md`
**UI hint**: yes
**Research needed**: None (conventional CRUD; stories viewer reuses the prototype's reels pager gesture model). Requires the design team's answer on the community "highlights" circles as the pinned-stories UI and a viewer spec (PROTOTYPE.md open question 1).
**Notes**: Posts scoped via `community_id`; feed query = tenant-wide OR visible community. Stories strip query is `expires_at > now()`, no cron. Admin story history view is included so expired stories remain reachable to the admin. Research falsified D-73's index claim: the merged feed needs a third, non-partial `(tenant_id, created_at desc, id desc)` index (05-03), and `expires_at` cannot be a generated column (05-05).

Plans:

**Wave 1**

- [x] 05-01-PLAN.md — Tracer: `@rede-social/module-communities` + `communities`/`community_members` + keyset `GET /v1/communities` + permission-guarded create + the `Comunidades` tab and the `/comunidades` list
- [x] 05-02-PLAN.md — The D-33/UI-04 design gate: sketch 003 for the five prototype-less surfaces, plus UI-D-46's vocabulary amendment across ten shipped catalog rows

**Wave 2** *(blocked on Wave 1)*

- [x] 05-03-PLAN.md — Feed × communities: the third index, the D-73 merged predicate with its D-74 module-flag fallback, D-71's "em {Comunidade}" label and D-72's "Publicar em" picker (COMM-04)

**Wave 3** *(blocked on Wave 2)*

- [x] 05-04-PLAN.md — COMM-01/COMM-03: the community page, the cover-less brand gradient, the create/edit/archive form, archive-as-write-gate and the trigger-owned `post_count`/`last_activity_at`

**Wave 4** *(blocked on Wave 3)*

- [x] 05-05-PLAN.md — STORY-01/STORY-03: `@rede-social/module-stories`, `stories` with its `expires_at` predicate, the order-5 strip home slot and the `/stories/publicar` flow

**Wave 5** *(blocked on Wave 4)*

- [x] 05-06-PLAN.md — STORY-02: the rAF clock, the pointer pager, progress bars, hold-to-pause, the autoplay-blocked branch and story likes

**Wave 6** *(blocked on Wave 5)*

- [x] 05-07-PLAN.md — STORY-05: the declarative `target_kind` constraint pair, the Pitfall-1 CHECK fix, and story comments in the flat `CommentsList` variant

**Wave 7** *(blocked on Wave 6)*

- [x] 05-08-PLAN.md — STORY-04: `story_community_pins`, the community Destaques row, the "Seus stories" history with pin/unpin and delete, and the phase exit gate

**Wave 8** *(gap closure — the two FAILED truths of `05-VERIFICATION.md`)*

- [x] 05-09-PLAN.md — GAP 1 / COMM-01: resolve the community cover asset inside `withTenantTx`, one bare 404 with no existence oracle, the closed `cover_invalid` code, and the cross-tenant integration case with its positive control
- [x] 05-10-PLAN.md — GAP 2 image half / STORY-02: stop the `MediaImage` ↔ `StoryViewer` render loop at both ends, report the empty variant ladder (CR-03), take the badge and retry out of the gesture stage (CR-04), and render the real media under the viewer in a test

**Wave 9** *(blocked on Wave 8)*

- [x] 05-11-PLAN.md — GAP 2 video half / STORY-02: attach `StoryVideo`'s listeners to the late-mounting `mux-player`, prove a video segment advances inside the real viewer, and put the three `/stories` routes inside the static-route gate

**Wave 10** *(blocked on Wave 9)*

- [x] 05-12-PLAN.md — The verification debt: the 14 flagged prohibitions, the 5 backstop claims and the 4 device checks assembled with evidence, plus the `mode: mvp` / User-Story goal decision

### Phase 05.1: Community Authoring Entry Points (INSERTED)

**Goal**: Close the authoring routes Phase 5 built but left unreachable. Every community and story action an `admin_tenant` is permitted to take must have a control on a screen they can get to — no URL typing, no memorised UUIDs — and a story must be creatable from inside a community so it is born attached to it.
**Depends on**: Phase 5 (communities, stories, `story_community_pins`, the `/criar?comunidade=` precedent)
**Requirements**: COMM-01 (reachability half), STORY-04 (authoring half) — both re-opened by Phase 5 UAT
**Success Criteria** (what must be TRUE):

  1. An `admin_tenant` with at least one existing community can reach the create-community form from `/comunidades` on a phone. Today the CTA is built at `CommunitiesList.tsx:153` but rendered only at line 190, inside the zero-communities `EmptyState`; the non-empty branch (line 193+) never renders it, so `/comunidades/nova` is reachable only by typing the URL.
  2. An `admin_tenant` can find an archived community and reactivate it without knowing its id. `listCommunities` filters `status = 'active'` (`packages/modules/communities/server/service.ts:137`), so an archived community leaves the list entirely, and the only reactivate control sits at the bottom of that community's own edit form (`CommunityForm.tsx:458-470`). Tester's suggested shape: keep archived communities in the list behind an "Arquivada" tag or filter.
  3. An `admin_tenant` viewing a community can publish a story from that screen, and the published story is attached to that community without a second editorial step. Follow the shipped post precedent — the community page already passes `createHref={`/criar?comunidade=${community.id}`}` (`comunidades/[communityId]/page.tsx:243`) so a POST is already born attached.
  4. The attachment is written in the same transaction as the story, not as a follow-up pin the admin could forget or half-apply.
  5. The story composer ITSELF asks. Publishing from `/stories/publicar` with no community context, the admin states up front whether the story goes to a community or to none — the choice is part of composing, not a step they discover afterwards in `/stories/meus`. "No community" stays a first-class answer: a tenant-wide story is the V1 default and must not become harder to publish than a community one.

**Plans**: 5/5 plans executed
**UI hint**: yes — three surfaces change (`/comunidades` list, the community page, the story composer); the design system and the existing components cover all three.
**Research needed**: None. Every mechanism already exists; this phase is wiring, not invention.
**Notes**: Criteria 3 and 5 are ONE mechanism, not two — plan them together. Criterion 5 puts a community selector in the composer; criterion 3 is that same selector arriving PRE-FILLED when the admin came from a community page (the `?comunidade=` param seeds it). Building 3 as its own context-only path would leave the composer's own flow unanswered and invent a second way to attach a story. NO SCHEMA CHANGE. `story_community_pins` (`packages/modules/stories/db/schema.ts:152`) is already many-to-many, so creating the story and its pin together satisfies criterion 3 additively — the post-hoc pin flow from `/stories/meus` (`PinStorySheet`) stays exactly as shipped and remains the way to attach a story to ADDITIONAL communities. Criteria 1 and 2 are the same defect shape twice: a working route with nothing linking to it. Source: Phase 5 UAT, 2026-09-24, all three user-reported — criterion 2 is carried from `05-UAT.md` "## Deferred Follow-Ups"; criteria 1 and 3 were reported directly. The user asked that this ship before Phase 6.

Plans:

**Wave 1**

- [x] 05.1-01-PLAN.md — Tracer: a story born attached to a community at `POST /v1/stories` (optional `communityId`, pin written in the same transaction, manage-guarded), the Wave 0 `VIDEO_PROVIDER` pin, and the reset-consent checkpoint

**Wave 2** *(blocked on Wave 1)*

- [x] 05.1-02-PLAN.md — `GET /v1/communities?status=archived`: manager-only (403 otherwise), `updated_at desc, id desc` keyset, no schema change, budget + pgTAP evidence
- [x] 05.1-04-PLAN.md — The story composer asks: `?comunidade=` resolved on the server, the "Publicar em" row and sheet, origin-aware landings, the archived-race refusal

**Wave 3** *(blocked on Wave 2)*

- [x] 05.1-03-PLAN.md — `/comunidades`: title-row "Criar comunidade", manager-only `Ativas`/`Arquivadas` chips, the `Arquivada` pill on archived cards

**Wave 4** *(blocked on Wave 3)*

- [x] 05.1-05-PLAN.md — The community page: one-tap `Reativar`, the Destaques `+` into the composer, the catalog pins, the three UAT replays in a browser and the phase gate

### Phase 05.2: Story Highlights (INSERTED)

**Goal**: Stories work like Instagram's. Início shows ONE circle with all active stories and, beside it, one circle per highlight; a community page shows only its highlights. An `admin_tenant` curates named highlights and adds each story to a specific one. This replaces today's loose "pin a story to a community" model, which Phase 05.1 just wired into the composer.
**Depends on**: Phase 05.1 (`story_community_pins`, the born-attached publish, the composer's "Publicar em" row, `PinStorySheet`)
**Requirements**: HIGHLIGHT-01..HIGHLIGHT-06, STORY-04 (re-delivered through highlights)
**Success Criteria** (what must be TRUE):

  1. An `admin_tenant` creates, renames, re-covers, reorders and deletes named highlights (title + cover) on Início and on any community, and adds or removes a story from a SPECIFIC highlight. Stories kept in a highlight stay viewable after the 24 h window.
  2. **Início:** ONE circle holds all of the tenant's active (< 24 h) stories and plays them in sequence in the existing viewer; the Início highlights sit beside it in the same row, one circle each, each opening only its own stories. This deliberately REVERSES D-78 ("one circle per active story, never grouped", `packages/modules/stories/ui/StoriesStrip.tsx:18`).
  3. **Community page:** NO active-stories circle, only that community's highlights, one circle each.
  4. Loose pinning is REFACTORED into highlights, not kept alongside them: `story_community_pins`, the `/stories/meus` `PinStorySheet` and 05.1's born-attached publish become "add to highlight"; publishing from a community asks for one of that community's highlights. Every existing pin is migrated without loss (proposed default: one "Destaques" highlight per community that has pins).
  5. Highlight tables carry `tenant_id` with RLS, covered by pgTAP cross-tenant negative tests; the migration that rewrites the pin model is planned and reviewed explicitly.

**UI hint**: yes — highlight circles on Início and on the community page, create/edit highlight sheet, "add to highlight" sheet.
**Research needed**: Yes — the migration from `story_community_pins`, and the Instagram grouped-viewer behaviour (resume from the first unseen story).
**Notes**: Publishing is still admin-only in this phase; member authoring arrives in Phases 9/10 (post-MVP) and must fit this model, not reshape it. Open questions for discuss-phase: (a) can one story sit in several highlights (Instagram: yes); (b) cover = uploaded image or a frame of one of its stories; (c) where the admin's publish door lives once the own-circle (D-80) becomes the grouped circle; (d) how the grouped circle shows seen vs unseen (V2-CONT-05 "seen/unseen ring" may need pulling in). There is NO feed-level pin today, so the Início half is new. Source: user requests 2026-09-25; 05.2 was split into 05.2-05.5 the same day for vertical, independently shippable slices, and later that day the MVP cut made Reels 05.3 and moved the two "Rede social" phases to 9-10.

**Plans**: 12/12 plans executed

Plans:

**Wave 1**

- [x] 05.2-01-PLAN.md — Tracer: highlights at the API end to end (two tables, migration file 1 with the pin backfill and its no-loss guard, live replay after a backup), the reset consent, pgTAP 120, two-tenant isolation and the seeded highlights
- [x] 05.2-02-PLAN.md — The D-33 design gate: sketch 004 for the seven prototype-less surfaces, shipped `approved: false`

**Wave 2** *(blocked on Wave 1)*

- [x] 05.2-03-PLAN.md — Curation API: the image-only cover decision, rename / re-cover / delete / remove, reorder, the sheet's catalogue and membership reads, `highlightCount`, communities-off, the full event vocabulary

**Wave 3** *(blocked on Wave 2 and the sketch approval)*

- [x] 05.2-04-PLAN.md — Início: one tenant circle (logo + name, oldest → newest) plus Início's highlight circles; the reworked circle and strip

**Wave 4**

- [x] 05.2-05-PLAN.md — The grouped viewer: next circle at a boundary, swipe skips a circle, lazy highlight groups, composite keys, the segment-shown callback

**Wave 5**

- [x] 05.2-06-PLAN.md — The shared highlight sheet (checklist + single-select + title step) and "Destacar" in the viewer

**Wave 6**

- [x] 05.2-07-PLAN.md — "Seus stories" curates highlights; the pin sheet and the web's pin calls are deleted

**Wave 7**

- [x] 05.2-08-PLAN.md — Publishing into a highlight (existing or inline, one write) and the community page's highlight row; the composer's "Destaque" row replaces "Publicar em"

**Wave 8**

- [x] 05.2-09-PLAN.md — The manage screens (`/stories/destaques`, `/comunidades/[id]/destaques`), the edit sheet, reorder, covers, and the admin-only manage and empty-highlight circles

**Wave 9**

- [x] 05.2-10-PLAN.md — Server-side seen state: `story_views`, `POST /v1/stories/views`, the seen ring and resume-at-first-unseen

**Wave 10**

- [x] 05.2-11-PLAN.md — Retire the pin model behind a one-way `checkpoint:decision`: delete the pin API and contract, drop the table (migration file 2), rehearse file 1 → file 2 on an edge fixture

**Wave 11**

- [x] 05.2-12-PLAN.md — Phase gate: the six-step UAT replay in one e2e spec (cross-device seen ring as a second browser context) and the full local suite

### Phase 05.3: Reels (INSERTED)

**Goal**: A full-screen "Reels" tab plays the feed's video posts in a vertical pager, following the design team's print (`.planning/phases/05.3-reels/reels-design.png`) and the prototype's `reference/frontend-design/app/(app)/reels/page.tsx`.
**Depends on**: Phase 4 (feed video posts, their likes and comments)
**Requirements**: REELS-01, REELS-02, REELS-03, REELS-04, REELS-05, REELS-06, REELS-07, REELS-08
**Success Criteria** (what must be TRUE):

  1. A member opens Reels from the bottom navigation and sees video posts only (feed data filtered to `media_kind = 'video'`), full-screen, one per page: swipe up/down changes video, muted by default with a mute toggle, author name, community chip, caption, and a right rail with author avatar, like (with count) and comment (with count, opening the comment sheet).
  2. Likes and comments are the feed's own, not a parallel system: a like in Reels shows on the same post in Início.
  3. Reels shows the videos Início shows: in the MVP these are `admin_tenant` video posts, visible to every member. Member videos (followers only) arrive with the "Rede social" module, which extends Reels in Phase 9; nothing here may assume they exist.

**UI hint**: yes — ported from the prototype's reels page (index pager, not scroll-snap).
**Research needed**: Light — Mux autoplay/mute policy on iOS, and preloading the next video.
**Notes**: Part of the MVP (user decision 2026-09-25): Reels is a new tab that filters the feed to video posts, so it moved ahead of the "Rede social" phases. It was 05.5 and "placed last so it is built once over the final set of video sources"; adding member videos is now Phase 9's job. Open questions for discuss-phase: (a) the prototype's lanes "Para você / Resultados / Bastidores" have no data model — fixed lanes, tags, or communities? (b) whether Reels is its own toggleable module or rides on `feed`; the user's framing ("a new tab that filters the feed by video") points to riding on `feed`. Source: user request 2026-09-25.

**Plans**: 9/9 executed + 1 gap-closure plan (05.3-10) planned from `05.3-VERIFICATION.md`

Plans:

**Wave 1**

- [x] 05.3-01-PLAN.md — Tracer: Reels at the API end to end (the `reels` key and its backfill with a live replay after a backup, `requires: ['feed']` through `effectiveKeys`, the reels manifest package, feed's `?media=video` filter and partial index), the reset consent, pgTAP 130 and every API pin for the seventh key
- [x] 05.3-04-PLAN.md — The D-33 design gate: sketch 005 for the six prototype-less Reels surfaces, the user records the approval

**Wave 2** *(blocked on Wave 1; plan 05 also on the sketch approval)*

- [x] 05.3-02-PLAN.md — The lanes read (`GET /v1/feed/video-communities`) and the REELS-03/04 API battery: equality with Início, isolation b9, one-statement budgets, the lanes EXPLAIN pin
- [x] 05.3-03-PLAN.md — Declarative media chrome in the kernel shell (TopBar hidden, dark BottomNav) and every e2e nav and module-switch pin for the new tab
- [x] 05.3-05-PLAN.md — The props-only pager: `DoubleTapHeart`'s opt-in single tap and slop, windowed ticks, the stage, the playback-error block, gestures, keyboard, wheel and the desktop column

**Wave 3**

- [x] 05.3-06-PLAN.md — The lane tablist, the rail with share, the two-line caption over the veil, compact counts, and `LikeButton`'s over-media tone
- [x] 05.3-07-PLAN.md — `ReelVideo` (muted start, loop, fit, muted-pref opt-outs, refusal fallback), the batched token mint and the web data path

**Wave 4**

- [x] 05.3-08-PLAN.md — The `/reels` route and its host: lanes, paging, sound for the visit, pause sources, token preloading, the feed's like, comments and share, empty/loading/error states, the catalog, the first e2e case

**Wave 5**

- [x] 05.3-09-PLAN.md — The Reels browser battery (lanes, paging, sound, like parity, comments, share, empty state, requires-feed, error states, long-text backstops) and the phase exit gate

**Wave 6** *(gap closure — the FAILED truth 6 of `05.3-VERIFICATION.md`)*

- [x] 05.3-10-PLAN.md — CR-01 / REELS-07: per-post like and comment-count state promoted to `ReelsHost` so a like or comment survives the ±1 mount window, lane changes and the same post in two lanes (remount matrix + e6 swipe-away-and-back step); plus WR-01 (capture-phase release on the pager stack), WR-02 (player keyed on its playback credential) and WR-03 (function replacements in the live region), each with a regression

### Phase 6: Events

**Goal**: `admin_tenant` publishes in-person and online events; members see what is coming, confirm attendance, check in on the day and add events to their calendar; the admin sees who confirmed and who showed up.
**Mode:** mvp
**Depends on**: Phase 4 (content conventions, media covers); independent of Phase 5
**Requirements**: EVENT-01, EVENT-02, EVENT-03, EVENT-04, EVENT-05, EVENT-06
**Success Criteria** (what must be TRUE):

  1. `admin_tenant` can create, edit and cancel an event with title, description, cover image, timezone-aware start/end and either a physical location or an online link, from a phone; members see upcoming and past lists and an event detail rendered in the tenant's timezone.
  2. Member can confirm attendance (going / not going) before the event and see the number of confirmed attendees; on the day, within the check-in window around the start, member can check in, and a check-in without prior RSVP is recorded as a walk-in.
  3. `admin_tenant` can see the attendance list per event with confirmed vs checked-in status.
  4. Member can add an event to their calendar via .ics download and a Google Calendar link.

**Plans**: 9/9 plans executed

Plans:

**Wave 1**

- [x] 06-01-PLAN.md — Tracer: `@rede-social/module-events` with `events` + the role-gated `event_secrets`, wall-clock→UTC create, the Próximos/Passados keysets in the tenant timezone, `bootstrap.tenant.timezone`, the `Eventos` tab, pgTAP 130 + isolation, the seeded events
- [x] 06-02-PLAN.md — The D-33 design gate: a sketch of the six prototype-less surfaces plus the three proto deltas, shipped `approved: false`

**Wave 2** *(blocked on Wave 1; Task 3 blocked on the sketch approval)*

- [x] 06-03-PLAN.md — Detail page + RSVP: `event_attendances`, the `app.event_attendance_guard()` trigger, counts (D-219), `SegmentedControl`, `Vou` / `Não vou`

**Wave 3** *(blocked on Wave 2 and the sketch approval)*

- [x] 06-04-PLAN.md — Admin authoring from a phone: `EventForm` create/edit, `PUT`/`PATCH`, cancel and `Reativar`, `event.updated`/`cancelled`/`reactivated`

**Wave 4**

- [x] 06-05-PLAN.md — In-person check-in: `app.events_check_in` (SECURITY DEFINER, outcomes, guess bound), walk-ins, the ported boarding-pass ticket

**Wave 5**

- [x] 06-06-PLAN.md — Online `Entrar`: `app.events_enter`, the `/eventos/{id}/entrar` route handler and refusal page, calendar-link login continuity, the production-build prefetch proof

**Wave 6**

- [x] 06-07-PLAN.md — `Participantes`: three keyset chips with counts, walk-in tag, the door code and its regeneration

**Wave 7**

- [x] 06-08-PLAN.md — Calendar export (`.ics` + Google link, online location = `/entrar`) and the Início "Próximo evento" card that becomes the check-in door

**Wave 8**

- [x] 06-09-PLAN.md — Tenant timezone everywhere (feed + media pins retired), SCHEMA-CONVENTIONS §(l), the phase witness, `pnpm verify` and the phone UAT

**UI hint**: yes
**Research needed**: None (conventional); confirm the pilot tenant's timezone handling (store UTC + tenant timezone field, render America/Sao_Paulo).
**Notes**: `events.attendances` holds one row per user with `going | not_going | checked_in` transitions (no boolean pairs). `event.published`, `event.rsvp`, `event.cancelled` domain events are emitted here; reminder scheduling and delivery (EVENT-07) are built in Phase 7 once the notification module exists.

### Phase 7: Notifications, Web Push & Chat

**Goal**: Members are reached in real time - a notification bell with live unread count, Web Push in the installed PWA and a live 1:1 support conversation - all fed by domain events over one shared realtime infrastructure (Supabase Broadcast on private topics, ids only, data always through the API).
**Mode:** mvp
**Depends on**: Phase 4, Phase 5, Phase 6 (event producers), Phase 2 (PWA shell and iOS install hint)
**Requirements**: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, EVENT-07, PWA-02, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05
**Success Criteria** (what must be TRUE):

  1. Member receives in-app notifications, produced by the worker from domain events, for likes on their comments, comments/replies on their comments, new posts, new events, event reminders (24 h and 1 h before, from a scheduled job, only to members who confirmed) and support replies; the bell's unread count updates in real time without refresh, the list opens the target screen on tap, and mark-as-read works.
  2. Member in the installed PWA can enable Web Push (on iOS the "Adicionar a Tela de Inicio" hint is shown first and the permission prompt is gesture-triggered in standalone mode); push messages carry the tenant's name and icon and open the relevant screen; expired subscriptions (404/410) are removed; delivery goes through a channel abstraction (in-app, push) that later accepts e-mail/WhatsApp adapters.
  3. Member can open their single support conversation and send text messages; `support_tenant` sees an inbox of member conversations ordered by last activity with unread indicators and can open and reply to any of them; new messages appear in real time on both sides in per-conversation sequence order (catch-up after reconnect loses nothing), and the member sees an unread badge on the chat entry when support replied.
  4. Realtime signals reach only their audience: a browser subscribing to another tenant's user topic, another user's conversation topic or the support inbox without the role is rejected by RLS on `realtime.messages` (covered by the isolation suite); payloads carry ids only and the client refetches through the API; blocking a member drops their Realtime access and push subscriptions.

**Plans**: 4/11 plans executed

Plans:

**Wave 1**

- [x] 07-01-PLAN.md — Tracer: `@rede-social/module-notifications`, the kernel notification-source seam, the reshaped `notifications`, Realtime authorisation (`app.realtime_topic_allowed`, the `realtime.messages` policy, `app.realtime_signal`), the fan-out definer, the feed's `post.published` source, the list with seen/read, real bootstrap counters, pgTAP 150/151 (local reset gated on the developer's consent)
- [x] 07-02-PLAN.md — The D-33 design gate: sketch 007 of the nine prototype-less surfaces plus the two proto deltas, shipped `approved: false`

**Wave 2**

- [x] 07-03-PLAN.md — Live bell: `@supabase/realtime-js@2.116.0` behind a legitimacy checkpoint, the BFF token route, the kernel `RealtimeProvider`/`LiveCountersProvider`, `/v1/me/counters`, the live SC 4 negatives, the app badge

**Wave 3** *(Task 3 blocked on the sketch approval)*

- [x] 07-04-PLAN.md — Content kinds: likes/replies on a member's comments, stories, story comments, keep-and-mark retraction, 90-day prune through the sweeper, deep links with the comment highlight and the expired-story notice

**Wave 4** *(Task 2 blocked on the sketch approval)*

- [ ] 07-05-PLAN.md — Event kinds and EVENT-07: published/reactivated sources, in-transaction reminder arming, the `events.reminder` job with fire-time checks, `event.reminder_due`, the backfill script

**Wave 5**

- [ ] 07-06-PLAN.md — Push backend: `push_subscriptions`, the push channel on the registry, `notifications.push-send`, the fake/web-push transport seam, VAPID env rules, pgTAP 153

**Wave 6** *(Task 2 blocked on the sketch approval)*

- [ ] 07-07-PLAN.md — Push web: the service-worker handlers, the tap-only subscribe flow, the Configurações switch, the soft-ask card, the iOS `InstallHint` push variant, logout unsubscribe

**Wave 7**

- [ ] 07-08-PLAN.md — Chat backend: `@rede-social/module-chat`, the seq and signal triggers, participant-aware RLS, lazy support thread, staff reply and inbox, shared read state, dot/count counters, push-only support source, pgTAP 152

**Wave 8** *(Task 2 blocked on the sketch approval)*

- [ ] 07-09-PLAN.md — Chat web (member): the re-homed linkifier, bubbles and composer, `/suporte` thread with live append and catch-up, the dot badge

**Wave 9** *(blocked on the sketch approval)*

- [ ] 07-10-PLAN.md — Chat web (staff): the inbox, the staff thread with the profile link and read-only states, the desktop split view

**Wave 10**

- [ ] 07-11-PLAN.md — Phase gate: the isolation sweep, `phase7-smoke.spec.ts`, DEPLOY.md release steps (VAPID secrets, Realtime private-only, quota), the real-device test plan (blocked until run), `pnpm verify`

**UI hint**: yes
**Research needed**: Shape and cost of RLS policies on `realtime.messages` (membership join vs claim) and `realtime.send` vs `broadcast_changes` trigger choice; Realtime connection quota sizing on the Free plan; "new post to every member" fan-out strategy (eager rows vs hourly collapse) decided with pilot member count; iOS 16.4+ standalone push gating, Badging API support, push handlers in the Serwist service worker; per-conversation `seq` generation under concurrent inserts and catch-up cursor semantics; private-channel authorization tests for non-participants.
**Notes**: Build order inside the phase: notifications + Realtime provider first (lowest-risk realtime consumer), then push (real-iPhone and Android test plan is a deliverable), then chat reusing topics, worker, push and unread patterns. Chat schema (`conversations` with `kind`, `participants` with `role`/`last_read_at`, `messages` with `seq`) is generic so V2 member-to-member chat is a `kind` value, not a migration; one open support conversation per member enforced by a partial unique index. Notification fan-out is idempotent on `(event_id, user_id)` and never runs inside the producing request. Member-to-member direct messages (CHAT-06), member blocking (CHAT-07) and the follower-scoped notification rules moved to Phase 11 (post-MVP) on 2026-09-25; they reuse this phase's conversations, topics, unread badge and push.

### Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening

**Goal**: `admin_tenant` can run their community from a phone - brand, members and roles, moderation, community rules - with every action taking effect immediately and being logged; the platform passes the pilot go-live gate (isolation, i18n, real-device PWA, module reuse docs).
**Mode:** mvp
**Depends on**: Phase 7 (blocking must revoke Realtime and push); all MVP content modules
**Requirements**: MODER-01, MODER-02, MODER-03, ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, MOD-05
**Success Criteria** (what must be TRUE):

  1. `admin_tenant` can delete any comment or reply in their tenant (soft-delete with `deleted_by`, replies and related notifications cascade), block a member (their session is revoked immediately, they cannot log in to the tenant, and cannot re-register with the same e-mail through the sign-up link) and unblock them; every delete/block/unblock appears in an append-only moderation log with actor, target, timestamp and optional reason that the admin can view.
  2. `admin_tenant` can edit the tenant's branding (logo, colors, favicon, display name) with a live preview of the app shell and contrast validation, list and search members, change a member's role (member / support_tenant / admin_tenant), and edit the community rules text shown at sign-up.
  3. Every admin creation flow - post, story, community, event - plus branding, member management and moderation is usable end-to-end from a phone inside the same app (verified on a real device).
  4. Each module package ships a README documenting its public interface (contracts, emitted/consumed events, flag key, kernel dependencies) and one module can be copied into a fresh app that provides only the kernel contracts; the pilot go-live gate passes: full two-tenant isolation suite across every endpoint, storage URL and Realtime topic, pt-BR catalog audit with zero UI literals, and PWA install + push smoke tests on a real iPhone and Android.

**Plans**: TBD
**UI hint**: yes
**Research needed**: None (thin screens over columns that exist since Foundation/Feed; hardening is checklist-driven). Flag LGPD legal review to the user before go-live (research covered mechanics only).
**Notes**: Hardening items without a requirement of their own but expected here: `EXPLAIN` checks on feed/notification/chat queries with a 10k-row seed, Sentry + structured logging with `tenant_id`/`request_id`, Cloud Run config in git (`min-instances=1`, cpu-boost, timeouts), backups/rollback rehearsal, CORS locked to the single origin in production, a11y pass, build-output check for static routes under `(app)`. Moderation of member content (MODER-04) and the reports queue (MODER-05) moved to Phase 11 (post-MVP) on 2026-09-25; this phase's go-live gate closes the MVP.

### Phase 9: Rede Social - Follow, Member Posts and Explorar

**Goal**: A tenant can open up member authoring. With the new "Rede social" module on, members follow each other and publish feed posts, and the new "Explorar" tab shows only posts from people they follow, while Início stays the organization's voice (admin posts only).
**Scope**: Post-MVP (user decision 2026-09-25); starts after the Phase 8 go-live gate.
**Depends on**: Phase 8 (MVP complete), Phase 05.2 (the highlights model member authoring must fit), Phase 05.3 (Reels, extended here to member videos)
**Requirements**: TBD (new SOCIAL-*, FOLLOW-*, EXPL-*); promotes V2-CONT-01
**Success Criteria** (what must be TRUE):

  1. A new toggleable module **"Rede social"** (key `social` in `TOGGLEABLE_MODULES`) is turned on or off per tenant by the `super_admin` like every other module. Off (the default) is exactly today's product. It is the single switch for member authoring and supersedes the feed's `settings.postingPolicy` flag (FEED-08) instead of living beside it. The Explorar tab and the follow graph belong to this module, not to a separate "Explorar" key: without member authoring Explorar would have nothing to show. Turning it off hides Explorar, removes member publish controls and makes those routes 404, without deleting anything already published.
  2. With `social` on, a member can follow and unfollow another member of the same tenant (one-directional, Instagram-style) and see follower/following counts. Following never crosses tenants (RLS + pgTAP cross-tenant negative tests).
  3. With `social` on, a member can publish a feed post. Início shows ONLY posts authored by `admin_tenant`; a post by anyone else appears ONLY in the Explorar tab of the people who follow its author. There is no personal/profile feed (explicitly out of scope, user decision 2026-09-25).
  4. Explorar lists posts from followed people, keyset-paginated, newest first, with the same likes and comments as the feed, and an empty state that says so when the member follows nobody, pointing to the member directory (`/membros`, PROF-03) to find people.
  5. Member profile (only with `social` on): another member's profile shows a follow/unfollow button and follower/following counts. This REVERSES D-45 ("photo, display name and bio ONLY; no counts, no follow/message affordance", enforced by `memberProfileSchema.strict()` in `packages/contracts/src/profiles.ts:150`) conditionally: with `social` off the profile is exactly D-45's. The directory `/membros` links to these profiles.
  6. Member uploads are bounded: the module defines limits for member media (file size, video duration, and whether members may upload video at all, set per tenant by the `super_admin`), because Mux bills per minute stored/delivered and the Supabase Free plan has 1 GB of storage.
  7. Reels (Phase 05.3) follows the same visibility as the feed: admin videos stay visible to everyone, and a member's video posts appear only for that author's followers; a like or comment in Reels shows on the same post in Início or Explorar.

**UI hint**: yes — follow button and counts on the member profile/author, Explorar tab reusing the feed list, member composer.
**Research needed**: Yes — the permission model becomes module-conditional (today permissions are a static role map in each `module.ts`); the Explorar query and its index (`follows` join vs. denormalised fan-out) under the feed-query budget.
**Notes**: Open questions for discuss-phase: where else the follow button lives (post author header?); who may see someone's follower/following lists. Pending, not code: with `social` on, the tenant and Rede Social host third-party content, so the terms of use / community rules accepted at sign-up (AUTH-01) may need new wording (LGPD, liability) — flag to the user before `social` is turned on for any tenant. Source: user requests 2026-09-25; numbered 05.3 until the MVP cut the same day moved the "Rede social" module after Phase 8.

Plans:

- [ ] TBD (run /gsd-plan-phase 9 to break down)

### Phase 10: Rede Social - Member Stories and Communities

**Goal**: With "Rede social" on, members also publish stories and create their own communities, and a community only accepts publications from whoever created it.
**Scope**: Post-MVP (user decision 2026-09-25).
**Depends on**: Phase 9
**Requirements**: TBD; promotes V2-CONT-02 and lifts the "member-created stories" exclusion (user decision 2026-09-25)
**Success Criteria** (what must be TRUE):

  1. With `social` on, a member can publish stories. Início's grouped circle stays admin-only (the organization's voice); a member's active stories show in Explorar for their followers, one circle per author (Instagram model), built on 05.2's grouped viewer.
  2. With `social` on, a member can create a community (and its highlights, per 05.2).
  3. Only a community's creator (`communities.created_by_user_id`) can publish in it: posts, stories and highlights. Other members see and interact (like, comment) but get no publish control there and a 403 from the API if they try. This holds for communities created by `admin_tenant` and by members alike.
  4. Turning `social` off stops new member stories and communities; existing member communities stay readable.

**UI hint**: yes — member story composer and create-community entry points, gated by the module; Explorar story row.
**Research needed**: Light — reuse 05.1's composer and community form; the change is the permission seam (creator-scoped publishing).
**Notes**: Open question for discuss-phase: does `admin_tenant` keep moderation powers (archive, delete content) over member-created communities even though it cannot publish in them? Recommended: yes, moderation stays with the tenant (MODER-04, Phase 11). Source: user requests 2026-09-25; numbered 05.4 until the MVP cut the same day.

Plans:

- [ ] TBD (run /gsd-plan-phase 10 to break down)

### Phase 11: Rede Social - Direct Messages, Member Blocking and Reports

**Goal**: With "Rede social" on, members message each other 1:1, block people they don't want to hear from, and are notified about the social activity that concerns them; members can report content and `admin_tenant` moderates member content through a reports queue.
**Scope**: Post-MVP (user decision 2026-09-25); split out of Phases 7 and 8 so the MVP ships without the "Rede social" module.
**Depends on**: Phase 7 (conversations, realtime topics, unread badge, push), Phase 8 (moderation log, tenant-level block), Phase 9 (follow graph, member posts), Phase 10 (member stories and communities)
**Requirements**: CHAT-06, CHAT-07, MODER-04, MODER-05
**Success Criteria** (what must be TRUE):

  1. With the "Rede social" module (`social`, Phase 9) on, a member can start a 1:1 direct conversation with any other member of the same tenant from that member's profile ("Enviar mensagem") and exchange text messages — following is NOT required (user decision 2026-09-25). With `social` off, members talk only to support, as before. It reuses the same conversation schema (`kind = 'direct'`), realtime topics, unread badge and push as the support chat; there is at most one direct conversation per pair of members; the other tenant's members are never reachable (RLS + isolation-suite negative test).
  2. With `social` on, a member can block another member: the blocked member can no longer message them, follow them, or see a message button on their profile, and an existing direct conversation stops accepting messages from them; unblocking restores it. This is distinct from the admin's tenant-level block (Phase 8).
  3. Notification rules account for member authoring: `admin_tenant` posts notify every member as before; a member's post notifies only that author's followers (or nobody — decide in discuss-phase), never the whole tenant; "started following you" and "new direct message" are new notification types (both only with `social` on).
  4. With `social` on, `admin_tenant` moderates member content: soft-deletes any member post or story and archives or removes any member-created community (even though it cannot publish in one, Phase 10), every action written to the moderation log.
  5. With `social` on, a member can report a post, story, community, comment or direct message with a reason, and `admin_tenant` works a reports queue (dismiss / remove content / block author). Promotes V2-MODER-01 (user decision 2026-09-25).

**UI hint**: yes — "Enviar mensagem" on the member profile, direct conversations in the chat list, block/unblock controls, report sheet, admin reports queue.
**Research needed**: Light — reuses Phase 7's chat and notification infrastructure and Phase 8's moderation log; the new parts are one direct conversation per pair of members, member-block enforcement across messaging, follow and profile, and follower fan-out for member-post notifications.
**Notes**: Split out on 2026-09-25 from Phase 7 (criteria 5-7: CHAT-06, CHAT-07, the follower-scoped notification rules) and Phase 8 (criteria 5-6: MODER-04, MODER-05) when the "Rede social" module moved after the MVP. Phase 7's chat schema keeps `kind`, so direct conversations need no migration.

Plans:

- [ ] TBD (run /gsd-plan-phase 11 to break down)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 05.1 -> 05.2 -> 05.3 -> 6 -> 7 -> 8, whose go-live gate closes the MVP, then the post-MVP "Rede social" phases 9 -> 10 -> 11. Phase 01.1 (cloud provisioning) is out of band: it depends only on Phase 1 and runs whenever the accounts exist; it must be complete before the Phase 8 pilot go-live gate.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation - Kernel, Tenancy, Auth & CI/CD | 9/9 | Complete    | 2026-09-14 |
| 01.1. Cloud Provisioning & First Release (INSERTED) | 0/3 | Deferred (needs accounts) | - |
| 2. Tenant Shell, Branding & Platform Panel | 20/20 | In Progress|  |
| 3. Media Pipeline & Member Profiles | 8/8 | In Progress|  |
| 4. Feed | 10/10 | In Progress|  |
| 5. Communities & Stories | 12/12 | Complete    | 2026-09-25 |
| 6. Events | 9/9 | In Progress|  |
| 7. Notifications, Web Push & Chat | 4/11 | In Progress|  |
| 8. Moderation, Tenant Admin Panel & Pilot Hardening | 0/TBD | Not started | - |
| 9. Rede Social - Follow, Member Posts and Explorar | 0/TBD | Not started | - |
| 10. Rede Social - Member Stories and Communities | 0/TBD | Not started | - |
| 11. Rede Social - Direct Messages, Member Blocking and Reports | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-11*
