# Rede Social (white-label community platform)

## What This Is

A multi-tenant, white-label "social network" SaaS. Organizations (creators, companies, institutions, any group with a member base) get their own branded community inside a single deployment, each tenant reached on its own custom domain (e.g. `comunidade.cliente.com.br`) while the platform domain (`app.seusistema.com`) serves the platform's `super_admin`: the host selects the tenant's public shell and, after login, the app confirms the user's tenant from their membership and applies that tenant's logo, colors, favicon and display name. It is mobile-first (installable PWA) and fully responsive on desktop.

In V1 only the tenant's admin publishes content (feed posts, stories, communities, events); members consume, like, comment, share, RSVP/check-in to events, and talk to the tenant's support team via chat. The data model is born ready for V2, where any member can post, create communities and chat with other members.

## Core Value

A tenant's members open one branded app and feel it is *their organization's* community: the tenant's identity everywhere, the tenant's content in the feed, and zero leakage between tenants.

## Business Context

- **Customer**: Organizations with a member base (creators/mentors, companies, churches, schools, associations). Rede Social provisions each as a tenant.
- **Revenue model**: SaaS subscription per tenant (billing not built in V1; tenant record carries plan/status fields for later).
- **Success metric**: V1 is done when one real tenant is live as a pilot, with its own branding, using feed, stories, communities, events, support chat and notifications.
- **Strategy notes**: Modular architecture so each feature module can be reused across products and toggled per tenant.

## Requirements

### Validated

Validated in Phase 1: Foundation (2026-09-14, local stack; hosted evidence lands in Phase 01.1):
- Two isolated tenants on one deployment; the host only selects the public shell, the logged-in user's membership is the authority and must match the host's tenant (403 `TENANT_HOST_MISMATCH`) — TENANT-01, TENANT-03, TENANT-05 (pgTAP 77 + API isolation suite)
- Kernel package + feature-module package template + lint/dependency rules that fail the build on cross-module internals — MOD-01, MOD-02
- `super_admin` platform lane, `admin_tenant`/`member` roles, `requireRole`/`requireModule` guards — ROLE-01, ROLE-02, ROLE-06
- Public per-tenant sign-up with two recorded consents, login, persistent session, password recovery by e-mail, logout, blocked-member revocation on the next request — AUTH-01..AUTH-06

Validated in Phase 5: Communities & Stories (2026-09-25, local stack; UAT 12/12, verification 15/15, security 82/82 closed):
- `admin_tenant` creates and edits communities (name, description, cover) and archives/reactivates them — no destructive delete — COMM-01 (create/reactivate reachability closed in Phase 05.1: title-row create control, Ativas/Arquivadas chips, Reativar on the page)
- `admin_tenant` posts directly into a community from its page; a community post shows its origin in the merged feed — COMM-04
- Every member sees every community in V1 (`community_members` exists for V2) and browses them, opening each one's posts and pinned stories ("Destaques"); only `admin_tenant` creates communities — COMM-02, COMM-03
- Stories strip visible for 24 h with a full-screen viewer (image and video, segment progress, tap/hold/drag gestures); expiry is a predicate, never a delete — STORY-01, STORY-02, STORY-03
- `admin_tenant` pins a story to communities, where it outlives the 24 h window — STORY-04 (Phase 05.1: a story can be born attached from the composer's "Publicar em" row or a community's Destaques +)
- Members like and comment on stories; story comments cannot be liked or replied to, enforced by the database, not the UI — STORY-05
- Real video playback proven end to end on a Mux Development environment (direct upload, signed webhook, worker, signed playback)

Validated in Phase 08.3: Cursos — admin (2026-10-14, local stack; UAT 5/5, verification passed, security 27/27 closed):
- `super_admin` switches the `courses` module per tenant (off by default); `admin_tenant` alone authors the school under `/cursos` (Configurações → Administração → Cursos) — COURSE-01..COURSE-15
- Courses with modules and lessons (Mux lesson video through the existing pipeline, materials in the private bucket behind 10-minute signed URLs), categories, learning tracks and a lives agenda (https-only external link, state derived from the clock)
- Member access is modeled but not surfaced: open or product-gated courses and lives (the 08.2 entitlement gate through a kernel SQL seam), the sequential module lock and per-membership lesson progress, all RLS-covered and pgTAP-tested; the member-facing catalogue, player and progress UI are a later phase

