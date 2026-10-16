# Requirements: Rede Social

**Defined:** 2026-09-11
**Core Value:** A tenant's members open one branded app and feel it is their organization's community: the tenant's identity everywhere, the tenant's content in the feed, and zero leakage between tenants.

## v1 Requirements

Requirements for initial release (pilot with one real tenant). Each maps to roadmap phases.

### Tenancy & Branding

- [x] **TENANT-01**: A single deployment serves every tenant on that tenant's own custom domain (a hostname the customer owns, registered in `tenant_domains`), while the platform domain serves the platform's `super_admin`; the host only selects the tenant's public shell (login, sign-up, branding) and after login the app resolves tenant, role and modules from the user's membership, rejecting a session whose membership does not belong to the host's tenant
- [x] **TENANT-02**: Each tenant has branding (logo, primary/secondary colors, favicon, display name) that is applied to the whole app shell after login, server-rendered so the user never sees another brand or a default brand flash
- [x] **TENANT-03**: Every tenant-owned row carries `tenant_id`; the API runs tenant requests under a database role subject to Row Level Security (no service-role key for user traffic), so cross-tenant reads/writes are blocked at the DB even if application code has a bug
- [x] **TENANT-04**: Storage objects (media, attachments) are stored under tenant-scoped paths and served only through signed, tenant-checked URLs
- [x] **TENANT-05**: An automated isolation test suite with at least two tenants proves that lists, detail pages, search, notifications, chat and storage never return another tenant's data
- [ ] **TENANT-06**: Authentication e-mails (password recovery, confirmation) are sent with the tenant's display name and logo, not the platform's
- [x] **TENANT-07**: `super_admin` can attach a custom domain to a tenant from the platform panel; the platform registers it with the hosting provider and the auth redirect allow-list, shows the DNS records the customer must create, and reports verification status (pilot/seed tenants get their domains from the provisioning script)

### Modularity (architecture requirement)

- [x] **MOD-01**: The codebase is a monorepo where each feature (feed, communities, stories, events, chat, notifications, moderation, profiles) is a self-contained module package containing its own DB schema/migrations, API routes, domain logic and UI components
- [x] **MOD-02**: A core kernel package provides tenancy, auth/session, roles, feature flags, media broker and shared UI primitives; feature modules depend only on the kernel and on published contracts of other modules, never on another module's internals (enforced by lint/dependency rules)
- [x] **MOD-03**: Modules communicate through domain events (e.g. `post.liked`, `event.rsvp`) consumed by other modules (e.g. notifications) so a module can be removed or replaced without touching the others
- [x] **MOD-04**: Each module is registered in a module registry that declares its routes, navigation entries, feature-flag key and event subscriptions; the API mounts and the app renders only registered, enabled modules
- [ ] **MOD-05**: A module can be reused in another Rede Social project by copying/publishing its package and providing the kernel contracts, documented in a per-module README with its public interface

### Roles & Platform Panel

