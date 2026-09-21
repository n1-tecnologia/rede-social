# Roadmap: TRIA Rede Social

## Overview

TRIA Rede Social is a multi-tenant, white-label community PWA: one deployment, each organization reached on its own custom domain (the platform domain serves TRIA's `super_admin`), each organization's members see their own brand and only their own content. The roadmap follows the dependency spine the research identified (kernel + tenancy + auth -> branded shell + platform panel -> media broker + profiles) and then ships content modules in the order that lets each one reuse the conventions of the previous (feed establishes likes/comments/pagination/domain events; communities and stories build on posts; events introduce scheduled jobs). The realtime layer (notifications, Web Push, support chat) comes after all event producers exist, and the last phase gives the tenant admin their moderation and admin panel while running the pilot go-live gate. Eight phases, each a deployable vertical slice (schema + API + UI) except the unavoidable foundation phase, which still ends with a real login against a real tenant.

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
- [ ] **Phase 5: Communities & Stories** - Admin-created communities with scoped posts, community pages with pinned stories, 24 h stories strip + full-screen viewer, story likes and flat comments
- [ ] **Phase 6: Events** - In-person / online events, upcoming + past lists, RSVP and self check-in window, admin attendance list, calendar export
- [ ] **Phase 7: Notifications, Web Push & Support Chat** - Realtime infrastructure (Supabase Broadcast on private topics), event-driven notification center with live unread count, Web Push with iOS install flow, event reminders, 1:1 member <-> support chat with support inbox
- [ ] **Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening** - Delete any comment, block/unblock with immediate revocation, moderation log, branding editor with live preview, member/role management, rules editor, mobile admin flows, per-module READMEs, pilot go-live gate

## Phase Details

### Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD

**Goal**: Two isolated tenants exist on the local Supabase stack, with the deploy pipeline written as code (the hosted staging + production stack lands in Phase 01.1); a person can sign up through a tenant's public link, log in, stay logged in, recover their password and log out, and the API serves only their tenant's data through an RLS-protected database lane.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: TENANT-01, TENANT-03, TENANT-05, MOD-01, MOD-02, ROLE-01, ROLE-02, ROLE-06, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):

  1. A user who signs up through tenant A's public sign-up link on tenant A's own domain (accepting A's community rules and TRIA's terms, recorded with a timestamp) becomes a `member` of tenant A, can log in with e-mail and password, stays logged in after closing and reopening the browser, can recover a forgotten password via e-mail link, and can log out; the sign-up link survives the register -> login round-trip.
  2. After login, `GET /me/bootstrap` returns the user's tenant, role and enabled modules resolved from their membership row (the hostname only selects the public shell; a session whose membership does not belong to the host's tenant gets 403 `TENANT_HOST_MISMATCH`); a member whose membership is set to blocked receives 401/403 on their very next API request without redeploy or re-login.
  3. The automated two-tenant isolation suite (pgTAP + API integration tests) passes: every tenant-owned table carries `tenant_id` with RLS enabled, the API's tenant lane runs under a non-service database role inside a per-request transaction, no list or detail endpoint returns another tenant's rows, and routes of a module disabled for the tenant return 404.
  4. The monorepo has a kernel package, a feature-module package template and lint/dependency rules that fail the build when a module imports another module's internals; the delivery pipeline exists as code (Cloud Run image for API + worker, `ci.yml` mirroring the local exit gate, `deploy-api.yml` with staging on PR and a gated production job, `docs/DEPLOY.md` listing every secret) and is validated locally (YAML, grep assertions, Docker build/run). Running it against real accounts is Phase 01.1.