Validated in Phase 08.6: Área de Membros (2026-10-18, local stack; UAT 7/7, verification passed with an out-of-phase e2e override, security 52 rows threats_open 0):
- A member's school home under `/cursos` (Início, Cursos, Trilhas, Lives, Progresso): continue where they stopped, their courses, the recommended track, the next live with a reminder toggle, new lessons of the week and categories, all decided on the server — COURSE-28..COURSE-52
- Member tracks with per-course states and Meu progresso with a tenant-timezone study streak that stays display-only
- Opt-in live reminders 15 minutes before the start and six school notices (course published, new lessons, live scheduled or reactivated, live cancelled, replay available) through the Phase 7 fan-out and Web Push, access-rechecked and never naming a lesson or withdrawn content

Validated in Phase 08.7: Dados Reais do Perfil (2026-10-19, local stack; UAT 87/87 with the fresh-seed gate recorded on the developer's word, verification passed 5/6 + developer closure, security 52 rows threats_open 0):
- A member's "Sua atividade" on /perfil reads their own last 7 complete days from a nightly per-tenant snapshot, never another member's row — INSIGHT-01..05
- The tenant admin's "Visão do dono" shows the tenant's real numbers in six areas (Visão geral, Membros, Conteúdo, Eventos, Financeiro, Atendimento) with paged named lists, gated by role and by the modules behind each area, refreshed once a day per tenant — INSIGHT-06..13, INSIGHT-15..17, INSIGHT-19..21
- Every group under 5 people or orders leaves the API as "menos de 5" and cannot be recovered by subtraction (CR-01 fixed after review); every new route is in the two-tenant isolation suite — INSIGHT-14, INSIGHT-18

### Active

**Tenancy & branding**
- [ ] Single deployment serves every tenant on that tenant's own custom domain; the host picks the public shell, the logged-in user's membership is the authority and must match the host's tenant; the platform domain is reserved for the platform's `super_admin`
- [ ] Each tenant has customizable branding: logo, color palette, favicon, display name, applied after login
- [ ] Feature modules (feed, communities, stories, events, chat, notifications) can be enabled/disabled per tenant and drive the app navigation
- [ ] Strict data isolation between tenants (every query scoped by tenant, enforced at DB level)

**Roles & access**
- [ ] `super_admin` (Rede Social staff): sees everything across all tenants; creates tenants, sets initial branding, enables modules, creates the first `admin_tenant`, via a platform panel
- [ ] `admin_tenant`: manages own tenant's visual identity (colors, logo, etc.), publishes all content in V1, moderates
- [ ] `support_tenant`: a person from the tenant (not necessarily admin) who answers the support chat
- [ ] `member`: consumes content, interacts, joins events, chats with support
- [ ] Role model designed so V2 can grant posting/community creation to members without schema rewrites

**Onboarding & auth**
- [ ] Each tenant has a public sign-up link; anyone who signs up through it becomes a member of that tenant
- [ ] Email + password login with password recovery
- [ ] A user belongs to exactly one tenant in V1 (schema should not preclude multi-tenant membership later)

**Member profile**
- [ ] Member has profile with photo and bio
- [ ] Members can view each other's profiles within the same tenant

**Feed**
- [ ] `admin_tenant` creates posts with text plus media: images (one or many), video, links/embeds (YouTube/Vimeo, link preview), file attachments (PDF etc.)
- [ ] Members can like a post, comment on a post, and reply to a comment (one level of replies only)
- [ ] Members can like comments and replies
- [ ] Share button produces an internal deep link (native share sheet / copy) that opens the post inside the app after login


**Community authoring (emerged in Phase 5 UAT → Phase 05.1)**
- [ ] `admin_tenant` reaches the create-community form from `/comunidades` when communities already exist (today the CTA renders only in the empty state)
- [ ] Archived communities stay findable (e.g. an "Arquivada" tag/filter) so they can be reactivated without knowing an id
- [ ] A story can be published from inside a community, born attached to it, and the story composer asks up front whether the story goes to a community or to none

**Events**
- [ ] `admin_tenant` publishes upcoming events, in-person (location) or online (link)
- [ ] Members view event list and event detail, confirm attendance (RSVP) beforehand, and check in on the day
- [ ] `admin_tenant` sees attendance list (confirmed vs checked-in)

**Chat**
- [ ] Member ↔ tenant support chat (1:1 conversation between a member and the tenant's support staff), real-time
- [ ] Conversation/message schema generic enough for V2 member-to-member chat (participants table, not hard-coded "support" pairing)

**Notifications**
- [ ] In-app notification center (bell with unread count): who liked which post/comment, new comments/replies on the member's comments, new posts, events, support replies
- [ ] Web Push notifications via PWA installation

**Moderation**
- [ ] `admin_tenant` can delete any comment/reply in their tenant
- [ ] `admin_tenant` can block a member (blocked member loses access)

**Platform**
- [ ] Mobile-first responsive web app, installable as PWA, also usable on desktop
- [ ] pt-BR only in V1, with all UI strings centralized for future i18n

### Out of Scope

- Members creating posts or communities — V2; schema supports it, UI/permissions do not expose it in V1
- Member-to-member chat — V2; V1 chat is member ↔ support only, on the same schema
- Tenant subdomains under the platform domain, and DNS automation on the customer's behalf — each tenant brings a domain it owns; the customer creates the DNS records from the platform panel's instructions
- Billing / subscription checkout — tenants are provisioned by Rede Social; plan/status fields exist but no payment integration
- Varied reactions (emoji) — plain "like" only
- Native iOS/Android apps — PWA covers mobile in V1
- Email and WhatsApp notifications — in-app + push only
- Public (logged-out) post pages — share links are internal and require login
- Self-service tenant creation — Rede Social creates tenants through the platform panel
- Multi-language UI — pt-BR only

## Context

- Greenfield project. Empty repository at start.
- Repo name `rede_social` under the platform's workspace; Rede Social (rede-social.test) is the platform operator.
- The user works in Portuguese; planning artifacts are written in English for agent consumption. Domain terms kept as the user named them: `super_admin`, `admin_tenant`.
- "Modularize everything" is a stated architectural goal: each feature (feed, stories, communities, events, chat, notifications) should be a self-contained module (DB schema, API routes, UI) that can be reused in other Rede Social products and toggled per tenant.
- Expected usage is predominantly mobile browser / PWA; desktop is secondary but must work.
- **Design prototype exists**: the design team built a mocked frontend at `github.com/n1-tecnologia/social-igor` (private; cloned read-only to `reference/frontend-design/`, git-ignored). Stack: Next.js 16, React 19, Tailwind v4, framer-motion, lucide-react, Manrope font. 34 screens, 66 components, all `"use client"` reading `lib/mock/*`. It is the **visual/UX source of truth** but was not built for the modular architecture: brand colors are hex literals, nav is hardcoded, desktop is an iPhone mockup, there are no stories, events are modeled as paid tickets, chat is a ticket helpdesk, and ~1/3 of screens are out of scope (reels, LMS "membros" area, forum, explore, follow graph, reputation). Full analysis in `.planning/research/PROTOTYPE.md`. Decision: port presentational components and design language into module packages phase by phase; rewrite containers, data model and theming; never refactor the prototype in place.
- Research (2026-09-11) is in `.planning/research/` (STACK, FEATURES, ARCHITECTURE, PITFALLS, PROTOTYPE, SUMMARY).

## Constraints

- **Tech stack**: Next.js frontend deployed on Vercel — user decision, mobile-first PWA
- **Tech stack**: Backend API in Node/TypeScript deployed on GCP (Cloud Run) — user decision; all business logic goes through this API. Two confirmed exceptions where the frontend talks to Supabase directly: (1) Supabase Auth login/refresh/recovery via `@supabase/ssr` in the Next.js server, (2) read-only Supabase Realtime Broadcast subscriptions for chat/notification signals (data is always fetched through the API)
- **Modularity**: each feature is a self-contained package (schema, API, UI) depending only on a kernel and on other modules' published contracts, toggled per tenant and reusable in other projects — user decision, see MOD-01..05
- **Design**: UI follows the design team's prototype (`reference/frontend-design/`); components are ported into module packages, not refactored in place — see PROTOTYPE.md
- **Infra plan**: Supabase Free plan for the pilot (no native image transforms, 50 MB per file, Realtime quotas) — user decision; image resizing done in the worker; upgrade to Pro is a V2 item
- **Tech stack**: Supabase (Postgres, Auth, Storage, Realtime) as the database/platform — user decision
- **Tech stack**: GitHub as source of truth, with automated deploy triggers to Vercel and GCP — user decision
- **Architecture**: Multi-tenant from day one with tenant-scoped data and RLS/defense-in-depth isolation — core value depends on it
- **Architecture**: Schema must anticipate V2 (member posting, member chat, multi-tenant membership) without migrations that rewrite core tables
- **Media**: Images, video, embeds and file attachments in V1 — requires storage, upload pipeline and video handling from the start
- **Language**: pt-BR UI

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Each tenant on its own custom domain; platform domain reserved for Rede Social `super_admin` (2026-09-11, supersedes "single URL") | Tenants want their own address and branding before login; the membership stays the authority and must match the host's tenant | — Pending |
| One admin per tenant publishes all V1 content | Validates the community product with controlled content before opening posting to members | — Pending |
| Feature flags per tenant (not plans) | Rede Social super_admin toggles modules directly; plans can map to flag sets later | — Pending |
| Central API on GCP, frontend never hits Supabase directly | User wants business logic centralized and reusable; Supabase used as managed Postgres/Auth/Storage | — Pending |
| Next.js + Node/TS backend | Single language, shared types between frontend and API | — Pending |
| Support is a dedicated tenant role (`support_tenant`) | Support may be someone other than the admin | — Pending |
| Chat schema is generic (conversations + participants) | V2 member-to-member chat must not require a redesign | — Pending |
| Stories are soft-expired (hidden after 24 h, never deleted) | Admin may want history; pinned stories in communities need the record | ✓ Good — Phase 5: expiry is a read predicate, no sweeper; retention proven by pgTAP |
| Comments allow one reply level on posts, none on stories | User-specified interaction depth | ✓ Good — Phase 5: story-comment rules are composite FKs + guarded CHECKs in the database |
| Share = internal deep link requiring login | Content stays private to the tenant; no public pages in V1 | — Pending |
| Plain "like" only, pt-BR only, no billing in V1 | Assumed simplest option where user did not specify; revisit if pilot demands | ⚠️ Revisit |
| Notifications: in-app bell + Web Push (PWA) | User choice; email/WhatsApp deferred | — Pending |
| Realtime via Supabase Broadcast (read-only frontend subscription) | Cloud Run WebSockets: 60-min cap, Redis, always-on billing; Broadcast scales and keeps data authority in the API | — Pending |
| Supabase Auth via `@supabase/ssr` in Next.js; API verifies JWT (JWKS) | Official pattern, less code; API resolves tenant/role per request from DB | — Pending |
| Identity ≠ membership (`memberships` table, not `profiles.tenant_id`) | Supabase Auth has global email uniqueness; multi-tenant users in V2 become a constraint change | — Pending |
| Video through a streaming vendor (Mux or Cloudflare Stream) | Supabase Storage does not transcode; iPhone HEVC fails on Android | ✓ Good — Mux chosen; proven end to end on a Development environment in Phase 5 UAT (2026-09-25). Production environment still pending in Phase 01.1 |
| Pinned stories outlive the 24 h expiry in their community | Instagram Highlights model; user confirmed | ✓ Good — Phase 5 (STORY-04); admin unpin is the control |
| Supabase Free plan for the pilot | User choice to control cost; image resize in worker, 50 MB cap accepted | ⚠️ Revisit |
| Communities: all members see all communities in V1 | Simplest for pilot; `community_members` table exists for V2 private communities | ✓ Good — Phase 5; `community_members` born unused (accepted risk AR-01) |
| Design prototype is UI source of truth; port, don't refactor | Prototype is mocked and non-modular; presentational components port cleanly, containers/data/theme must be rewritten | — Pending |
| Structure: vertical MVP slices | Each phase delivers an end-to-end capability; earliest working app for the pilot | — Pending |
| Events: RSVP before + check-in on the day, admin sees attendance | User choice; gives attendance list without QR hardware | — Pending |
| Archive, never delete, a community (Phase 5) | Archive is reversible; a delete would cascade over members' posts, comments and likes | ✓ Good |
| An expired, unpinned story stays readable by id inside its tenant (Phase 5, AR-09) | The admin history and community pins both need by-id reads of expired stories; exposure is same-tenant only | ✓ Accepted risk 2026-09-25 |
| Phase 05.1 inserted before Phase 6 (2026-09-24) | UAT showed working routes with no control linking to them (create community, reactivate) and no way to publish a story into a community | — Pending |
| School module is `courses` at `/cursos`, labelled "Cursos" (Phase 08.3, D-400) | `/membros` has been the member directory since 03-05; a per-tenant label ("Área de Membros") was declined | ✓ Good — Phase 08.3 |
| A course or live already linked to a product stays linked when the product's course or live set is replaced, even archived or cancelled (Phase 08.4, the WR-04 rule mirrored) | Dropping it would revoke its buyers' access; a course or live not linkable and not yet linked is still refused (`course_invalid` / `live_invalid`) | ✓ Product-owner sign-off 2026-10-14 (WR-04, Phase 08.3), amended by Phase 08.4 |
| The product form is the only place a course or a live is linked to a product; course and live forms show the links read-only (Phase 08.4, D-418, reverses D-404's write path) | The user adds a course to a product, not a product to a course (2026-10-14) | ✓ Good — shipped locally in Phase 08.4 (UAT 2/2, security 15/15, 2026-10-15) |
| Member entry and catalogue (Phase 08.5, D-419..D-422): the Cursos BottomNav tab ships with Reels moved to the TopBar on tenants with `courses` on (data-driven `yieldsTabTo`, D-419); `/cursos` is a two-chip catalogue (Cursos, Lives) for members (D-420); a locked course card follows the community card ("Exclusivo", "Produto arquivado", D-421); the admin keeps the hub and gains "Ver como aluno" (D-422) | One branded school entry for members without a sixth tab, the store's locked-content language reused, and an admin who can see exactly what members see | ✓ Good — shipped locally in Phase 08.5 (plans 06, 10, 11; confirmed in 08.7 UAT 2026-10-19) |
| Locked course page and purchases (Phase 08.5, D-423..D-426): a locked course shows its whole curriculum as titles with padlocks (a definer titles-only outline, no description, video or material, D-423); the buy path is the 08.2 top section plus a tap on a locked lesson (D-424); the product page and "Compra concluída" list every community, course and live a product unlocks (amends STORE-06 / STORE-07, D-425); an archived or unpublished course disappears for every member, buyers included (D-426) | Members see what they would buy without the paid content leaving the server; one purchase flow for every kind of content | ✓ Good — shipped locally in Phase 08.5 (plans 01, 05, 07, 08, 12; confirmed in 08.7 UAT 2026-10-19) |
| Completion, sequence and progress (Phase 08.5, D-427..D-430): a lesson completes at 90% of its ready video (server-decided) or by "Marcar como concluída", one-way (D-427); the sequential lock exists per module and per lesson, decided by one database evaluator asked by the routes, the progress RLS and the media gate (D-428); a free lesson ignores the sequence and writes progress even for a non-buyer (D-429); progress shows on the card, the course page and the lesson list, and the video resumes (D-430) | The lock is decided in one place, so a skip is refused by the route AND by RLS; the member never loses progress to a lock change | ✓ Good — shipped locally in Phase 08.5 (plans 01, 03, 07, 08; confirmed in 08.7 UAT 2026-10-19) |
| Lives for members (Phase 08.5, D-431..D-434): the Lives chip lists lives on air and scheduled first, then recorded lives with a replay (D-431); the join link leaves the server only from 15 minutes before the start until the planned end, for a caller with access (D-432); access to the live OR to the replay lesson's course opens the replay (two doors, D-433); each live has its own page at `/cursos/lives/{liveId}` (D-434) | The paid room link never reaches a member outside the window or without access, and a live buyer can watch the recording without buying the course | ✓ Good — shipped locally in Phase 08.5 (plans 01, 04, 06, 09; confirmed in 08.7 UAT 2026-10-19) |
| Member area (Phase 08.6, D-435..D-439): for a member the Cursos tab opens Início and `/cursos` gets five chips, Início, Cursos, Trilhas, Lives and Progresso (bare `/cursos` is Início, the catalogue moved to `?aba=cursos`, D-435); "Meus cursos" follows the prototype's cascade without the hero's course (D-436); the hero is always a course to watch, retomando / começando / em dia (D-437); the member's track is chosen automatically, the started track with the highest percent or the first active one as "Sugerido" (D-438); the Trilhas chip lists the tenant's active tracks with each course's state (D-439) | One school home that tells a member where to continue, every state and order decided by the server from one tenant transaction, the locked content shown as a shop window | — ✓ Good — shipped locally in Phase 08.6 (plans 01, 03, 04, 08, 09, 10); confirmed in 08.6 UAT 2026-10-18 |
| Streak and numbers (Phase 08.6, D-440..D-443): a study day is a tenant-local date with at least one completed lesson (D-440); the streak survives until the end of the next day (D-441); "Horas assistidas" sums the ready-video durations of completed lessons, with no watched-seconds accumulator (D-442); the streak is display only, with no notice, reward or nudge (D-443, PR-1) | Derived from the one-way `completed_at` history, so no new activity table and nothing accepted from the client; a streak that never nags | — ✓ Good — shipped locally in Phase 08.6 (plans 01, 04, 08, 10); confirmed in 08.6 UAT 2026-10-18 |
| Live reminder (Phase 08.6, D-444..D-447): the reminder is an opt-in per live, stored in the own-row `course_live_reminders` table (D-444); it fires 15 minutes before the start, in-app and by Web Push (D-445); only a member with access can turn it on, and access is re-checked at fire time (D-446); it follows the live: a cancel sends "Live cancelada" to the opted-in, a moved start re-arms silently, a reactivation fires the surviving opt-ins (D-447) | The events module's arming pattern (delayed pg-boss job armed in the write transaction, stale-check at fire time) reused for the school | — ✓ Good — shipped locally in Phase 08.6 (plans 01, 05, 06, 11); confirmed in 08.6 UAT 2026-10-18 |
| School notices (Phase 08.6, D-448..D-451): course published, new lessons in a published course, live scheduled and replay available notify members as `courses.*` kinds through the Phase 7 fan-out (D-448); course and live notices reach every member as a shop window, new lessons only those with access, a replay only those who open the live or the course (D-449); new lessons of one course are grouped into one notice per 30-minute batch (D-450); delivery is the notification center plus Web Push (D-451) | Members hear about new content without any unpublished or locked content leaving the server; one notice per batch, never a flood | — ✓ Good — shipped locally in Phase 08.6 (plans 05, 06, 07, 12); confirmed in 08.6 UAT 2026-10-18 |
| Settled questions (Phase 08.6, D-452..D-454): a cancelled live can be reactivated while its start is ahead (`POST /v1/courses/lives/{liveId}/reactivate`, "Reativar live", D-452); `support_tenant` staff receive the course notices like a member, the publishing actor excluded (D-453); unpublishing or archiving a course retracts its course and lessons notices (keep-and-mark, `course.unpublished`, D-454) | Research Open Questions 1, 2 and 4 answered in scope rather than deferred, so the bell never names withdrawn content and a mistaken cancel is recoverable | — ✓ Good — shipped locally in Phase 08.6 (plans 06, 07, 12); confirmed in 08.6 UAT 2026-10-18 |
| "Em breve" (Phase 08.7, D-455..D-458): a card, number or line with no data source today reads "Em breve", never a sample value, a zero or a dash (usage time, post views and reach, playback, saves, shares, story taps, link clicks, carousel progress, the waitlist, tickets, offers, support subjects, members who left, expiring accesses; D-455); one behaviour and one string family on the member and the owner panels (D-456); the prototype's order is kept, so "Sua atividade" may open on its "Em breve" usage block (D-457); a mixed card shows its real parts and marks only the missing lines (D-458) | The API contracts have no example branch at all (`notMeasured` carries a reason and no value), so no fictional number can be served as a measured one; the panel stays where the members expect it while the measurements arrive | ✓ Good — shipped locally in Phase 08.7 (plans 03, 05, 06, 07, 08, 09, 10, 11, 12; confirmed in 08.7 UAT 2026-10-19) |
| Owner panel scope and privacy (Phase 08.7, D-459..D-462): all six owner areas read the tenant's real snapshot and no runtime path draws a fixture value (`scripts/check-dashboard-fixtures.sh` in `pnpm lint`, D-459); an area, a Visão geral card and a per-community scope disappear with the module behind them, and a hidden `?area=` renders Visão geral (D-460); "Ver todos", "Responder" and the member and post links open the screens that exist, while a group push and the at-risk campaign stay disabled with the pill (D-461); the per-member detail and every named list are `admin_tenant`-only at the API (403 for members and support, a bare 404 across tenants), and every group under 5 people or orders leaves the server as "menos de 5" (D-462; the privacy-policy text is a go-live item in DEPLOY.md, not code) | The owner sees the tenant's own numbers with nothing invented, nothing a disabled module would contradict, and no small group a subtraction could reveal; enforcement lives in the API and RLS, not in the web | ✓ Good — shipped locally in Phase 08.7 (plans 01-12; confirmed in 08.7 UAT 2026-10-19; D-462's privacy policy pending before the pilot go-live) |
| Member panel (Phase 08.7, D-463): "Sua atividade" is visible to role `member` only and reads only the caller's own snapshot row (`GET /v1/dashboard/activity`, no user-id parameter); the last 7 complete days against the 7 before, attendance over 30 days | A member never reads another member's activity: the route takes the user from the session and RLS allows the own row only | ✓ Good — shipped locally in Phase 08.7 (plan 03; confirmed in 08.7 UAT 2026-10-19) |
| Refresh and data gaps (Phase 08.7, D-464..D-465): the numbers are computed once a day: the kernel's `kernel.daily-tenant-dispatch` enqueues each active tenant's local yesterday every hour and the worker's `dashboard.snapshot-build` stores one snapshot per tenant and day (ids and numbers only), which both panels read with "Números até ontem · atualizados hoje às …"; retention 8 days through `dashboard_snapshots_prune` (D-464, costly to reverse); `memberships.deleted_at`, `chat_conversations.subject` and `store_entitlements.expires_at` stay unwritten and their numbers read "Em breve" (D-465) | Opening a panel never runs the heavy reads, every tenant gets its numbers after its own midnight, and each missing column is a new product capability (a leave flow, support subjects, timed access), not a gap in a read | ✓ Good — shipped locally in Phase 08.7 (plans 01, 02, 03, 05, 09, 10, 11, 12; confirmed in 08.7 UAT 2026-10-19) |
| Following and finding people (Phase 09, D-466..D-470): `/membros` reopens to role `member` only while `social` is on for the tenant, and stays staff-only with it off (D-466); the follow graph is member to member only, one-directional, with `admin_tenant` and `support_tenant` outside it and a self-follow refused (D-467); counts are public and lists are private: nobody opens another member's followers or following, and no route takes a member id for a list (D-468); a member post opened by someone who may not read it is a locked answer that discloses only the author's name and avatar, and following opens the same URL (D-469); the Seguir button lives on the profile, the "Siga para ver" screen and the directory rows, never in comment rows, post headers or the Reels rail (D-470) | Open less first, because opening later is cheap and closing is not (the staff-only directory of 2026-10-16, "menos de 5"); the locked answer turns a shared link into a way to discover someone without giving the post away | ✓ Good — shipped locally in Phase 09 (plans 01, 02, 05, 10, 11) |
| Own posts, composer and limits (Phase 09, D-471..D-474): a member's own posts appear in their own Explorar mixed by `(created_at, id)`, with no personal feed and no "Minhas publicações" (D-471); a member publishes from Explorar only and lands on top of it, while Início keeps the button for the organization (D-472); a member post is a caption, photos, at most one video where the tenant allows it, and a link with its preview, with no attachment and no community, refused by the API and not only hidden in the form (D-473); member media limits live in `tenant_modules['social'].settings`, set per tenant by the `super_admin`, apply to new uploads only and have no per-member quota (D-474; no API rate limiter exists, recorded as an open decision in DEPLOY.md) | The composer for members is deliberately smaller than the admin's; Mux bills per minute and Supabase Free holds 1 GB, so video starts off and the limits sit with the platform operator | ✓ Good — shipped locally in Phase 09 (plans 03, 06, 08, 09, 12; the half-ceiling member share is a planner default flagged for the user) |
| Safety net and go-live (Phase 09, D-475..D-478): a holder of `moderation.manage` sees every live member post in Explorar and removes any of them, with the `post_removed` log row committed in the same transaction and the author not told (D-475); a member's post notifies nobody (D-476); the author of a member post gets one in-app row and one push for a first-level comment by someone else, retracted with the comment or the post (D-477, kind `feed.post_commented`); terms, rules and privacy wording is a go-live item, never a code gate: DEPLOY.md carries "Ativar a Rede social" and the platform confirmation quotes it, while the legal wording stays pending with the user (D-478) | Pulling post removal forward from MODER-04 gives the operator a way out before members publish; a follow notifying nobody keeps the product quiet until Phase 11 decides | ✓ Good — shipped locally in Phase 09 (plans 03, 07, 09, 12, 13; D-478's legal wording pending before any tenant is enabled) |
| Navigation and Reels (Phase 09, D-479..D-481): Explorar is a chip beside Início on `/inicio?aba=explorar`, shown while `social` is on to role `member` and to holders of `moderation.manage`, with no new tab in the BottomNav and no stories strip (D-479); Reels "Todos" keeps its D-117 meaning and mixes by date the organization's videos, those of the people the viewer follows and the viewer's own, with no new lane, and a moderator sees member videos in Explorar rather than in Reels (D-480); a tap on a video in Explorar opens the Reels overlay at that video and the arrow returns to the same place (D-481) | The area keeps its shape and the five-tab BottomNav stays within D-419; one queue ("Todos") means the tapped video is always in it | ✓ Good — shipped locally in Phase 09 (plans 04, 08) |
| Roles, off and blocked (Phase 09, D-482..D-484): only `member` takes part; `permissionsFor` stops reading `feed.settings.postingPolicy` and the stamped audience of the post, written from the author's role, is the authoring switch, with `social` requiring `feed`, last in `TOGGLEABLE_MODULES`, off by default (D-482); turning `social` off hides Explorar, the composer, the follow routes, the profile counts, the directory for members and every member post as the bare 404 without deleting anything, and turning it on brings it back (D-483); a blocked or removed member's posts, videos, counts and lists disappear until unblocked (D-484) | A stamped audience cannot move old posts when ADMIN-02 promotes or demotes someone, and the restrictive policy makes off and blocked identical for every reader and every older API | ✓ Good — shipped locally in Phase 09 (plans 01, 03, 04, 05) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-19 after Phase 08.7 (Dados reais do perfil)*
