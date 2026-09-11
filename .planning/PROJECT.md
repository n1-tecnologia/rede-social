# TRIA Rede Social (white-label community platform)

## What This Is

A multi-tenant, white-label "social network" SaaS built by TRIA. Organizations (creators, companies, institutions, any group with a member base) get their own branded community inside a single web app at one URL (`app.seusistema.com`): after login the app identifies the user's tenant and applies that tenant's logo, colors, favicon and display name. It is mobile-first (installable PWA) and fully responsive on desktop.

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

(None yet — ship to validate)

### Active

**Tenancy & branding**
- [ ] Single deployment, single URL serves all tenants; tenant is resolved from the logged-in user's account
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
- [ ] A post may optionally belong to a community
- [ ] Members can like a post, comment on a post, and reply to a comment (one level of replies only)
- [ ] Members can like comments and replies
- [ ] Share button produces an internal deep link (native share sheet / copy) that opens the post inside the app after login

**Communities**
- [ ] `admin_tenant` creates communities and posts content scoped to a community
- [ ] Members browse communities and see the posts and pinned stories of each community
- [ ] Only `admin_tenant` can create communities in V1 (members in V2)

**Stories**
- [ ] `admin_tenant` publishes stories shown in a horizontally scrollable strip, visible for 24 h
- [ ] Expired stories are kept in the database (hidden, not deleted)
- [ ] `admin_tenant` can pin a story to a community so it also appears there
- [ ] Members can like and comment on a story; story comments cannot be liked or replied to

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
- Custom domain per tenant (`app.cliente.com`) — single URL in V1; keep tenant resolution decoupled from hostname so this can be added
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

## Constraints

- **Tech stack**: Next.js frontend deployed on Vercel — user decision, mobile-first PWA
- **Tech stack**: Backend API in Node/TypeScript deployed on GCP (Cloud Run) — user decision; all business logic goes through this API, the frontend does not talk to Supabase directly
- **Tech stack**: Supabase (Postgres, Auth, Storage, Realtime) as the database/platform — user decision
- **Tech stack**: GitHub as source of truth, with automated deploy triggers to Vercel and GCP — user decision
- **Architecture**: Multi-tenant from day one with tenant-scoped data and RLS/defense-in-depth isolation — core value depends on it
- **Architecture**: Schema must anticipate V2 (member posting, member chat, multi-tenant membership) without migrations that rewrite core tables
- **Media**: Images, video, embeds and file attachments in V1 — requires storage, upload pipeline and video handling from the start
- **Language**: pt-BR UI

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single URL, tenant resolved from the user's account | Simplest onboarding; no DNS per tenant; custom domains can be layered later | — Pending |
| One admin per tenant publishes all V1 content | Validates the community product with controlled content before opening posting to members | — Pending |
| Feature flags per tenant (not plans) | TRIA super_admin toggles modules directly; plans can map to flag sets later | — Pending |
| Central API on GCP, frontend never hits Supabase directly | User wants business logic centralized and reusable; Supabase used as managed Postgres/Auth/Storage | — Pending |
| Next.js + Node/TS backend | Single language, shared types between frontend and API | — Pending |
| Support is a dedicated tenant role (`support_tenant`) | Support may be someone other than the admin | — Pending |
| Chat schema is generic (conversations + participants) | V2 member-to-member chat must not require a redesign | — Pending |
| Stories are soft-expired (hidden after 24 h, never deleted) | Admin may want history; pinned stories in communities need the record | — Pending |
| Comments allow one reply level on posts, none on stories | User-specified interaction depth | — Pending |
| Share = internal deep link requiring login | Content stays private to the tenant; no public pages in V1 | — Pending |
| Plain "like" only, pt-BR only, no billing, no custom domains in V1 | Assumed simplest option where user did not specify; revisit if pilot demands | ⚠️ Revisit |
| Notifications: in-app bell + Web Push (PWA) | User choice; email/WhatsApp deferred | — Pending |
| Events: RSVP before + check-in on the day, admin sees attendance | User choice; gives attendance list without QR hardware | — Pending |

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
*Last updated: 2026-09-11 after initialization*