**Plans**: 9/9 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Walking skeleton: toolchain + @tria monorepo scaffold (all packages except `apps/web`); tracer JWT → JWKS auth → membership → RLS tenant lane → `GET /v1/me/bootstrap`; `tenant_domains` + `GET /v1/public/tenants/by-host` + host/membership match (403 `TENANT_HOST_MISMATCH`) + seeded tenant hosts (D-20/D-23/D-24)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — `@tria/web` scaffold + browser login/logout slice: host → tenant resolution in proxy.ts (tenant / platform / generic hosts, D-20/D-21), `@supabase/ssr` session, pt-BR catalog, `/entrar` (tenant name from the host, D-22), `/inicio`, "Sair", Playwright on iPhone 14 against `tria-demo.localhost`
- [x] 01-03-PLAN.md — Supavisor/PgBouncer lane spike + LOCAL-settings guard + fallback doc; `platform_admins`, chat/notification stubs, SCHEMA-CONVENTIONS.md
- [x] 01-09-PLAN.md — Pipeline as code: Dockerfile (API + worker), ci.yml, deploy-api.yml (staging on PR, gated prod on main), seed-prod, keep-alive, DEPLOY.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — Sign-up slice: `https://{tenant-domain}/cadastro` (slug from the host) + `/cadastro/{slug}` on generic hosts (D-22), two consents → `consent_records`, `POST /v1/public/signup/:slug` (admin lane, duplicate 409), legal texts
- [x] 01-05-PLAN.md — Password recovery (origin-derived links, Mailpit e2e, `/auth/confirm` guard), blocked-member contract (403 on next request, "acesso suspenso") and host-mismatch screen ("Este endereço não pertence à sua comunidade.", D-23)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-06-PLAN.md — Module registry, `tenant_modules`, flags cache, `requireModule`/`requireRole`/`requireSuperAdmin` (platform sessions only off tenant hosts, D-23), bootstrap modules + permissions, platform-host `/inicio` for the super_admin (D-21), seed per D-17 (hosts kept)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-07-PLAN.md — `@tria/module-example` (D-19): table + guarded routes + typed event + transactional pg-boss job + worker role + widget on `/inicio`

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-08-PLAN.md — Two-tenant isolation suite (pgTAP + API, incl. `tenant_domains` and "session of A on B's host → 403 `TENANT_HOST_MISMATCH`"), boundary negative fixture, [BLOCKING] clean `supabase db reset` + full suite

**Research needed**: Supavisor transaction pooling with `set_config(..., true)` + `SET LOCAL ROLE authenticated` (verify with a spike before schema freeze; fallback is a per-request Supabase client with the user JWT); dedicated `api_user` role grants; pg-boss transactional enqueue with Drizzle; Supabase asymmetric signing keys + `@supabase/ssr` cookie flow in Next 16 `proxy.ts`; TypeScript 7 tooling at repo bootstrap.
**Notes**: Auth routes in this phase are functional-minimal (plain forms); their visual port to the prototype's design lands in Phase 2 with the shared UI package. Chat and notification table stubs and the "schema conventions" doc are Foundation deliverables so later modules are reviewed against V2-safe shapes. Tenants are seeded by script/migration until the platform panel exists in Phase 2. Each tenant is served on its own custom domain (`tenant_domains`, host -> tenant lookup in `proxy.ts`); the platform domain hosts TRIA's `super_admin`; the seed tenants use TRIA-owned hostnames so staging/production smoke tests run on real tenant domains.

### Phase 01.1: Cloud Provisioning & First Release (INSERTED)

**Goal**: The Phase 1 codebase runs on a deployed staging + production stack: the accounts exist, the pipeline written in Phase 1 is wired to them, and a push to `main` deploys the web app to Vercel and the API + worker to Cloud Run through GitHub Actions with separate preview/staging and production environments (two Supabase projects, migrations applied only by CI).
**Mode:** mvp
**Depends on**: Phase 1 (plans 01-08 and 01-09). Does NOT block Phases 2-8, which are developed against the local stack; run this phase as soon as the GitHub, Supabase, GCP, Vercel and Resend accounts and DNS control exist.
**Requirements**: PWA-04 (plus hosted evidence for TENANT-03 and AUTH-03: the staging Supavisor transaction-pooler spike and a real recovery e-mail through Resend)
**Success Criteria** (what must be TRUE):

  1. The account shape for D-11/D-12 is decided and recorded in `docs/DEPLOY.md`; the repository exists under `tria-company` with `main` protected and `staging`/`production` environments; two Supabase projects (`rede-social-staging`, `rede-social-prod`) exist and their credentials are GitHub environment secrets.
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

**Goal**: Members open their organization's own domain and see its branded, installable app on phone and desktop, branded already on the login page; TRIA can provision a tenant end-to-end (branding, modules, custom domain, first admin) from the platform panel on the platform domain without touching the database.
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

**Plans**: 8 plans

Plans:
**Wave 1**

