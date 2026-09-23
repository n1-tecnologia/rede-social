# Requirements: TRIA Rede Social

**Defined:** 2026-09-11
**Core Value:** A tenant's members open one branded app and feel it is their organization's community: the tenant's identity everywhere, the tenant's content in the feed, and zero leakage between tenants.

## v1 Requirements

Requirements for initial release (pilot with one real tenant). Each maps to roadmap phases.

### Tenancy & Branding

- [x] **TENANT-01**: A single deployment serves every tenant on that tenant's own custom domain (a hostname the customer owns, registered in `tenant_domains`), while the platform domain serves TRIA's `super_admin`; the host only selects the tenant's public shell (login, sign-up, branding) and after login the app resolves tenant, role and modules from the user's membership, rejecting a session whose membership does not belong to the host's tenant
- [x] **TENANT-02**: Each tenant has branding (logo, primary/secondary colors, favicon, display name) that is applied to the whole app shell after login, server-rendered so the user never sees another brand or a default brand flash
- [x] **TENANT-03**: Every tenant-owned row carries `tenant_id`; the API runs tenant requests under a database role subject to Row Level Security (no service-role key for user traffic), so cross-tenant reads/writes are blocked at the DB even if application code has a bug
- [x] **TENANT-04**: Storage objects (media, attachments) are stored under tenant-scoped paths and served only through signed, tenant-checked URLs
- [x] **TENANT-05**: An automated isolation test suite with at least two tenants proves that lists, detail pages, search, notifications, chat and storage never return another tenant's data
- [ ] **TENANT-06**: Authentication e-mails (password recovery, confirmation) are sent with the tenant's display name and logo, not TRIA's
- [x] **TENANT-07**: `super_admin` can attach a custom domain to a tenant from the platform panel; the platform registers it with the hosting provider and the auth redirect allow-list, shows the DNS records the customer must create, and reports verification status (pilot/seed tenants get their domains from the provisioning script)

### Modularity (architecture requirement)

- [x] **MOD-01**: The codebase is a monorepo where each feature (feed, communities, stories, events, chat, notifications, moderation, profiles) is a self-contained module package containing its own DB schema/migrations, API routes, domain logic and UI components
- [x] **MOD-02**: A core kernel package provides tenancy, auth/session, roles, feature flags, media broker and shared UI primitives; feature modules depend only on the kernel and on published contracts of other modules, never on another module's internals (enforced by lint/dependency rules)
- [x] **MOD-03**: Modules communicate through domain events (e.g. `post.liked`, `event.rsvp`) consumed by other modules (e.g. notifications) so a module can be removed or replaced without touching the others
- [x] **MOD-04**: Each module is registered in a module registry that declares its routes, navigation entries, feature-flag key and event subscriptions; the API mounts and the app renders only registered, enabled modules
- [ ] **MOD-05**: A module can be reused in another TRIA project by copying/publishing its package and providing the kernel contracts, documented in a per-module README with its public interface

### Roles & Platform Panel