- [x] **ROLE-01**: Four roles exist: `super_admin` (Rede Social staff, cross-tenant), `admin_tenant`, `support_tenant`, `member`; roles are stored per tenant membership, not on the global user
- [x] **ROLE-02**: Identity is separate from membership: a user record can be linked to a tenant through a membership row carrying role and status, with V1 enforcing one membership per user via a constraint that can be relaxed for V2
- [x] **ROLE-03**: `super_admin` can create a tenant in a platform panel: name, slug, initial branding, enabled modules and the first `admin_tenant` (by e-mail invitation)
- [ ] **ROLE-04**: `super_admin` can enable/disable feature modules per tenant, and the change is reflected in the tenant's navigation and API access without a redeploy
- [ ] **ROLE-05**: `super_admin` can list all tenants with status and open any tenant's settings
- [x] **ROLE-06**: Authorization is enforced in the API for every route based on role and enabled modules (a disabled module's routes return 404 for that tenant)

### Onboarding & Auth

- [x] **AUTH-01**: Each tenant has a public sign-up link; a user who signs up through it becomes a `member` of that tenant, and the link survives the register/login round-trip
- [x] **AUTH-02**: User can sign up and log in with e-mail and password (Supabase Auth via the Next.js server), and stay logged in across browser/PWA restarts
- [x] **AUTH-03**: User can recover a forgotten password via e-mail link
- [x] **AUTH-04**: At sign-up the user must accept the tenant's community rules (editable by `admin_tenant`) and the platform's terms/privacy policy; acceptance is recorded with timestamp
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
- [ ] **COMM-02**: Every tenant member can see every community that is not locked for them. With the `store` module on, a community linked to at least one product is locked for a `member` who holds no entitlement to any of its products (STORE-11), while `admin_tenant` and `support_tenant` see every community in full; with the store off, or for a community linked to no product, every member sees it as before. A community-membership table exists so private/opt-in communities in V2 require no migration (it stays unused by the store). *(Amended by Phase 08.2, 2026-10-08; delivered in Phase 5 as "every tenant member can see every community in V1".)*
- [ ] **COMM-03**: Member can browse the community list (cover, name, description, post count; a locked community keeps all of that, cover in colour, and also carries an "Exclusiva" padlock tag, plus a "Produto arquivado" tag when none of its products is active) and open a community to see its posts and its highlights. A locked community shows only its newest post, read-only, then placeholders and the number of hidden posts, and the section that leads to the store (STORE-13, STORE-14). *(Amended by Phase 08.2, 2026-10-08; Phase 05.2 replaced "pinned stories" with highlights.)*
- [x] **COMM-04**: `admin_tenant` can post directly into a community from the community page

### Stories

- [x] **STORY-01**: `admin_tenant` can publish a story with an image or a short video (up to ~60 s, via the streaming vendor) and optional caption
- [x] **STORY-02**: Members see active stories in a horizontally scrollable strip; tapping opens a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause
- [x] **STORY-03**: A story is visible for 24 h after publishing; after that it is hidden by an `expires_at` filter but the record is retained
- [x] **STORY-04**: `admin_tenant` can keep a story visible after its 24 h expiry in one or more curated places (a community or Início) until it is removed — delivered by Phase 5 as per-community pins and re-delivered by Phase 05.2 through named highlights (HIGHLIGHT-02, HIGHLIGHT-04), which retire the pin model (HIGHLIGHT-05)
- [x] **STORY-05**: Member can like a story and comment on it; story comments cannot be liked or replied to

### Story Highlights

- [x] **HIGHLIGHT-01**: `admin_tenant` can create, rename, re-cover (a frame of one of the highlight's image stories, or an uploaded image) and delete named highlights (a title of up to 15 characters plus a cover) on Início and on each active community, and reorder a place's highlights from that place's "Destaques" manage screen; a highlight with no story is kept and shown only to the admin
- [x] **HIGHLIGHT-02**: `admin_tenant` can add a story to, or remove it from, specific highlights — a story may sit in several — from the viewer, from "Seus stories", from a highlight's edit sheet, or into one highlight at publish; a story inside a highlight stays viewable after its 24 h window, and a highlight plays its stories oldest first by publish time
- [x] **HIGHLIGHT-03**: Início shows ONE grouped circle (the tenant's logo and display name) holding every active story of the tenant, played oldest to newest, followed by Início's highlights in the admin's order, one circle each; at the end of a circle the viewer moves on to the next circle in the row
- [x] **HIGHLIGHT-04**: A community page shows only that community's highlights, with no active-stories circle; with the communities module off, community highlights are unreachable while Início's are unaffected
- [x] **HIGHLIGHT-05**: Every existing community pin is migrated into highlights without loss (one "Destaques" highlight per community that had pins, each pin's author and time carried over), and the pin model — its table, routes, events and the publish `communityId` — is retired
- [x] **HIGHLIGHT-06**: Members get a server-side, cross-device seen state for active stories: the grouped circle's ring is brand-coloured while any active story is unseen and neutral once all are seen, and opening it resumes at the first unseen story (the seen-ring half of V2-CONT-05; the admin's "quem viu" list stays V2)

### Reels

- [x] **REELS-01**: A `reels` feature module (its own package, a registry entry, a `tenant_modules` key) can be toggled per tenant by `super_admin`; it is on by default for existing tenants (backfilled by migration) and for new tenants, and while `feed` is off it contributes nothing — no bootstrap entry, no tab, no page
- [x] **REELS-02**: A "Reels" tab (catalog `reels.nav`, film icon, nav `order: 30`) sits between Comunidades and Eventos and is driven by the module flag, never by data; on `/reels` the mobile TopBar is hidden and the BottomNav floats in dark media chrome declared by the tab's nav entry, and on desktop the video is a centred 9:16 column on a black ground with the desktop rail visible
- [x] **REELS-03**: Reels lists only feed posts with `media_kind = 'video'` whose video asset is `ready`, newest first, on the feed's keyset cursor, through the feed's published contract (`GET /v1/feed?media=video`); "Todos" holds exactly the ready videos Início holds (communities on and off), a community lane holds that community's ready videos, and no other tenant's post is ever returned
- [x] **REELS-04**: The lane row shows "Todos" plus one lane per active community with at least one ready video post, in the Comunidades list order, and is hidden when only "Todos" exists (including when `communities` is off); a tap, a horizontal swipe or ←/→ in the row changes lane and starts at that lane's newest video
- [x] **REELS-05**: One post per full-screen page in an index pager: swipe up/down (dominant axis, 60 px) or, on desktop, the ↑/↓ buttons, arrow keys and a locked mouse wheel change video; videos loop and never auto-advance; the ±1 neighbours stay mounted with their playback tokens pre-minted in one batched request; the next page loads two pages before the end; the position indicator is windowed to 7 ticks
- [ ] **REELS-06**: Each visit starts muted; once turned on, sound stays on for the rest of the visit (never persisted), and a refused unmuted play falls back to muted with the icon flipped; a single tap or Space pauses and resumes, an autoplay-blocked video shows the play badge, and the video pauses while the comment sheet is open or the app is hidden
- [x] **REELS-07**: The rail and caption reuse the feed's own actions: avatar and name open the author's profile and the chip the community; like (with count) is the feed's like, so a like in Reels shows on the same post in Início; a double tap only ever likes; comment opens the feed's threaded comment sheet; share produces the FEED-07 link; the caption clamps to 2 lines with "… mais"/"menos" and its links stay clickable
- [x] **REELS-08**: The empty state (with the `/criar` CTA only for `feed.post.create` holders), the stage load error, the next-page error, the per-video playback error with a retry that mints a fresh token, and like/share failures follow the UI-SPEC, and no raw player or provider error text ever reaches the screen

### Events

- [x] **EVENT-01**: `admin_tenant` can create, edit and cancel events with title, description, cover image, start/end datetime (timezone-aware), and either a physical location or an online link
- [x] **EVENT-02**: Member can view upcoming and past events and open an event's detail
- [x] **EVENT-03**: Member can confirm attendance (RSVP going / not going) before the event and see the number of confirmed attendees
- [x] **EVENT-04**: Member can check in to an event on the day, within a time window around the event start; check-in without prior RSVP counts as a walk-in
- [x] **EVENT-05**: `admin_tenant` can see the attendance list per event with confirmed vs checked-in status
- [x] **EVENT-06**: Member can add an event to their calendar (.ics download and Google Calendar link)
- [x] **EVENT-07**: Members who confirmed receive reminder notifications before the event (24 h and 1 h) through the notification module, via a scheduled job

### Chat (member ↔ support)

- [x] **CHAT-01**: Chat is modeled as generic conversations with participants and messages (with a per-conversation sequence for ordering), so V2 member-to-member chat needs no schema change
- [x] **CHAT-02**: Member can open their single support conversation and send text messages; `support_tenant` users of the tenant receive and answer them
- [x] **CHAT-03**: `support_tenant` sees a list of member conversations ordered by last activity with unread indicators and can open and reply to any of them
- [x] **CHAT-04**: New messages are delivered in real time to open conversations (Supabase Realtime Broadcast on private channels; the browser only receives signals and fetches data through the API)
- [x] **CHAT-05**: Member sees an unread badge on the chat entry when support replied
- [ ] **CHAT-06**: With the `social` module on, a member can send direct 1:1 messages to any other member of the same tenant (no follow required) from their profile, on the same conversation schema (`kind = 'direct'`); promoted from V2-CHAT-01 on 2026-09-25
- [ ] **CHAT-07**: With the `social` module on, a member can block and unblock another member (no messages, no follow, no message button), distinct from the admin's tenant-level block

### Notifications

- [x] **NOTIF-01**: A notification module records in-app notifications for: likes on the member's comments, comments/replies on the member's comments, new posts, new events and event reminders, support replies; all produced from domain events
- [x] **NOTIF-02**: Member has a notification center (bell) with unread count, list of notifications, and mark-as-read; the unread count updates in real time
- [x] **NOTIF-03**: Member can enable Web Push in the installed PWA; push messages carry the tenant's name and icon and open the relevant screen; expired subscriptions are cleaned up
- [x] **NOTIF-04**: The notification module has a channel abstraction (in-app, push) so e-mail/WhatsApp can be added later as adapters

### Moderation

- [ ] **MODER-01**: `admin_tenant` can delete any comment or reply in their tenant (soft-delete with `deleted_by`)
- [ ] **MODER-02**: `admin_tenant` can block a member; the member's session is revoked immediately, they can no longer log in to the tenant, and cannot re-register with the same e-mail through the sign-up link
- [ ] **MODER-03**: Every moderation action (delete, block, unblock) is written to an append-only moderation log with actor, target, timestamp and optional reason, viewable by `admin_tenant`
- [ ] **MODER-04**: With the `social` module on, `admin_tenant` can soft-delete any member post or story and archive or remove any member-created community, each action in the moderation log
- [ ] **MODER-05**: With the `social` module on, a member can report a post, story, community, comment or direct message with a reason; `admin_tenant` works a reports queue (dismiss / remove / block author); promoted from V2-MODER-01 on 2026-09-25

### Tenant Admin Panel

- [ ] **ADMIN-01**: `admin_tenant` can edit the tenant's branding (logo, colors, favicon, display name) with a live preview of the app shell and contrast validation
- [ ] **ADMIN-02**: `admin_tenant` can list and search members, change a member's role (member / support_tenant / admin_tenant), and block/unblock them
- [ ] **ADMIN-03**: `admin_tenant` can edit the community rules text shown at sign-up
- [ ] **ADMIN-04**: All admin creation flows (post, story, community, event) are usable from a phone inside the same app

### Store

Added by Phase 08.2 planning (2026-10-08). A member buys from their own tenant's store; there is no payment step until a later gateway phase plugs into the same order.

- [x] **STORE-01**: A `store` feature module (its own package `@rede-social/module-store`, a registry entry, a `tenant_modules` key appended last to `TOGGLEABLE_MODULES`) is turned on or off per tenant by `super_admin` from the platform panel; it is off for existing tenants (no backfill) and off by default for new ones; while it is off the tenant has no Loja icon and no Loja row in Configurações, every `/v1/store/*` route answers `404 MODULE_DISABLED`, and every community is open exactly as before this phase
- [x] **STORE-02**: `admin_tenant` (permission `store.product.manage`; `support_tenant` and members have none, D-338 posture) can create, edit, archive, reactivate and list products with a name (1–80 characters), a description (up to 2,000), an optional image uploaded through the existing media pipeline (a ready `cover` image of the tenant), and a price in BRL stored as integer cents from 0 to R$ 100.000,00; members never see archived products in the store, and an "Arquivados" filter lists them for the admin
- [x] **STORE-03**: A product links to zero, one or several communities and a community to zero, one or several products; links are written only through the product form (one write path for communities, courses and lives, STORE-22); the community edit form shows them read-only as "Liberada pelos produtos: X, Y" linking to each product; a community can still be created and used with no product *(amended by Phase 08.4, D-418)*
- [x] **STORE-04**: Saving a product whose links would newly lock a community that had no product asks for confirmation in a danger-tone dialog naming N, the number of live `member` memberships of the tenant that would lose access (holders of this product excluded); linking a community another product already gates saves without the dialog
- [x] **STORE-05**: A member reaches Loja from a shopping-bag TopBar slot (first in the right-hand group, before Notificações and Suporte; the BottomNav is unchanged) and sees the tenant's active products, newest first, in a 2-column grid of 4:5 cards (image, name, price or "Grátis", a "Comprado" tag when owned) with a "Todos | Comprados" chip pair, where "Comprados" lists every product the member holds, archived ones included; `admin_tenant` also sees "Novo produto" and an "Arquivados" chip, and reaches the same view from a "Loja" row in Configurações → Administração
- [x] **STORE-06**: A product page shows the image, name, description, price and, only when there are any, the active communities, the published courses and the non-cancelled lives it unlocks (communities first, then courses, then lives; each linked once owned; courses and lives only while `courses` is on, read by every caller through the detail's `unlockedCourses` / `unlockedLives`); its action is "Comprar" ("Obter" for R$ 0) or the "Comprado" state; for `admin_tenant` a "Gerenciar produto" card leads to "Compradores" and "Editar produto" *(amended by Phase 08.5, D-425)*
- [x] **STORE-07**: Confirming the purchase pop-up completes the purchase at once with no payment step and turns into "Compra concluída" listing everything the product unlocks (one target: "Ir para a comunidade" / "Ir para o curso" / "Ir para a live"; several: their list; none: "Fechar"); a purchase started from a locked community's, course's or live's buy section returns there, now unlocked, only when the purchase answer lists that target *(amended by Phase 08.5, D-425)*
- [x] **STORE-08**: A purchase creates one order (status, amount in cents, currency, provider) whose amount and currency are copied from the product row on the server (a client-sent price is never trusted; a stale expected price is refused) and grants one entitlement; an owned product cannot be bought again, and a double tap or a concurrent retry creates exactly one order and one entitlement; R$ 0 uses the same path; a price edit affects only later orders
- [x] **STORE-09**: Access is lifetime until revoked: archiving a product never removes an entitlement already held; revoking ends the entitlement, keeps its order with a `revoked` status, and lets the member buy again; a manual grant creates an entitlement recorded as a grant (no order), distinguishable from a purchase
- [x] **STORE-10**: `admin_tenant` opens a product's "Compradores" list (holders newest first, each tagged "Comprado" or "Concedido"), revokes any row, and grants access to any active member of their own tenant through a member search; a membership of another tenant is a bare 404
- [x] **STORE-11**: With the store on, a community linked to at least one product (archived products included) is locked for a `member` who holds no active entitlement to any of its products, including a community that was open until an admin linked it; a community with no product is open to every member; `admin_tenant` and `support_tenant` always see every community in full
- [x] **STORE-12**: The Comunidades list card of a locked community shows everything it shows today (cover in colour, name, description, post count) plus an "Exclusiva" padlock tag on the cover, and a "Produto arquivado" tag when none of its linked products is active; a manager sees the same tags on every gated community
- [x] **STORE-13**: A locked community's page shows only its newest live post, readable in full (its images, video and attachments open), followed by at most 3 locked placeholders and "+ N publicações exclusivas" (N = live posts minus one, sent as a number only); the hidden posts' text, media ids and comments never leave the server; a locked community with no posts shows the empty state plus the buy section
- [x] **STORE-14**: A locked community's page carries a top buy section: one buyable product opens it, several open a picker pop-up, none (all archived) hides the section
- [x] **STORE-15**: For a member without access, every interaction on a locked community's posts is refused server-side (like, unlike, comment create, comment list, replies, thread, comment like and unlike), the newest post included; share and every other action are hidden in the UI; RLS refuses the same reads and writes if a route forgot
- [x] **STORE-16**: A locked community's posts appear nowhere in Início or Reels (no teaser), the Reels lane row has no lane for it, and a Reels lane request for it returns no item
- [x] **STORE-17**: A share or notification link to a hidden post (`/post/{postId}`) never renders the post for a member without access: the API refuses and the web lands on the community's locked page with the buy section
- [x] **STORE-18**: A locked community's highlights row does not render for a member without access, and `GET /v1/stories/highlights?communityId=` and `GET /v1/stories/highlights/{id}` answer the bare 404 for its highlights, so no highlight cover reaches a non-buyer
- [x] **STORE-19**: A new post in a locked community notifies (in-app and push) only members with access, and the personal comment notifications (reply, comment liked) about a locked community's posts are not delivered to members without access
- [x] **STORE-20**: Orders and entitlements are written only through `SECURITY DEFINER` functions that read the price and the target membership inside the caller's tenant; a member lane reads only its own orders and entitlements, `admin_tenant` reads the tenant's; products and links carry the tenant isolation policy
- [x] **STORE-21**: The two-tenant isolation suite covers the new tables (pgTAP), every new route (route inventory and API cases, wrong host 403), the gate (a locked community's hidden post is invisible in A's member lane), the cross-tenant grant (refused), and the shared identity: an identity that bought product P in tenant A gains nothing in tenant B
- [x] **STORE-22**: While the `courses` module is on, the product form also carries "Cursos liberados" and "Lives liberadas" multi-selects (the tenant's draft and published courses; its lives that are not cancelled); `courseIds` / `liveIds` on `POST` / `PATCH /v1/store/products` replace the product's set as `communityIds` does (a course or live of another tenant, unknown, or not linkable and not already linked to the product is `400 course_invalid` / `live_invalid`; a link to an archived course or a cancelled live is kept when the set is replaced, so its buyers keep access); the links live in the store's `store_product_courses` / `store_product_lives`; only a caller holding `store.product.manage` reads a product's linked courses and lives; with `courses` off the blocks are absent and nothing is sent; the course and live routes accept no product key *(SC 1, SC 3, SC 4, Phase 08.4, D-418)*
- [x] **STORE-23**: With the store on, `GET /v1/store/course-access` and `GET /v1/store/live-access` answer one row per gated published course / gated live (`locked` for the caller, always false for staff; `archivedTag` when none of its products is active; an open course or live has no row), and `GET /v1/store/courses/{courseId}/access` and `GET /v1/store/lives/{liveId}/access` answer `locked`, `gated`, `archivedTag` and the buyable products (active, newest first) for the buy section, plus the full product list for a `store.product.manage` holder; an unknown, foreign or (for a member) unpublished id is the bare 404; with `courses` off the two lists answer no row and the single reads the bare 404 *(SC 1, SC 5, Phase 08.5, D-421, D-424; mirrors STORE-12 / STORE-14)*

### Courses

Added by Phase 08.3 planning (2026-10-13). A tenant runs a school from its admin panel; the member-facing side (catalogue, player, progress, certificates) is modeled here and built in the following phase. COURSE-16..27 were added by Phase 08.5 planning (2026-10-15): the member side — the Cursos tab, the catalogue, the course page, the player, progress and the sequential lock, the lives agenda and the live page. COURSE-28..52 were added by Phase 08.6 planning (2026-10-16): the member area — the school home (Início), the member's tracks, Meu progresso and the study streak, the per-live reminder, the new-content notices and the live reactivation.

- [x] **COURSE-01**: A `courses` feature module (its own package `@rede-social/module-courses`, a registry entry in both apps, a `tenant_modules` key appended last to `TOGGLEABLE_MODULES`, a README with the MOD-05 headings) is turned on or off per tenant by `super_admin` from the platform panel; it is off for existing tenants (no backfill) and off by default for new ones; it declares no `nav` entry in this phase, so members see no tab and no icon; while it is off the tenant has no "Cursos" row in Configurações, `/cursos` answers the kernel not-found and every `/v1/courses/*` route answers `404 MODULE_DISABLED`; nothing else in the app changes *(SC 1, D-400, D-401, STORE-01 posture)*
- [x] **COURSE-02**: `admin_tenant` (permission `courses.manage`, composed for `admin_tenant` only by construction: routes authorise by the permission, every SQL write policy by the `admin_tenant` claim, and the registry unit test pins the composition; `support_tenant` and members have none, D-338) can create, edit, publish, unpublish and archive a course with a title (1–120), tagline (≤160), description (≤5,000), zero or one category, an optional level (`iniciante | intermediario | avancado`), a cover image (a ready `cover` image of the tenant), an instructor name plus optional photo (a ready `cover` image, no membership FK), up to 10 "what you will master" bullets (≤120 each) and optional certificate hours (0–999); a course is `draft` until published, unpublish returns it to `draft`, archive never deletes and has no way back in this phase; the admin list is newest first with a `Todos | Rascunhos | Publicados | Arquivados` chip filter; a `member` or a `support_tenant` calling any `/v1/courses/*` route gets `403 FORBIDDEN` *(SC 2, D-403, D-412, D-413, Claude's Discretion caps/level)*
- [x] **COURSE-03**: Publishing is refused with `409 CONFLICT` `details.courses = video_not_ready` naming the lesson ids while any live lesson's video asset is not `ready` (an asset the tenant lane cannot see counts as not ready); the course page shows the inline notice "Não é possível publicar: N aulas ainda processam o vídeo" with the lessons as links and keeps the publish button disabled until every video is ready; unpublishing a course that already has progress rows keeps them *(SC 2, D-413)*
- [x] **COURSE-04**: `admin_tenant` manages a per-tenant category list (name 1–60, unique per tenant ignoring case — `409 category_exists` —, cover image, no icon) from a "Categorias" row inside the Cursos tab; a category with courses cannot be removed (`409 category_in_use`), an empty one can; the prototype's six categories are never seeded as product *(D-411)*
- [x] **COURSE-05**: Inside a course the admin creates ordered modules (title 1–120, summary ≤500, a `requires_previous` switch "Exige concluir o módulo anterior" that nothing evaluates in this phase and that is forced off on the first module) and reorders them with up/down arrows persisted by an idempotent `PUT /v1/courses/{courseId}/modules/order` that replaces the whole order (`409 order_stale` when the set changed); removing a module is a soft delete that leaves every list and keeps progress rows *(SC 3, D-406, D-414)*
- [x] **COURSE-06**: Inside a module the admin creates ordered lessons (title 1–120, description ≤2,000, an "Aula aberta" `is_free` switch) and reorders them with the same arrows and `PUT /v1/courses/modules/{moduleId}/lessons/order`; a lesson's video is optional and, when present, is one `media_assets` row of the new `lesson` purpose uploaded directly to the video provider through the existing direct-upload flow, with `duration_seconds` and the thumbnail taken from the ready asset and never typed; a video asset belongs to at most one live lesson (`400 video_in_use`); there is no lesson `type` column ("vídeo" vs "prática" is derived from the asset, "replay" from a live pointing at it); removing a lesson is a soft delete *(SC 3, D-407, D-409, D-414)*
- [x] **COURSE-07**: A lesson carries zero to 10 materials, each a ready `attachment` asset of the tenant — a PDF, a spreadsheet (`xls`/`xlsx`), a slide deck (`ppt`/`pptx`) or an image (`jpeg`/`png`/`webp`), up to 50 MB each, the `attachment` limit widened to those kinds with a magic-byte check per kind at `complete` (D-410) — uploaded through the existing pipeline into the private bucket and written as one ordered set by `PUT /v1/courses/lessons/{lessonId}/materials`; the admin sees name, kind and size, reorders and removes; a material is opened only through `GET /v1/courses/lessons/{lessonId}/materials/{materialId}/url`, which answers `Cache-Control: no-store` with a signed Storage URL that expires in 10 minutes and, in this phase, is behind `courses.manage` *(SC 3, D-410, Claude's Discretion signed URLs)*
- [x] **COURSE-08**: A course links to zero or more active store products of its own tenant (the store's `store_product_courses`, written only through the product form, STORE-22; the course form shows the linking products read-only as "Liberado pelos produtos: X, Y", or nothing when none); the gate is a kernel SQL seam (`app.course_locked_ids()`, `app.course_locked_ids_for(uuid)`, and the live pair `app.live_locked_ids()` / `app.live_locked_ids_for(uuid)`) declared as stubs by a kernel migration and given bodies by the store module's migration, answering "every course of this tenant linked to at least one product for which the user holds no active entitlement", `'{}'` for staff claims and while the tenant's `store` row is off; `courses` does not `require` `store`: with the store off the read-only line is absent and every course is open; `courses` carries a published-or-admin select policy and `course_lessons` / `course_lesson_materials` carry a restrictive select policy that hides a locked course's non-free lessons from a `member` lane from day one *(SC 4, D-404, D-405, D-407)* *(amended by Phase 08.4, D-418)*
- [x] **COURSE-09**: A `course_lesson_progress` table keyed by `(tenant_id, user_id, lesson_id)` with `completed_at` and `last_position_seconds` exists with own-or-admin select and own-row insert/update policies and no delete policy; no route reads or writes it in this phase and pgTAP proves a member lane reads only its own rows, an `admin_tenant` lane the tenant's, and the primary key is the arbiter of a second write for the same lesson *(SC 4, D-408)*
- [x] **COURSE-10**: `admin_tenant` can create, edit and archive a learning track (title 1–120, subtitle ≤160, audience ≤60, description ≤2,000, cover) whose ordered courses are written as one list by `PUT /v1/courses/tracks/{trackId}/order` (published courses of the tenant only; a draft, archived or foreign course is `400 course_invalid`; an empty list is valid); a course may belong to several tracks; an archived or unpublished course drops out of the track at read time while its link row stays; a track has no lessons and no hours of its own *(SC 5, D-414, D-415)*
- [x] **COURSE-11**: `admin_tenant` can create, edit and cancel a live (title 1–120, description ≤2,000, cover, `starts_at`, `duration_min` 5–600, an `https` `external_url`, optional products, linked from the product form (STORE-22) and shown read-only in the live form, an optional `replay_lesson_id` pointing at a live lesson of the tenant and settable only once the live has ended); `scheduled | live | recorded` are computed from the clock by one shared `liveStatusAt` helper and never stored; `cancelled_at` is a stored state and never a delete; cancel is idempotent and an edit after cancel is `409 live_cancelled` *(SC 6, D-416)* *(amended by Phase 08.4, D-418)*
- [x] **COURSE-12**: The `lesson` media purpose is accepted by `MEDIA_PURPOSES`, the `media_assets` purpose CHECK, `MEDIA_LIMITS.video.lesson` (4 GiB and 4 hours, its own caps) and the web upload field (`purpose` prop); a lesson video longer than the cap is rejected by the ready-event job as today; the playback credential of a lesson lives at least its duration plus 30 minutes, capped at 12 hours; lesson video has its own per-tenant seconds ceiling (200 h) and no longer counts against the 3-hour feed/stories budget *(D-409, SC 3)*
- [x] **COURSE-13**: The two-tenant isolation suite covers every new table (pgTAP 020 six-case blocks and the 010 shipped-table list), every new route (an `isolation-inventory.ts` entry and a `phase 08.3 sweep: courses` API case with the wrong-host 403), the gate truth table (`190-courses.sql`: open, linked and held, linked and not held, staff, store off, null claim, free lesson), the cross-tenant link (a product of B in a course of A is refused), the media (a lesson asset or material of A answers the bare 404 from B's lane) and the shared identity (an identity enrolled in A and B holding P in A has no course access and no progress in B) *(SC 7, STORE-21 posture)*
- [x] **COURSE-14**: Every admin surface is reachable from the existing admin panel and works on a phone: a "Cursos" row in Configurações → Administração (gated on the composed `courses.manage`, absent from the DOM otherwise) opens the `/cursos` hub with the area tabs `Cursos | Trilhas | Lives`, each tab a list with its "Novo" action and in-context edit/archive; every surface is drawn in `.planning/sketches/009-phase-08.3-designed-screens` and contracted in `08.3-UI-SPEC.md` before UI tasks, every string lives in `apps/web/messages/pt-BR/courses.json` (plus the `app.courses.json` row label and `platform.courses.json` panel strings) *(SC 8, D-402, D-417)*
- [x] **COURSE-15**: Migrations are expand-only and apply before the API that calls them (kernel stubs first, generated tables second, hand SQL third, store bodies fourth, the bucket widening at any point); `pnpm db:generate` leaves `supabase/migrations` clean after every plan; the module's README lists the seam it consumes and the seam the store implements for it, and `docs/DEPLOY.md` carries the Phase 08.3 release order *(CLAUDE.md migrations rule, MOD-05)*
- [x] **COURSE-16**: With `courses` on, the `courses` manifest declares a BottomNav tab ("Cursos", `graduation-cap`, `/cursos`, order 30) and Reels — whose manifest declares that it yields its tab to `courses` — renders as a TopBar slot instead, leftmost in the right-hand group (before Loja) and first in the rail's bottom group, keeping its dark media chrome on `/reels`; the TopBar right group spaces its slots `gap-1` below 360px and `gap-3` from 360px; with `courses` off the BottomNav, the TopBar and the rail are unchanged and Reels stays a tab; `/cursos` opens for every member of a tenant with the module on (a `member`, a `support_tenant` and an `admin_tenant` with `?ver=aluno` get the member catalogue, a `courses.manage` holder otherwise the D-402 hub) *(SC 1, Phase 08.5, D-401, D-419, D-420)*
- [x] **COURSE-17**: A member's `/cursos` shows the area tabs `Cursos | Lives`; Cursos is a grid of 3:4 posters of the tenant's PUBLISHED courses (`GET /v1/courses/learn/courses`, newest published first, keyset pages of 20), each with cover, title, category, level, lesson count and duration; a course locked for the member keeps all of that and adds an "Exclusivo" padlock tag (plus "Produto arquivado" when none of its products is active); category chips appear only when at least one category has a published course; a card shows a progress bar once the member completed at least one lesson; an archived or unpublished course is absent for every member and its pages answer the kernel not-found, with its progress rows kept *(SC 1, Phase 08.5, D-420, D-421, D-426, D-430)*
- [x] **COURSE-18**: A member's course page (`GET /v1/courses/learn/courses/{courseId}`) shows the header, every live module (title, order) and every live lesson (title, duration, "Aula aberta" tag, lock state, completed check) even while the course is locked; for a locked non-free lesson its description, video asset id, playback credential, thumbnail, material names and material ids never leave the server (a `SECURITY DEFINER` projection pinned to the caller's tenant; the restrictive lesson and live policies stay unchanged); a progress bar with percent and "Começar" / "Continuar" lead to the next uncompleted lesson the member can open (denominator: live lessons, free included); a locked course carries the 08.2 top buy section (one buyable product opens it, several open the picker, none hides it), a tap on a purchase-locked lesson lands on its lock page with the same buy action, and a tap on a sequence-locked lesson shows "Libera ao concluir …" with no buy action *(SC 2, Phase 08.5, D-423, D-424, D-430)*
- [x] **COURSE-19**: A member who can open a lesson reads it through `GET /v1/courses/learn/lessons/{lessonId}`, watches its video through the existing signed playback (resuming from `last_position_seconds`) and opens its materials through `GET /v1/courses/learn/lessons/{lessonId}/materials/{materialId}/url` (10-minute signed URL, `Cache-Control: no-store`, no `courses.manage`); an unknown, foreign, unpublished or removed course or lesson (a lesson under a removed module included) is the bare 404, a purchase-locked lesson `403 { courses: 'lesson_locked' }`, a sequence-locked lesson `409 { courses: 'lesson_sequence_locked' }` *(SC 3, Phase 08.5, D-427, D-430)*
- [x] **COURSE-20**: `GET /v1/media/{assetId}/playback` and `GET /v1/media/{assetId}/original` answer the bare 404 to a member lane for a `lesson`-purpose video or a lesson material unless one of the live lessons holding it is open to the caller through the course door (published course; not purchase-locked or free; not sequence-locked) or the live door (a non-cancelled live the caller can open whose replay is that lesson); the rule is the kernel seam `app.course_asset_hidden(uuid)` (kernel stub, courses body) asked beside the feed's `app.media_asset_hidden(uuid)`; staff claims are never refused; a lesson video no live lesson holds is refused to members; image variants stay zero-read; closes T-08.3-05 and T-08.3-08 *(SC 3, Phase 08.5, D-433)*
- [x] **COURSE-21**: `PUT /v1/courses/learn/lessons/{lessonId}/progress` writes the caller's own `course_lesson_progress` row (upsert on the primary key): `last_position_seconds` clamped to the asset duration, `completed_at` set once when the position reaches 90% of `duration_seconds` or when `completed: true` is sent ("Marcar como concluída"), never cleared; it is refused like the lesson read for a lesson the caller cannot open (a free lesson always writes, even for a non-buyer); an `admin_tenant` writes nothing; the web writes at most every 15 s while playing plus on pause, end and `pagehide` (beacon); the progress insert and update policies also refuse a lesson the lane cannot open *(SC 4, Phase 08.5, D-422, D-427, D-429)*
- [x] **COURSE-22**: `course_lessons` gains `requires_previous` (expand-only, default false) with the lesson-form switch "Exige concluir a aula anterior", forced off on the first lesson of the course on every write, reorder and removal and sent `false` while "Aula aberta" is on; one server-side evaluator (`app.course_lesson_states`) decides each lesson's lock: purchase (course locked and lesson not free) before sequence; a module with `requires_previous` locks its lessons until every live lesson of the previous non-empty live module is complete; a lesson with `requires_previous` locks until the previous live lesson in course order (possibly in the previous module) is complete; a free lesson ignores the sequence lock; staff are never locked; the web only labels the lock it receives *(SC 4, Phase 08.5, D-428, D-429)*
- [x] **COURSE-23**: A member's Lives tab (`GET /v1/courses/learn/lives`) lists, first, lives happening now and scheduled lives (nearest first; a cancelled one with "Cancelada" until its planned end), then recorded lives that have a live replay lesson (newest first); an ended live with no replay is absent; each card shows cover, date and time in the tenant's timezone, duration and status, and a locked live adds the padlock tag; the listing never carries `external_url` or the replay lesson id *(SC 1, SC 5, Phase 08.5, D-431)*
- [x] **COURSE-24**: Each live has a page at `/cursos/lives/{liveId}` (`GET /v1/courses/learn/lives/{liveId}`) showing cover, title, description, date and duration; for a member with access, `joinUrl` is answered only from 15 minutes before `starts_at` until `starts_at + duration_min` ("Entrar na live"), "Começa em …" before, and the replay player (video, materials, progress) after when a replay exists; a locked live shows the padlock and the D-424 buy section and never receives `joinUrl` or the replay; a cancelled live keeps its page with "Cancelada" and no join link, replay or buy; access to the live OR to the replay lesson's course opens the replay, and the live door ignores the course's sequential lock *(SC 5, Phase 08.5, D-432, D-433, D-434)*
- [x] **COURSE-25**: An `admin_tenant` keeps the hub and sees "Ver como aluno" on each published course (hub row and admin course page), which opens the member course page with a preview banner, where lessons play and materials open with no progress written; `support_tenant` sees every member view fully open and writes its own progress *(SC 6, Phase 08.5, D-422)*
- [x] **COURSE-26**: The two-tenant isolation suite covers every new member route (an `isolation-inventory.ts` entry and a `phase 08.5 sweep` API case with the wrong-host 403), the new SQL functions (pgTAP `195-courses-member.sql`, the member sibling of 190: purchase lock, sequence lock per module and per lesson, free-lesson bypass, staff, store off, null claim, live double door, the titles-only projection never projecting a locked lesson's description, asset or materials, the live projection never projecting `external_url`), the progress writes (own row only, refused for a locked lesson, cross-tenant refused), the asset gate (`media-playback.test.ts` gated-lesson and material refusals by remembered id) and the shared identity (`160-shared-identity.sql`: an identity holding P in A has no course access and no progress in B); every 190 assertion stays byte-identical and green; T-08.3-05 and T-08.3-08 reach `status: resolved` *(SC 6, Phase 08.5)*
- [x] **COURSE-27**: Migrations are expand-only and apply before the API that calls them (the kernel stub, then the generated column and index, then the courses functions, then the generated policy change); `pnpm db:generate` leaves `supabase/migrations` clean after every plan; the module README lists the new seam and functions; `docs/DEPLOY.md` carries the Phase 08.5 release order *(CLAUDE.md migrations rule, MOD-05, Phase 08.5)*
- [ ] **COURSE-28**: For every caller who does not manage the school (`member`, `support_tenant`) and for an `admin_tenant` with `?ver=aluno`, `/cursos` shows five area tabs Início · Cursos · Trilhas · Lives · Progresso (the shipped underline `Tabs` in a compact density); bare `/cursos` and an unknown, empty or repeated `?aba=` render Início, `?aba=cursos`, `?aba=trilhas`, `?aba=lives` and `?aba=progresso` render the other four; every member link to the catalogue ("Todas", the category chips, "Ver tudo", the category tiles, "Ver todos os cursos") carries `aba=cursos`, every preview link keeps `ver=aluno`, and each tab body carries its own testid *(SC 1, Phase 08.6, D-435, UI-D-446, UI-D-447)*
- [x] **COURSE-29**: `GET /v1/courses/learn/overview` answers `streakDays`, `serverNow` and a hero decided on the server: `retomando` (the unlocked, incomplete published course holding the caller's most recently updated progress row, resuming that row's lesson when it is incomplete and open, else the course's next open incomplete lesson), else `comecando` (the first open lesson of the first unlocked, unstarted published course in catalogue order), else `em_dia` (the first incomplete free lesson of a locked course, else the first locked course with no lesson, else the most recently touched course with no lesson); there is no hero when no published course has a live lesson, and a course locked for the caller is never `retomando` or `comecando` *(SC 1, Phase 08.6, D-437)*
- [ ] **COURSE-30**: The overview's `shelf` ("Meus cursos") lists at most 3 published courses, never the hero's, in the order: in progress (last activity first), the next unstarted unlocked course of the active track, other unstarted unlocked courses (catalogue order), locked courses as a shop window (`kind: 'bloqueado'`, catalogue order), completed courses (last activity first); each course appears once and the list is never padded *(SC 1, Phase 08.6, D-436)*
- [ ] **COURSE-31**: The overview's `track` is the active track (holding at least one published course) whose published courses hold the highest percentage of the caller's completed live lessons among tracks with at least one completion, ties broken by the admin list order (`created_at desc, id desc`); with none started it is the first active track in that order with `suggested: true`; with no such track the field is absent; it carries the step index, the course to resume and the title of the last locked course of the path *(SC 1, Phase 08.6, D-438)*
- [ ] **COURSE-32**: The overview's `live` is the live happening now, else the nearest scheduled non-cancelled live, with its `status`, `locked` and the caller's own `reminderOn`, and never `external_url` or a replay lesson id; it is absent when no such live exists *(SC 1, Phase 08.6, D-444, D-446)*
- [ ] **COURSE-33**: The overview's `newLessons` ("Novas aulas da semana") lists at most 4 live lessons of published courses that the caller can open (evaluator lock reason null) whose `greatest(lesson.created_at, course.published_at)` falls within the last 7 days, newest first, by title only; a locked lesson never appears *(SC 1, Phase 08.6, D-423)*
- [ ] **COURSE-34**: The overview's `categories` lists every category holding at least one published course, with its published-course count and cover, ordered `lower(name), id`; every overview section with no data is absent from the answer and from the page, and a tenant with no published course renders Início's empty state (the greeting, the catalogue empty card, and a live when one exists) *(SC 1, Phase 08.6)*
- [ ] **COURSE-35**: `GET /v1/courses/learn/tracks` lists, in the admin list order, the tenant's active tracks that hold at least one published course, each with its published courses in track order; each course carries `state` (`concluida`, `em_andamento`, `a_seguir`, `bloqueada`), `locked`, its lesson count, duration and the caller's done count; each track carries `percent = floor(done × 100 / total)` over its courses' live lessons and the `mine` / `suggested` flags of COURSE-31; a draft or archived course and an archived track are absent; `/cursos?aba=trilhas` shows one track at a time (`?trilha=`) with its path, and a locked step still links to the 08.5 buy path *(SC 2, Phase 08.6, D-439, D-415, D-421, D-424)*
- [ ] **COURSE-36**: `GET /v1/courses/learn/progress` lists every published course in which the caller has at least one progress row, with percent, done and total and `locked`, ordered by the caller's last progress activity on that course (newest first); a locked course the caller never started is absent *(SC 3, Phase 08.6)*
- [ ] **COURSE-37**: The overview and progress answers carry `streakDays`, computed in SQL by `app.course_member_streak()` from the caller's own `course_lesson_progress.completed_at` bucketed by `tenants.timezone`: the run of consecutive local dates with at least one completion that ends today, or yesterday when today has none; it is 0 otherwise and 0 for an `admin_tenant`, no request body or parameter influences it, and it drives no notification, reward or nudge (display only) *(SC 4, Phase 08.6, D-440, D-441, D-443)*
- [ ] **COURSE-38**: The progress answer carries `lessonsDone` (the caller's completed live lessons of published courses), `lessonsTotal` (the live lessons of every published course, locked ones included), `secondsWatched` (the sum of the ready-video `duration_seconds` of the completed lessons, 0 for a lesson without a ready video) and `coursesDone` (published courses with at least one live lesson, all of them complete, recomputed on every read) *(SC 3, Phase 08.6, D-442)*
- [x] **COURSE-39**: A new own-row table `course_live_reminders (tenant_id, user_id, live_id, created_at)` with primary key `(tenant_id, user_id, live_id)` has RLS select, insert and delete policies limited to `tenant_id = app.tenant_id() and user_id = app.user_id()`, an insert check that refuses the `admin_tenant` claim and a live in `app.live_locked_ids()`, and no update policy; no other member and no staff lane reads another caller's opt-ins *(SC 6, Phase 08.6, D-444, D-446)*
- [ ] **COURSE-40**: `GET`, `PUT` and `DELETE /v1/courses/learn/lives/{liveId}/reminder` read, set and clear the caller's own opt-in and answer `{ on }`; `PUT` is refused `403 { courses: 'live_locked' }` for a live the caller cannot open and `409 { courses: 'reminder_closed' }` for a cancelled or already started live; an unknown or foreign live is the bare 404; an `admin_tenant`'s `PUT` and `DELETE` answer 204 and write nothing; the "Ativar lembrete" / "Lembrete ativado" toggle sits on Início's next-live card and on the live page before its join window *(SC 5, Phase 08.6, D-444, D-446, UI-D-453)*
- [x] **COURSE-41**: A `courses.live_reminder` pg-boss job is armed inside the write transaction at `starts_at − 15 min` (on an opt-in, when an edit moves the start, on a reactivation) with the singleton key `{liveId}:{startsAtEpochSeconds}`; a fire time already past arms nothing; at fire time it sends nothing when the live is missing, cancelled or moved, the `courses` module is off, the live has started or the worker is more than 10 minutes late, and otherwise delivers one `courses.live_reminder` (in_app + push, opening `/cursos/lives/{liveId}`) to each opted-in live membership for which `app.live_locked_ids_for(user)` does not hold the live *(SC 5, Phase 08.6, D-445, D-446, D-447)*
- [x] **COURSE-42**: The first cancel of a live whose planned end is still ahead delivers one `courses.live_cancelled` notice (in_app + push, opening the live page) to every opted-in live membership, and a waiting reminder for that live sends nothing *(SC 5, Phase 08.6, D-447)*
- [ ] **COURSE-43**: `POST /v1/courses/lives/{liveId}/reactivate` (`courses.manage`) clears `cancelled_at` on a cancelled live whose start is still ahead, re-arms the reminder for the existing opt-ins and emits the live-scheduled notice with `reactivated: true`; a live that is not cancelled or whose start has passed is refused `409 { courses: 'live_not_reactivatable' }`; `GET /v1/courses/lives/{liveId}/reactivation` answers `{ reactivatable }` decided on the server; the admin live form's cancelled state shows "Reativar live" with a brand confirmation while the start is ahead and the past-start note otherwise, and the cancel dialog's body says that opted-in members are told *(Phase 08.6, D-447, D-448, D-452, UI-D-462)*
- [x] **COURSE-44**: A `draft → published` transition whose `courses.published_notified_at` is null or older than 24 hours stamps it, marks the course's live lessons announced and delivers one `courses.course_published` notice (in_app + push, opening `/cursos/{courseId}`) to every live `member` and `support_tenant` membership except the actor, with or without access to the course (shop window); a republish within 24 hours delivers nothing *(SC 5, Phase 08.6, D-448, D-449, D-453)*
- [x] **COURSE-45**: A lesson created in a published course arms a `courses.lessons_batch` job 30 minutes later (one waiting job per course); the job atomically claims the course's unannounced live lessons whose video is ready or absent (`course_lessons.announced_at`) and delivers one `courses.lessons_added` notice with the count to the live `member` and `support_tenant` memberships for which the course is not purchase-locked; it re-arms itself while unclaimed lessons younger than 24 hours remain; a lesson is never announced twice, and the lessons present when a course is (re)published are marked announced without a lessons notice *(SC 5, Phase 08.6, D-448, D-449, D-450, D-453)*
- [x] **COURSE-46**: Creating a live whose start is in the future, and reactivating one (COURSE-43), delivers one `courses.live_scheduled` notice (in_app + push, opening the live page; `reactivated: true` on a reactivation) to every live `member` and `support_tenant` membership except the actor; a live whose start has passed or that is cancelled before the fan-out runs delivers nothing *(SC 5, Phase 08.6, D-448, D-449, D-453)*
- [x] **COURSE-47**: Setting a new non-null `replay_lesson_id` on a live delivers one `courses.replay_available` notice (opening the live page) only to the live memberships that can open the live or the replay lesson's published course (not purchase-locked, or the lesson is free); the notice names the live, never the lesson *(SC 5, Phase 08.6, D-448, D-449, D-433)*
- [ ] **COURSE-48**: Every courses notice goes through the Phase 7 channels `['in_app', 'push']` with facts limited to ids, instants, counts, the actor and the course or live title — never a lesson title or description, an asset id, a playback credential or `external_url`; no notice is produced while the tenant's `courses` or `notifications` module is off; push bodies are server-side pt-BR in the tenant's timezone; the web renders each of the six kinds with its glyph, catalog sentence and deep link (a missing id degrades to `/cursos`), and the generic renderer never appears for them *(SC 5, Phase 08.6, D-449, D-451, UI-D-460, UI-D-461)*
- [x] **COURSE-49**: A course that leaves `published` (unpublished or archived) emits `course.unpublished`, which retracts the course's existing `courses.course_published` and `courses.lessons_added` rows (07-04 keep-and-mark: "Este conteúdo foi removido."), so unpublished content is never named in the bell after the fact *(SC 5, Phase 08.6, D-449, D-454, D-426)*
- [ ] **COURSE-50**: An `admin_tenant` with `?ver=aluno` sees the five tabs with the D-422 preview banner on the area page, a zero streak and zero numbers (no rows), and a disabled reminder toggle with the hint "Os lembretes não funcionam no modo aluno." that sends nothing; a `support_tenant` sees every course and live open, writes its own progress and reminders, and receives the course notices like a member *(SC 6, Phase 08.6, D-422, D-453, UI-D-459)*
- [ ] **COURSE-51**: The two-tenant isolation suite covers every new route (an `isolation-inventory.ts` entry and a `phase 08.6 sweep` case with the wrong-host 403); pgTAP `196-courses-member-area.sql` covers the reminder table policies, the member projection and the streak's timezone bucketing, `197-courses-notices.sql` covers every audience and claim definer (tenant pin, null claim, live memberships, access filtering, staff, store off), `010` and `020` list the new table and `160` proves a shared identity has no opt-in, streak or progress in the other tenant; integration tests cover the reminder opt-in, its arming and fire-time checks and every fan-out audience; every 190 and 195 assertion stays green *(SC 6, Phase 08.6)*
- [ ] **COURSE-52**: Migrations are expand-only and apply before the API that calls them (each generated migration before the custom one that reads it, the `announced_at` backfill in the same release as its column); `pnpm db:generate` prints "No schema changes" after every plan; the courses README lists the new events, jobs, functions and notification kinds; `docs/DEPLOY.md` carries the Phase 08.6 release order *(CLAUDE.md migrations rule, MOD-05, Phase 08.6)*

### Media

- [x] **MEDIA-01**: Uploads go directly from the browser to Supabase Storage using signed upload URLs brokered by the API (files never transit Cloud Run); the API confirms the upload and records the asset with tenant scope
- [x] **MEDIA-02**: Images are resized/compressed server-side (worker) into display sizes; original size and type limits are enforced (Supabase Free plan: 50 MB per file, no native transforms)
- [x] **MEDIA-03**: Videos are uploaded to a streaming vendor (Mux or Cloudflare Stream, chosen in the media phase) that transcodes and serves HLS with thumbnails; playback works on iOS and Android
- [x] **MEDIA-04**: Link unfurling runs server-side with an SSRF guard and caches title/description/image on the post

### Design Prototype (UI source of truth)

- [ ] **UI-01**: The app's visual language (tokens, typography, spacing, motion, component styling) follows the design team's prototype in `reference/frontend-design/`; shared primitives (Button, IconButton, Avatar, Badge, BottomSheet, ConfirmDialog, EmptyState, Input, Skeleton, Tabs, Toast, TopBar, BottomNav, PullToRefresh, SafeAreaWrapper) are ported into the kernel shared-UI package
- [x] **UI-02**: Feature screens are ported into their module package as each vertical phase is built, replacing mock data with API calls and keeping the prototype's interactions (double-tap like, comment sheet, infinite scroll, pull-to-refresh, swipe)
- [ ] **UI-03**: The prototype's hardcoded brand (hex literals, "Igor Alves" strings, `lib/nav.ts`) is replaced by tenant-driven theme variables, tenant display name and flag-driven navigation; the iPhone `DeviceShell` mockup is replaced by a real responsive app shell with a desktop layout
- [x] **UI-04**: Screens the prototype lacks (stories strip/viewer, admin composers, admin panel, platform panel, moderation, support inbox) are designed in the prototype's language and reviewed with the design team before implementation

### PWA & Platform

- [ ] **PWA-01**: The app is mobile-first and responsive on desktop, installable as a PWA (manifest + service worker), and works in standalone mode
- [x] **PWA-02**: On iOS, users are shown a short "Adicionar à Tela de Início" hint before push can be enabled, since Web Push on iOS requires installation
- [x] **PWA-03**: All UI text is pt-BR and centralized in a message catalog for future i18n
- [ ] **PWA-04**: GitHub is the source of truth: pushes deploy the Next.js app to Vercel and the API/worker to Cloud Run automatically, with separate preview/staging and production environments

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Content & Social

- ~~**V2-CONT-01**: Members can create posts (per-tenant policy flip on FEED-08)~~ — promoted to Phase 9 (post-MVP) via the `social` module, 2026-09-25
- ~~**V2-CONT-02**: Members can create communities~~ — promoted to Phase 10 (post-MVP) via the `social` module (only the creator publishes in it), 2026-09-25; private/opt-in communities using COMM-02's membership table remain V2
- **V2-CONT-03**: Pin post to top of feed/community
- **V2-CONT-04**: Scheduled publishing of posts
- ~~**V2-CONT-05**: Story seen/unseen ring and admin "who viewed" list~~ — seen/unseen ring promoted to V1 as HIGHLIGHT-06 (Phase 05.2), 2026-09-25; the admin "who viewed" list remains V2
- **V2-CONT-06**: Emoji reactions instead of plain like

### Chat & Notifications

- ~~**V2-CHAT-01**: Member-to-member chat on the same conversation schema~~ — promoted to V1 as CHAT-06 (Phase 11, post-MVP), 2026-09-25
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
- ~~**V2-MODER-01**: Member reports content with reason; admin reports queue~~ — promoted to V1 as MODER-05 (Phase 11, post-MVP), 2026-09-25
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
| Billing / subscription checkout for tenants (a tenant paying the platform) | Tenants are provisioned by Rede Social; plan/status fields exist on the tenant record for later. A member buying from their own tenant's store is in scope (STORE-*), with no payment step until a later gateway phase plugs into the same order |
| Public (logged-out) post pages / SEO | Breaks the private-community promise and leaks tenant content; internal deep links only |
| Native iOS/Android apps | PWA covers mobile in V1 |
| Realtime everywhere (live like counters, presence) | Connection cost explodes per tenant/post; realtime only for chat and notification badge |
| Full offline mode with write queues | Conflict resolution across tenants; far beyond pilot needs |
| Gamification (points, levels, leaderboards) | Distorts behavior in institutions; meaningless with admin-only posting |
| Courses / LMS as a separate product | Superseded 2026-10-13: the tenant school is in scope as the `courses` module (COURSE-01..15): admin authoring and the full data model in Phase 08.3, the member catalogue, player, progress and certificates in the following phase. Lesson video rides the Mux pipeline through the `VideoProvider` seam, never an external embed (D-409); in-app live streaming stays out (a live is an external link, D-416) |
| Live streaming / live rooms | Infrastructure-heavy; use online events with external links |
| Deep nested comment threads | User chose one reply level; unreadable on phones |
| AI moderation / summaries | No member-generated volume in V1 to justify cost |
| Exposing 12+ theme tokens | Tenants produce unreadable palettes; 2-3 brand colors, derive the rest |
| Multi-language UI | pt-BR only; strings centralized for later |
| Prototype extras (follow/followers and a following-only Explorar were pulled into Phase 9, reels into Phase 05.3, on 2026-09-25; the LMS "membros" area — courses, lessons, tracks, lives, progress — was pulled into Phase 08.3 for the data model and the admin and into the following phase for the member port, on 2026-10-13): forum, explore/search/trending, reputation, saved posts, event ticketing/QR/certificates/photos | Present in the design prototype but not in the V1 product definition; not ported |

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
| COMM-02 | Phase 5 (amended by Phase 08.2: plans 01, 03, 09) | Pending (amended 2026-10-08) |
| COMM-03 | Phase 5 (amended by Phase 08.2: plan 09) | Pending (amended 2026-10-08) |
| COMM-04 | Phase 5 | Complete |
| STORY-01 | Phase 5 | Complete |
| STORY-02 | Phase 5 | Complete |
| STORY-03 | Phase 5 | Complete |
| STORY-04 | Phase 5 (re-delivered by Phase 05.2) | Complete (re-delivered through highlights by Phase 05.2) |
| STORY-05 | Phase 5 | Complete |
| HIGHLIGHT-01 | Phase 05.2 | Complete |
| HIGHLIGHT-02 | Phase 05.2 | Complete |
| HIGHLIGHT-03 | Phase 05.2 | Complete |
| HIGHLIGHT-04 | Phase 05.2 | Complete |
| HIGHLIGHT-05 | Phase 05.2 | Complete |
| HIGHLIGHT-06 | Phase 05.2 | Complete |
| REELS-01 | Phase 05.3 | Complete |
| REELS-02 | Phase 05.3 | Complete |
| REELS-03 | Phase 05.3 | Complete |
| REELS-04 | Phase 05.3 | Complete |
| REELS-05 | Phase 05.3 | Complete |
| REELS-06 | Phase 05.3 | Pending |
| REELS-07 | Phase 05.3 | Complete |
| REELS-08 | Phase 05.3 | Complete |
| EVENT-01 | Phase 6 | Complete |
| EVENT-02 | Phase 6 | Complete |
| EVENT-03 | Phase 6 | Complete |
| EVENT-04 | Phase 6 | Complete |
| EVENT-05 | Phase 6 | Complete |
| EVENT-06 | Phase 6 | Complete |
| EVENT-07 | Phase 7 | Complete |
| CHAT-01 | Phase 7 | Complete |
| CHAT-02 | Phase 7 | Complete |
| CHAT-03 | Phase 7 | Complete |
| CHAT-04 | Phase 7 | Complete |
| CHAT-05 | Phase 7 | Complete |
| CHAT-06 | Phase 11 | Pending |
| CHAT-07 | Phase 11 | Pending |
| NOTIF-01 | Phase 7 | Complete |
| NOTIF-02 | Phase 7 | Complete |
| NOTIF-03 | Phase 7 | Complete |
| NOTIF-04 | Phase 7 | Complete |
| MODER-01 | Phase 8 | Pending |
| MODER-02 | Phase 8 | Pending |
| MODER-03 | Phase 8 | Pending |
| MODER-04 | Phase 11 | Pending |
| MODER-05 | Phase 11 | Pending |
| ADMIN-01 | Phase 8 | Pending |
| ADMIN-02 | Phase 8 | Pending |
| ADMIN-03 | Phase 8 | Pending |
| ADMIN-04 | Phase 8 | Pending |
| STORE-01 | Phase 08.2 (plans 01, 05, 07, 12) | Complete |
| STORE-02 | Phase 08.2 (plans 01, 05, 10) | Complete |
| STORE-03 | Phase 08.2 (plans 01, 05, 10); amended by Phase 08.4 (plans 01-05) | Complete |
| STORE-04 | Phase 08.2 (plans 05, 10) | Complete |
| STORE-05 | Phase 08.2 (plans 05, 07) | Complete |
| STORE-06 | Phase 08.2 (plans 05, 07); amended by Phase 08.5 (plans 05, 12) | Complete (amended 2026-10-15) |
| STORE-07 | Phase 08.2 (plans 08); amended by Phase 08.5 (plans 05, 12) | Complete (amended 2026-10-15) |
| STORE-08 | Phase 08.2 (plans 01, 08) | Complete |
| STORE-09 | Phase 08.2 (plans 05, 06, 11) | Complete |
| STORE-10 | Phase 08.2 (plans 06, 11) | Complete |
| STORE-11 | Phase 08.2 (plans 01) | Complete |
| STORE-12 | Phase 08.2 (plans 05, 09) | Complete |
| STORE-13 | Phase 08.2 (plans 01, 03, 04, 09) | Complete |
| STORE-14 | Phase 08.2 (plans 05, 09) | Complete |
| STORE-15 | Phase 08.2 (plans 03, 09) | Complete |
| STORE-16 | Phase 08.2 (plans 03) | Complete |
| STORE-17 | Phase 08.2 (plans 03, 09) | Complete |
| STORE-18 | Phase 08.2 (plans 04, 09) | Complete |
| STORE-19 | Phase 08.2 (plans 04) | Complete |
| STORE-20 | Phase 08.2 (plans 01, 06) | Complete |
| STORE-21 | Phase 08.2 (plans 01, 06, 12) | Complete |
| STORE-22 | Phase 08.4 (plans 01-05) | Complete |
| STORE-23 | Phase 08.5 (plans 05, 07, 09) | Complete |
| COURSE-01 | Phase 08.3 (plans 01, 06, 12) | Complete |
| COURSE-02 | Phase 08.3 (plans 01, 04, 07) | Complete |
| COURSE-03 | Phase 08.3 (plans 01, 04, 08) | Complete |
| COURSE-04 | Phase 08.3 (plans 04, 07) | Complete |
| COURSE-05 | Phase 08.3 (plans 05, 08) | Complete |
| COURSE-06 | Phase 08.3 (plans 05, 09) | Complete |
| COURSE-07 | Phase 08.3 (plans 03, 05, 09) | Complete |
| COURSE-08 | Phase 08.3 (plans 01, 04, 07); amended by Phase 08.4 (plans 01-05) | Complete |
| COURSE-09 | Phase 08.3 (plan 01) | Complete |
| COURSE-10 | Phase 08.3 (plan 10) | Complete |
| COURSE-11 | Phase 08.3 (plan 11); amended by Phase 08.4 (plans 01-05) | Complete |
| COURSE-12 | Phase 08.3 (plans 01, 03, 09) | Complete |
| COURSE-13 | Phase 08.3 (plans 01, 05, 12) | Complete |
| COURSE-14 | Phase 08.3 (plans 02, 06, 07, 08, 09) | Complete |
| COURSE-15 | Phase 08.3 (plans 01, 03, 12) | Complete |
| COURSE-16 | Phase 08.5 (plans 06, 11) | Complete |
| COURSE-17 | Phase 08.5 (plans 04, 06) | Complete |
| COURSE-18 | Phase 08.5 (plans 01, 07) | Complete |
| COURSE-19 | Phase 08.5 (plans 01, 03, 08) | Complete |
| COURSE-20 | Phase 08.5 (plan 01) | Complete |
| COURSE-21 | Phase 08.5 (plans 01, 03, 08) | Complete |
| COURSE-22 | Phase 08.5 (plans 01, 03, 08, 10) | Complete |
| COURSE-23 | Phase 08.5 (plans 04, 06) | Complete |
| COURSE-24 | Phase 08.5 (plans 04, 09) | Complete |
| COURSE-25 | Phase 08.5 (plans 03, 07, 10) | Complete |
| COURSE-26 | Phase 08.5 (plans 01, 03, 04, 05, 13) | Complete |
| COURSE-27 | Phase 08.5 (plans 01, 13) | Complete |
| COURSE-28 | Phase 08.6 (plans 02, 08, 10) | Pending |
| COURSE-29 | Phase 08.6 (plans 01, 03, 08) | Complete |
| COURSE-30 | Phase 08.6 (plans 03, 09) | Pending |
| COURSE-31 | Phase 08.6 (plans 03, 09) | Pending |
| COURSE-32 | Phase 08.6 (plans 03, 11) | Pending |
| COURSE-33 | Phase 08.6 (plans 03, 09) | Pending |
| COURSE-34 | Phase 08.6 (plans 03, 08, 09) | Pending |
| COURSE-35 | Phase 08.6 (plans 04, 10) | Pending |
| COURSE-36 | Phase 08.6 (plans 04, 10) | Pending |
| COURSE-37 | Phase 08.6 (plans 01, 08, 10) | Pending |
| COURSE-38 | Phase 08.6 (plans 04, 10) | Pending |
| COURSE-39 | Phase 08.6 (plans 01, 05) | Complete |
| COURSE-40 | Phase 08.6 (plans 05, 11) | Pending |
| COURSE-41 | Phase 08.6 (plans 05, 06) | Complete |
| COURSE-42 | Phase 08.6 (plan 06) | Complete |
| COURSE-43 | Phase 08.6 (plans 02, 06, 12) | Pending |
| COURSE-44 | Phase 08.6 (plan 07) | Complete |
| COURSE-45 | Phase 08.6 (plan 07) | Complete |
| COURSE-46 | Phase 08.6 (plan 06) | Complete |
| COURSE-47 | Phase 08.6 (plan 06) | Complete |
| COURSE-48 | Phase 08.6 (plans 02, 05, 06, 07, 12) | Pending |
| COURSE-49 | Phase 08.6 (plan 07) | Complete |
| COURSE-50 | Phase 08.6 (plans 02, 04, 11) | Pending |
| COURSE-51 | Phase 08.6 (plans 01, 03, 04, 05, 06, 07, 13) | Pending |
| COURSE-52 | Phase 08.6 (plans 01, 05, 06, 07, 13) | Pending |
| MEDIA-01 | Phase 3 | Complete |
| MEDIA-02 | Phase 3 | Complete |
| MEDIA-03 | Phase 3 | Complete |
| MEDIA-04 | Phase 4 | Complete |
| UI-01 | Phase 2 | Gaps Found |
| UI-02 | Phase 4 | Complete |
| UI-03 | Phase 2 | Gaps Found |
| UI-04 | Phase 2 | Complete |
| PWA-01 | Phase 2 | Gaps Found |
| PWA-02 | Phase 7 | Complete |
| PWA-03 | Phase 2 | Complete |
| PWA-04 | Phase 01.1 | Pending |

**Coverage:**

- v1 requirements: 172 total (89 after Phase 05.2 planning — recounted from the traceability table on 2026-09-25 — plus REELS-01..08 from Phase 05.3 planning on 2026-09-26, plus STORE-01..21 from Phase 08.2 planning on 2026-10-08, plus COURSE-01..15 from Phase 08.3 planning on 2026-10-13, plus STORE-22 from Phase 08.4 planning on 2026-10-14, plus COURSE-16..27 and STORE-23 from Phase 08.5 planning on 2026-10-15, plus COURSE-28..52 from Phase 08.6 planning on 2026-10-16; STORE-06 and STORE-07 amended by Phase 08.5)
- Mapped to phases: 172
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-11*
*Last updated: 2026-10-16 — Phase 08.6 planning: COURSE-28..52 added (### Courses, the member area: Início, Trilhas, Meu progresso, the streak, the live reminder, the new-content notices and the live reactivation; D-435..D-454). Previously 2026-10-14 — Phase 08.4: STORE-22 added; STORE-03, COURSE-08 and COURSE-11 reworded to the product-side write path (D-418). Previously 2026-10-13 — Phase 08.3 planning: COURSE-01..15 added (### Courses), the "Courses / LMS" and "Prototype extras" Out of Scope rows amended. Previously 2026-10-08 — Phase 08.2 planning: STORE-01..21 added (### Store), COMM-02 and COMM-03 amended (Pending until 08.2 delivers), Out of Scope billing row reworded.*