- [ ] 03-01-PLAN.md — Media broker keystone: `media_assets`, the private `media` bucket, signed direct upload, worker WebP variants and the zero-DB-read 302 serving endpoint (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 03-02-PLAN.md — Member profile: `member_profiles` keyed by membership with its trigger, backfill and search indexes; own-profile read/write; a real `bootstrap.membership.profile` (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 03-03-PLAN.md — Member directory API: accent-insensitive keyset search, D-47 staff-hidden filters, and the other-member profile route (wave 3)
- [ ] 03-04-PLAN.md — Profile screens: `/perfil`, `/perfil/editar`, the generalised upload hook with TUS and the silent HEIC re-encode, `MediaImage` (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 03-05-PLAN.md — Directory screens `/membros` and `/membros/[membershipId]`, plus the D-02 first-access nudge card on `/inicio` (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 03-06-PLAN.md — Video ingest: the `VideoProvider` seam with a Mux adapter and a local fake, the signature-verified webhook and the idempotent event job (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 03-07-PLAN.md — Signed playback tokens, the `admin_tenant` media screen `/configuracoes/midia` and the three-state `VideoPlayer` (wave 6)

**Wave 7** *(blocked on Wave 6 completion)*

- [ ] 03-08-PLAN.md — Orphan sweeper, the extended two-tenant isolation suite, the phase smoke and the `pnpm verify` exit gate (wave 7)

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

**Plans**: TBD
**UI hint**: yes
**Research needed**: None beyond the conventions doc; acceptance checks (`EXPLAIN`, query count, depth trigger) cover the risks. SSRF-safe unfurl (deny private ranges, follow-redirect limits, timeouts) is implementation detail for the worker job.
**Notes**: `feed.comments` reserves a `story_id` slot and `feed.likes` uses nullable FKs + partial unique indexes so Phase 5 reuses them. Counters are trigger-maintained. The admin composer is the first prototype-less screen designed under the Phase 2 UI-SPEC pattern (ADMIN-04 is verified across all composers in Phase 8).

### Phase 5: Communities & Stories

**Goal**: `admin_tenant` organizes content into communities and broadcasts 24 h stories; members browse communities with their posts and pinned stories, and watch stories in a full-screen viewer with the complete gesture set.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, STORY-01, STORY-02, STORY-03, STORY-04, STORY-05
**Success Criteria** (what must be TRUE):

  1. `admin_tenant` can create, edit and archive communities (name, description, cover image) and post directly into a community from its page; the main feed shows tenant-wide posts plus posts from communities the member can see, and every member sees every community in V1 while a `community_members` table already exists.
  2. Member can browse the community list (cover, name, description, post count) and open a community to see its posts and its pinned stories.
  3. `admin_tenant` can publish a story (image or video up to ~60 s via the streaming vendor, optional caption) from a phone; members see active stories in a horizontally scrollable strip and a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause.
  4. A story leaves the strip 24 h after publishing (hidden by `expires_at`, record retained); a story pinned to one or more communities stays visible on those community pages after expiry until unpinned.
  5. Member can like a story and comment on it; attempts to like or reply to a story comment are rejected by the API and the DB.

**Plans**: TBD
**UI hint**: yes
**Research needed**: None (conventional CRUD; stories viewer reuses the prototype's reels pager gesture model). Requires the design team's answer on the community "highlights" circles as the pinned-stories UI and a viewer spec (PROTOTYPE.md open question 1).
**Notes**: Posts scoped via `community_id`; feed query = tenant-wide OR visible community. Stories strip query is `expires_at > now()`, no cron. Admin story history view is included so expired stories remain reachable to the admin.

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

**Plans**: TBD
**UI hint**: yes
**Research needed**: None (conventional); confirm the pilot tenant's timezone handling (store UTC + tenant timezone field, render America/Sao_Paulo).
**Notes**: `events.attendances` holds one row per user with `going | not_going | checked_in` transitions (no boolean pairs). `event.published`, `event.rsvp`, `event.cancelled` domain events are emitted here; reminder scheduling and delivery (EVENT-07) are built in Phase 7 once the notification module exists.

### Phase 7: Notifications, Web Push & Support Chat

**Goal**: Members are reached in real time - a notification bell with live unread count, Web Push in the installed PWA, and a live 1:1 support conversation - all fed by domain events over one shared realtime infrastructure (Supabase Broadcast on private topics, ids only, data always through the API).
**Mode:** mvp
**Depends on**: Phase 4, Phase 5, Phase 6 (event producers), Phase 2 (PWA shell and iOS install hint)
**Requirements**: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, EVENT-07, PWA-02, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05
**Success Criteria** (what must be TRUE):

  1. Member receives in-app notifications, produced by the worker from domain events, for likes on their comments, comments/replies on their comments, new posts, new events, event reminders (24 h and 1 h before, from a scheduled job, only to members who confirmed) and support replies; the bell's unread count updates in real time without refresh, the list opens the target screen on tap, and mark-as-read works.
  2. Member in the installed PWA can enable Web Push (on iOS the "Adicionar a Tela de Inicio" hint is shown first and the permission prompt is gesture-triggered in standalone mode); push messages carry the tenant's name and icon and open the relevant screen; expired subscriptions (404/410) are removed; delivery goes through a channel abstraction (in-app, push) that later accepts e-mail/WhatsApp adapters.
  3. Member can open their single support conversation and send text messages; `support_tenant` sees an inbox of member conversations ordered by last activity with unread indicators and can open and reply to any of them; new messages appear in real time on both sides in per-conversation sequence order (catch-up after reconnect loses nothing), and the member sees an unread badge on the chat entry when support replied.
  4. Realtime signals reach only their audience: a browser subscribing to another tenant's user topic, another user's conversation topic or the support inbox without the role is rejected by RLS on `realtime.messages` (covered by the isolation suite); payloads carry ids only and the client refetches through the API; blocking a member drops their Realtime access and push subscriptions.

**Plans**: TBD
**UI hint**: yes
**Research needed**: Shape and cost of RLS policies on `realtime.messages` (membership join vs claim) and `realtime.send` vs `broadcast_changes` trigger choice; Realtime connection quota sizing on the Free plan; "new post to every member" fan-out strategy (eager rows vs hourly collapse) decided with pilot member count; iOS 16.4+ standalone push gating, Badging API support, push handlers in the Serwist service worker; per-conversation `seq` generation under concurrent inserts and catch-up cursor semantics; private-channel authorization tests for non-participants.
**Notes**: Build order inside the phase: notifications + Realtime provider first (lowest-risk realtime consumer), then push (real-iPhone and Android test plan is a deliverable), then chat reusing topics, worker, push and unread patterns. Chat schema (`conversations` with `kind`, `participants` with `role`/`last_read_at`, `messages` with `seq`) is generic so V2 member-to-member chat is a `kind` value, not a migration; one open support conversation per member enforced by a partial unique index. Notification fan-out is idempotent on `(event_id, user_id)` and never runs inside the producing request.

### Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening

**Goal**: `admin_tenant` can run their community from a phone - brand, members and roles, moderation, community rules - with every action taking effect immediately and being logged; the platform passes the pilot go-live gate (isolation, i18n, real-device PWA, module reuse docs).
**Mode:** mvp
**Depends on**: Phase 7 (blocking must revoke Realtime and push); all content modules
**Requirements**: MODER-01, MODER-02, MODER-03, ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, MOD-05
**Success Criteria** (what must be TRUE):

  1. `admin_tenant` can delete any comment or reply in their tenant (soft-delete with `deleted_by`, replies and related notifications cascade), block a member (their session is revoked immediately, they cannot log in to the tenant, and cannot re-register with the same e-mail through the sign-up link) and unblock them; every delete/block/unblock appears in an append-only moderation log with actor, target, timestamp and optional reason that the admin can view.
  2. `admin_tenant` can edit the tenant's branding (logo, colors, favicon, display name) with a live preview of the app shell and contrast validation, list and search members, change a member's role (member / support_tenant / admin_tenant), and edit the community rules text shown at sign-up.
  3. Every admin creation flow - post, story, community, event - plus branding, member management and moderation is usable end-to-end from a phone inside the same app (verified on a real device).
  4. Each module package ships a README documenting its public interface (contracts, emitted/consumed events, flag key, kernel dependencies) and one module can be copied into a fresh app that provides only the kernel contracts; the pilot go-live gate passes: full two-tenant isolation suite across every endpoint, storage URL and Realtime topic, pt-BR catalog audit with zero UI literals, and PWA install + push smoke tests on a real iPhone and Android.

**Plans**: TBD
**UI hint**: yes
**Research needed**: None (thin screens over columns that exist since Foundation/Feed; hardening is checklist-driven). Flag LGPD legal review to the user before go-live (research covered mechanics only).
**Notes**: Hardening items without a requirement of their own but expected here: `EXPLAIN` checks on feed/notification/chat queries with a 10k-row seed, Sentry + structured logging with `tenant_id`/`request_id`, Cloud Run config in git (`min-instances=1`, cpu-boost, timeouts), backups/rollback rehearsal, CORS locked to the single origin in production, a11y pass, build-output check for static routes under `(app)`.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 (Phase 6 depends only on Phase 4 and may be planned in parallel with Phase 5). Phase 01.1 (cloud provisioning) is out of band: it depends only on Phase 1 and runs whenever the accounts exist; it must be complete before the Phase 8 pilot go-live gate.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation - Kernel, Tenancy, Auth & CI/CD | 9/9 | Complete    | 2026-09-14 |
| 01.1. Cloud Provisioning & First Release (INSERTED) | 0/3 | Deferred (needs accounts) | - |
| 2. Tenant Shell, Branding & Platform Panel | 20/20 | In Progress|  |
| 3. Media Pipeline & Member Profiles | 0/TBD | Not started | - |
| 4. Feed | 0/TBD | Not started | - |
| 5. Communities & Stories | 0/TBD | Not started | - |
| 6. Events | 0/TBD | Not started | - |
| 7. Notifications, Web Push & Support Chat | 0/TBD | Not started | - |
| 8. Moderation, Tenant Admin Panel & Pilot Hardening | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-11*