- [x] **ROLE-01**: Four roles exist: `super_admin` (TRIA staff, cross-tenant), `admin_tenant`, `support_tenant`, `member`; roles are stored per tenant membership, not on the global user
- [x] **ROLE-02**: Identity is separate from membership: a user record can be linked to a tenant through a membership row carrying role and status, with V1 enforcing one membership per user via a constraint that can be relaxed for V2
- [x] **ROLE-03**: `super_admin` can create a tenant in a platform panel: name, slug, initial branding, enabled modules and the first `admin_tenant` (by e-mail invitation)
- [ ] **ROLE-04**: `super_admin` can enable/disable feature modules per tenant, and the change is reflected in the tenant's navigation and API access without a redeploy
- [ ] **ROLE-05**: `super_admin` can list all tenants with status and open any tenant's settings
- [x] **ROLE-06**: Authorization is enforced in the API for every route based on role and enabled modules (a disabled module's routes return 404 for that tenant)

### Onboarding & Auth

- [x] **AUTH-01**: Each tenant has a public sign-up link; a user who signs up through it becomes a `member` of that tenant, and the link survives the register/login round-trip
- [x] **AUTH-02**: User can sign up and log in with e-mail and password (Supabase Auth via the Next.js server), and stay logged in across browser/PWA restarts
- [x] **AUTH-03**: User can recover a forgotten password via e-mail link
- [x] **AUTH-04**: At sign-up the user must accept the tenant's community rules (editable by `admin_tenant`) and TRIA's terms/privacy policy; acceptance is recorded with timestamp
- [x] **AUTH-05**: User can log out from any page
- [x] **AUTH-06**: The API verifies the Supabase JWT (asymmetric keys / JWKS) and resolves tenant, role and membership status per request from the database, so a blocked member is cut off immediately

### Member Profile

- [x] **PROF-01**: Member has a profile with photo, display name and bio, and can edit their own
- [x] **PROF-02**: Member can view another member's profile within the same tenant
- [x] **PROF-03**: Member can browse a searchable (by name) list of the tenant's members, paginated

### Feed

- [x] **FEED-01**: `admin_tenant` can create a post with text and any combination of: multiple images (carousel with swipe on mobile), one video, link previews / YouTube-Vimeo embeds (unfurled server-side at create time), and file attachments (PDF and similar)
- [x] **FEED-02**: A post may optionally be scoped to a community; the main feed shows posts without community plus posts from communities the member can see, newest first, with cursor pagination
- [x] **FEED-03**: `admin_tenant` can edit (marked "editado") and soft-delete their own posts
- [x] **FEED-04**: Member can like/unlike a post (idempotent toggle) and see the like count
- [x] **FEED-05**: Member can comment on a post and reply to a comment; replies are limited to one level (enforced by a DB constraint)
- [x] **FEED-06**: Member can like/unlike comments and replies
- [x] **FEED-07**: Member can share a post via the native share sheet (or copy link on desktop) using an internal deep link; opening the link requires login and lands on the post if it belongs to the user's tenant (otherwise 404)
- [x] **FEED-08**: Posts, communities and stories carry a generic `author_id` and per-tenant posting policy so V2 member posting is a permission change, not a schema change

### Communities

- [x] **COMM-01**: `admin_tenant` can create, edit and archive communities (name, description, cover image)
- [x] **COMM-02**: Every tenant member can see every community in V1; a community-membership table exists so private/opt-in communities in V2 require no migration
- [ ] **COMM-03**: Member can browse the community list (cover, name, description, post count) and open a community to see its posts and its pinned stories
- [x] **COMM-04**: `admin_tenant` can post directly into a community from the community page

### Stories

- [x] **STORY-01**: `admin_tenant` can publish a story with an image or a short video (up to ~60 s, via the streaming vendor) and optional caption
- [ ] **STORY-02**: Members see active stories in a horizontally scrollable strip; tapping opens a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause
- [x] **STORY-03**: A story is visible for 24 h after publishing; after that it is hidden by an `expires_at` filter but the record is retained
- [ ] **STORY-04**: `admin_tenant` can pin a story to one or more communities; a pinned story stays visible in that community after the 24 h expiry until unpinned
- [ ] **STORY-05**: Member can like a story and comment on it; story comments cannot be liked or replied to

### Events

- [ ] **EVENT-01**: `admin_tenant` can create, edit and cancel events with title, description, cover image, start/end datetime (timezone-aware), and either a physical location or an online link
- [ ] **EVENT-02**: Member can view upcoming and past events and open an event's detail
- [ ] **EVENT-03**: Member can confirm attendance (RSVP going / not going) before the event and see the number of confirmed attendees
- [ ] **EVENT-04**: Member can check in to an event on the day, within a time window around the event start; check-in without prior RSVP counts as a walk-in
- [ ] **EVENT-05**: `admin_tenant` can see the attendance list per event with confirmed vs checked-in status
- [ ] **EVENT-06**: Member can add an event to their calendar (.ics download and Google Calendar link)
- [ ] **EVENT-07**: Members who confirmed receive reminder notifications before the event (24 h and 1 h) through the notification module, via a scheduled job

### Chat (member ↔ support)

- [ ] **CHAT-01**: Chat is modeled as generic conversations with participants and messages (with a per-conversation sequence for ordering), so V2 member-to-member chat needs no schema change
- [ ] **CHAT-02**: Member can open their single support conversation and send text messages; `support_tenant` users of the tenant receive and answer them
- [ ] **CHAT-03**: `support_tenant` sees a list of member conversations ordered by last activity with unread indicators and can open and reply to any of them
- [ ] **CHAT-04**: New messages are delivered in real time to open conversations (Supabase Realtime Broadcast on private channels; the browser only receives signals and fetches data through the API)
- [ ] **CHAT-05**: Member sees an unread badge on the chat entry when support replied

### Notifications

- [ ] **NOTIF-01**: A notification module records in-app notifications for: likes on the member's comments, comments/replies on the member's comments, new posts, new events and event reminders, support replies; all produced from domain events
- [ ] **NOTIF-02**: Member has a notification center (bell) with unread count, list of notifications, and mark-as-read; the unread count updates in real time
- [ ] **NOTIF-03**: Member can enable Web Push in the installed PWA; push messages carry the tenant's name and icon and open the relevant screen; expired subscriptions are cleaned up
- [ ] **NOTIF-04**: The notification module has a channel abstraction (in-app, push) so e-mail/WhatsApp can be added later as adapters

### Moderation

- [ ] **MODER-01**: `admin_tenant` can delete any comment or reply in their tenant (soft-delete with `deleted_by`)
- [ ] **MODER-02**: `admin_tenant` can block a member; the member's session is revoked immediately, they can no longer log in to the tenant, and cannot re-register with the same e-mail through the sign-up link
- [ ] **MODER-03**: Every moderation action (delete, block, unblock) is written to an append-only moderation log with actor, target, timestamp and optional reason, viewable by `admin_tenant`

### Tenant Admin Panel

- [ ] **ADMIN-01**: `admin_tenant` can edit the tenant's branding (logo, colors, favicon, display name) with a live preview of the app shell and contrast validation
- [ ] **ADMIN-02**: `admin_tenant` can list and search members, change a member's role (member / support_tenant / admin_tenant), and block/unblock them
- [ ] **ADMIN-03**: `admin_tenant` can edit the community rules text shown at sign-up
- [ ] **ADMIN-04**: All admin creation flows (post, story, community, event) are usable from a phone inside the same app

### Media

- [x] **MEDIA-01**: Uploads go directly from the browser to Supabase Storage using signed upload URLs brokered by the API (files never transit Cloud Run); the API confirms the upload and records the asset with tenant scope
- [x] **MEDIA-02**: Images are resized/compressed server-side (worker) into display sizes; original size and type limits are enforced (Supabase Free plan: 50 MB per file, no native transforms)
- [x] **MEDIA-03**: Videos are uploaded to a streaming vendor (Mux or Cloudflare Stream, chosen in the media phase) that transcodes and serves HLS with thumbnails; playback works on iOS and Android
- [x] **MEDIA-04**: Link unfurling runs server-side with an SSRF guard and caches title/description/image on the post

### Design Prototype (UI source of truth)

- [ ] **UI-01**: The app's visual language (tokens, typography, spacing, motion, component styling) follows the design team's prototype in `reference/frontend-design/`; shared primitives (Button, IconButton, Avatar, Badge, BottomSheet, ConfirmDialog, EmptyState, Input, Skeleton, Tabs, Toast, TopBar, BottomNav, PullToRefresh, SafeAreaWrapper) are ported into the kernel shared-UI package
- [x] **UI-02**: Feature screens are ported into their module package as each vertical phase is built, replacing mock data with API calls and keeping the prototype's interactions (double-tap like, comment sheet, infinite scroll, pull-to-refresh, swipe)
- [ ] **UI-03**: The prototype's hardcoded brand (hex literals, "Igor Alves" strings, `lib/nav.ts`) is replaced by tenant-driven theme variables, tenant display name and flag-driven navigation; the iPhone `DeviceShell` mockup is replaced by a real responsive app shell with a desktop layout
- [ ] **UI-04**: Screens the prototype lacks (stories strip/viewer, admin composers, admin panel, platform panel, moderation, support inbox) are designed in the prototype's language and reviewed with the design team before implementation

### PWA & Platform

- [ ] **PWA-01**: The app is mobile-first and responsive on desktop, installable as a PWA (manifest + service worker), and works in standalone mode
- [ ] **PWA-02**: On iOS, users are shown a short "Adicionar à Tela de Início" hint before push can be enabled, since Web Push on iOS requires installation
- [x] **PWA-03**: All UI text is pt-BR and centralized in a message catalog for future i18n
- [ ] **PWA-04**: GitHub is the source of truth: pushes deploy the Next.js app to Vercel and the API/worker to Cloud Run automatically, with separate preview/staging and production environments

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Content & Social

- **V2-CONT-01**: Members can create posts (per-tenant policy flip on FEED-08)
- **V2-CONT-02**: Members can create communities; private/opt-in communities using COMM-02's membership table
- **V2-CONT-03**: Pin post to top of feed/community
- **V2-CONT-04**: Scheduled publishing of posts
- **V2-CONT-05**: Story seen/unseen ring and admin "who viewed" list
- **V2-CONT-06**: Emoji reactions instead of plain like

### Chat & Notifications

- **V2-CHAT-01**: Member-to-member chat on the same conversation schema
- **V2-CHAT-02**: Attachments, read receipts, typing indicator, canned replies
- **V2-NOTIF-01**: Per-category × per-channel notification preferences with quiet defaults
- **V2-NOTIF-02**: Grouped notifications ("Ana e mais 3 curtiram")
- **V2-NOTIF-03**: E-mail and WhatsApp channels

### Events

- **V2-EVENT-01**: Check-in time window enforcement with admin manual override; QR / geofence check-in
- **V2-EVENT-02**: Update/cancel notifications to confirmed attendees
- **V2-EVENT-03**: Attendance CSV export; "maybe" RSVP, capacity and waitlist

### Members & Compliance

- **V2-PROF-01**: Hide-me option for the member directory
- **V2-PROF-02**: Self-service account deletion / data export (LGPD Art. 18)
- **V2-MODER-01**: Member reports content with reason; admin reports queue
- **V2-MODER-02**: Keyword blocklist per tenant

### Platform

- **V2-PLAT-01**: Rotatable/revocable sign-up link
- **V2-PLAT-02**: Per-tenant PWA manifest (home-screen icon, name, splash)
- **V2-PLAT-03**: Offline shell with cached last feed; native gestures (pull-to-refresh, pinch-zoom)
- **V2-PLAT-04**: Tenant analytics dashboard (members, active 7d/30d, engagement, RSVP/check-in rates)
- **V2-PLAT-05**: Tenant impersonation for `super_admin` (logged)
- **V2-PLAT-06**: Supabase Pro plan, staging + prod projects, native image transforms
- **V2-PLAT-07**: Users belonging to multiple tenants (relax ROLE-02 constraint)
- **V2-PLAT-08**: First-login profile completion nudge

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Tenant subdomains under the platform domain, or DNS automation on the customer's behalf | Every tenant brings a domain it owns (TENANT-01/07); the customer creates the CNAME/A records from the panel's instructions and TLS is issued by the host once verified |
| Billing / subscription checkout | Tenants provisioned by TRIA; plan/status fields exist on the tenant record for later |
| Public (logged-out) post pages / SEO | Breaks the private-community promise and leaks tenant content; internal deep links only |
| Native iOS/Android apps | PWA covers mobile in V1 |
| Realtime everywhere (live like counters, presence) | Connection cost explodes per tenant/post; realtime only for chat and notification badge |
| Full offline mode with write queues | Conflict resolution across tenants; far beyond pilot needs |
| Gamification (points, levels, leaderboards) | Distorts behavior in institutions; meaningless with admin-only posting |
| Courses / LMS | Separate product; link out or embed videos |
| Live streaming / live rooms | Infrastructure-heavy; use online events with external links |
| Deep nested comment threads | User chose one reply level; unreadable on phones |
| AI moderation / summaries | No member-generated volume in V1 to justify cost |
| Exposing 12+ theme tokens | Tenants produce unreadable palettes; 2-3 brand colors, derive the rest |
| Member-created stories | Ephemeral member content failed elsewhere; stories stay admin broadcast |
| Multi-language UI | pt-BR only; strings centralized for later |
| Prototype extras: reels, LMS "membros" area (courses, lessons, tracks, lives, progress), forum, explore/search/trending, follow/followers graph, reputation, saved posts, event ticketing/QR/certificates/photos | Present in the design prototype but not in the V1 product definition; not ported |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TENANT-01 | Phase 1 | Complete |
| TENANT-02 | Phase 2 | Complete |
| TENANT-03 | Phase 1 | Complete |
| TENANT-04 | Phase 3 | Complete |
| TENANT-05 | Phase 1 | Complete |
| TENANT-06 | Phase 2 | Gaps Found |
| TENANT-07 | Phase 2 | Complete |
| MOD-01 | Phase 1 | Complete |
| MOD-02 | Phase 1 | Complete |
| MOD-03 | Phase 4 | Complete |
| MOD-04 | Phase 2 | Complete |
| MOD-05 | Phase 8 | Pending |
| ROLE-01 | Phase 1 | Complete |
| ROLE-02 | Phase 1 | Complete |
| ROLE-03 | Phase 2 | Complete |
| ROLE-04 | Phase 2 | Gaps Found |
| ROLE-05 | Phase 2 | Gaps Found |
| ROLE-06 | Phase 1 | Complete |
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| AUTH-05 | Phase 1 | Complete |
| AUTH-06 | Phase 1 | Complete |
| PROF-01 | Phase 3 | Complete |
| PROF-02 | Phase 3 | Complete |
| PROF-03 | Phase 3 | Complete |
| FEED-01 | Phase 4 | Complete |
| FEED-02 | Phase 4 | Complete |
| FEED-03 | Phase 4 | Complete |
| FEED-04 | Phase 4 | Complete |
| FEED-05 | Phase 4 | Complete |
| FEED-06 | Phase 4 | Complete |
| FEED-07 | Phase 4 | Complete |
| FEED-08 | Phase 4 | Complete |
| COMM-01 | Phase 5 | Complete |
| COMM-02 | Phase 5 | Complete |
| COMM-03 | Phase 5 | Pending |
| COMM-04 | Phase 5 | Complete |
| STORY-01 | Phase 5 | Complete |
| STORY-02 | Phase 5 | Pending |
| STORY-03 | Phase 5 | Complete |
| STORY-04 | Phase 5 | Pending |
| STORY-05 | Phase 5 | Pending |
| EVENT-01 | Phase 6 | Pending |
| EVENT-02 | Phase 6 | Pending |
| EVENT-03 | Phase 6 | Pending |
| EVENT-04 | Phase 6 | Pending |
| EVENT-05 | Phase 6 | Pending |
| EVENT-06 | Phase 6 | Pending |
| EVENT-07 | Phase 7 | Pending |
| CHAT-01 | Phase 7 | Pending |
| CHAT-02 | Phase 7 | Pending |
| CHAT-03 | Phase 7 | Pending |
| CHAT-04 | Phase 7 | Pending |
| CHAT-05 | Phase 7 | Pending |
| NOTIF-01 | Phase 7 | Pending |
| NOTIF-02 | Phase 7 | Pending |
| NOTIF-03 | Phase 7 | Pending |
| NOTIF-04 | Phase 7 | Pending |
| MODER-01 | Phase 8 | Pending |
| MODER-02 | Phase 8 | Pending |
| MODER-03 | Phase 8 | Pending |
| ADMIN-01 | Phase 8 | Pending |
| ADMIN-02 | Phase 8 | Pending |
| ADMIN-03 | Phase 8 | Pending |
| ADMIN-04 | Phase 8 | Pending |
| MEDIA-01 | Phase 3 | Complete |
| MEDIA-02 | Phase 3 | Complete |
| MEDIA-03 | Phase 3 | Complete |
| MEDIA-04 | Phase 4 | Complete |
| UI-01 | Phase 2 | Gaps Found |
| UI-02 | Phase 4 | Complete |
| UI-03 | Phase 2 | Gaps Found |
| UI-04 | Phase 2 | Gaps Found |
| PWA-01 | Phase 2 | Gaps Found |
| PWA-02 | Phase 7 | Pending |
| PWA-03 | Phase 2 | Complete |
| PWA-04 | Phase 01.1 | Pending |

**Coverage:**

- v1 requirements: 78 total
- Mapped to phases: 78
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-11*
*Last updated: 2026-09-11 after roadmap creation (traceability filled)*
