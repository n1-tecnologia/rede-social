# TRIA Rede Social (white-label community platform)

## What This Is

A multi-tenant, white-label "social network" SaaS built by TRIA. Organizations (creators, companies, institutions, any group with a member base) get their own branded community inside a single deployment, each tenant reached on its own custom domain (e.g. `comunidade.cliente.com.br`) while the platform domain (`app.seusistema.com`) serves TRIA's `super_admin`: the host selects the tenant's public shell and, after login, the app confirms the user's tenant from their membership and applies that tenant's logo, colors, favicon and display name. It is mobile-first (installable PWA) and fully responsive on desktop.

In V1 only the tenant's admin publishes content (feed posts, stories, communities, events); members consume, like, comment, share, RSVP/check-in to events, and talk to the tenant's support team via chat. The data model is born ready for V2, where any member can post, create communities and chat with other members.

## Core Value

A tenant's members open one branded app and feel it is *their organization's* community: the tenant's identity everywhere, the tenant's content in the feed, and zero leakage between tenants.

## Business Context

- **Customer**: Organizations with a member base (creators/mentors, companies, churches, schools, associations). TRIA provisions each as a tenant.
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

### Active

**Tenancy & branding**
- [ ] Single deployment serves every tenant on that tenant's own custom domain; the host picks the public shell, the logged-in user's membership is the authority and must match the host's tenant; the platform domain is reserved for TRIA's `super_admin`
- [ ] Each tenant has customizable branding: logo, color palette, favicon, display name, applied after login
- [ ] Feature modules (feed, communities, stories, events, chat, notifications) can be enabled/disabled per tenant and drive the app navigation
- [ ] Strict data isolation between tenants (every query scoped by tenant, enforced at DB level)

**Roles & access**
- [ ] `super_admin` (TRIA staff): sees everything across all tenants; creates tenants, sets initial branding, enables modules, creates the first `admin_tenant`, via a platform panel
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
- Billing / subscription checkout — tenants are provisioned by TRIA; plan/status fields exist but no payment integration
- Varied reactions (emoji) — plain "like" only
- Native iOS/Android apps — PWA covers mobile in V1
- Email and WhatsApp notifications — in-app + push only
- Public (logged-out) post pages — share links are internal and require login
- Self-service tenant creation — TRIA creates tenants through the platform panel
- Multi-language UI — pt-BR only

## Context

- Greenfield project. Empty repository at start.
- Repo name `rede_social` under TRIA's workspace; TRIA (triacompany.com.br) is the platform operator.
- The user works in Portuguese; planning artifacts are written in English for agent consumption. Domain terms kept as the user named them: `super_admin`, `admin_tenant`.
- "Modularize everything" is a stated architectural goal: each feature (feed, stories, communities, events, chat, notifications) should be a self-contained module (DB schema, API routes, UI) that can be reused in other TRIA products and toggled per tenant.
- Expected usage is predominantly mobile browser / PWA; desktop is secondary but must work.
- **Design prototype exists**: the design team built a mocked frontend at `github.com/tria-company/social-igor` (private; cloned read-only to `reference/frontend-design/`, git-ignored). Stack: Next.js 16, React 19, Tailwind v4, framer-motion, lucide-react, Manrope font. 34 screens, 66 components, all `"use client"` reading `lib/mock/*`. It is the **visual/UX source of truth** but was not built for the modular architecture: brand colors are hex literals, nav is hardcoded, desktop is an iPhone mockup, there are no stories, events are modeled as paid tickets, chat is a ticket helpdesk, and ~1/3 of screens are out of scope (reels, LMS "membros" area, forum, explore, follow graph, reputation). Full analysis in `.planning/research/PROTOTYPE.md`. Decision: port presentational components and design language into module packages phase by phase; rewrite containers, data model and theming; never refactor the prototype in place.
- Research (2026-09-11) is in `.planning/research/` (STACK, FEATURES, ARCHITECTURE, PITFALLS, PROTOTYPE, SUMMARY).

## Constraints

- **Tech stack**: Next.js frontend deployed on Vercel — user decision, mobile-first PWA
- **Tech stack**: Backend API in Node/TypeScript deployed on GCP (Cloud Run) — user decision; all business logic goes through this API. Two confirmed exceptions where the frontend talks to Supabase directly: (1) Supabase Auth login/refresh/recovery via `@supabase/ssr` in the Next.js server, (2) read-only Supabase Realtime Broadcast subscriptions for chat/notification signals (data is always fetched through the API)
- **Modularity**: each feature is a self-contained package (schema, API, UI) depending only on a kernel and on other modules' published contracts, toggled per tenant and reusable in other TRIA projects — user decision, see MOD-01..05
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
| Each tenant on its own custom domain; platform domain reserved for TRIA `super_admin` (2026-09-11, supersedes "single URL") | Tenants want their own address and branding before login; the membership stays the authority and must match the host's tenant | — Pending |
| One admin per tenant publishes all V1 content | Validates the community product with controlled content before opening posting to members | — Pending |
| Feature flags per tenant (not plans) | TRIA super_admin toggles modules directly; plans can map to flag sets later | — Pending |
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
*Last updated: 2026-09-25 after Phase 05.1 completion (Community Authoring Entry Points)*
